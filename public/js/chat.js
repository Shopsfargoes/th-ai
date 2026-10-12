// Chat page logic. Needs: supabase-js CDN, config.js, supabase.js, auth.js
(async function () {
    const $ = (id) => document.getElementById(id);
    const session = await Auth.requireAuth();
    if (!session) return;
  
    let currentId = null;
    let sending = false;
  
    // ---------- user info ----------
    const u = session.user, meta = u.user_metadata || {};
    const name = meta.full_name || meta.name || u.email.split('@')[0];
    $('userName').textContent = name;
    if (meta.avatar_url) $('avatar').style.backgroundImage = 'url(' + meta.avatar_url + ')';
    else $('avatar').textContent = name.charAt(0).toUpperCase();
    $('greeting').textContent = 'Hello ' + name.split(' ')[0] + ', how can I help?';
    $('app').hidden = false;
  
    // ---------- tiny safe markdown ----------
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
    function inline(src) {
      const s = esc(src)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      let html = '', list = null;
      const close = () => { if (list) { html += '</' + list + '>'; list = null; } };
      for (const line of s.split('\n')) {
        let m;
        if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
          if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; }
          html += '<li>' + m[1] + '</li>';
        } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
          if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; }
          html += '<li>' + m[1] + '</li>';
        } else if ((m = line.match(/^#{1,4}\s+(.*)/))) {
          close(); html += '<h4>' + m[1] + '</h4>';
        } else if (!line.trim()) {
          close();
        } else {
          close(); html += '<p>' + line + '</p>';
        }
      }
      close();
      return html;
    }
  
    function md(src) {
      const out = [], re = /```(?:[\w-]+)?\n?([\s\S]*?)```/g;
      let last = 0, m;
      while ((m = re.exec(src))) {
        out.push(inline(src.slice(last, m.index)));
        out.push('<pre><code>' + esc(m[1].replace(/\n$/, '')) + '</code></pre>');
        last = re.lastIndex;
      }
      out.push(inline(src.slice(last)));
      return out.join('');
    }
  
    // ---------- thread ----------
    function scrollDown() { const el = $('messages'); el.scrollTop = el.scrollHeight; }
  
    function setEmpty(empty) {
      $('hero').hidden = !empty;
      $('thread').hidden = empty;
    }
  
    function addMsg(role, content, cls) {
      const el = document.createElement('div');
      el.className = 'msg ' + role + (cls ? ' ' + cls : '');
      if (role === 'assistant' && cls !== 'error') el.innerHTML = md(content);
      else el.textContent = content;
      $('thread').appendChild(el);
      scrollDown();
      return el;
    }
  
    function addTyping() {
      const el = document.createElement('div');
      el.className = 'msg assistant';
      el.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
      $('thread').appendChild(el);
      scrollDown();
      return el;
    }
  
    function newChat() {
      currentId = null;
      $('thread').innerHTML = '';
      setEmpty(true);
      highlight();
      closeSidebar();
      $('prompt').focus();
    }
  
    async function openConversation(id) {
      currentId = id;
      highlight();
      closeSidebar();
      const { data, error } = await sb.from('messages')
        .select('role, content').eq('conversation_id', id).order('id', { ascending: true });
      $('thread').innerHTML = '';
      if (error) { setEmpty(false); addMsg('assistant', 'Could not load this conversation.', 'error'); return; }
      setEmpty(false);
      (data || []).forEach((m) => addMsg(m.role, m.content));
      scrollDown();
    }
  
    // ---------- sidebar list ----------
    function highlight() {
      document.querySelectorAll('.convo').forEach((el) => {
        el.classList.toggle('active', el.dataset.id === currentId);
      });
    }
  
    async function loadConversations() {
      const { data } = await sb.from('conversations')
        .select('id, title').order('updated_at', { ascending: false }).limit(50);
      const box = $('convos');
      box.innerHTML = '';
      if (!data || !data.length) { box.innerHTML = '<div class="convo-empty">No conversations yet</div>'; return; }
      data.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'convo';
        row.dataset.id = c.id;
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = c.title;
        const del = document.createElement('button');
        del.className = 'del';
        del.setAttribute('aria-label', 'Delete conversation');
        del.textContent = '×';
        del.onclick = async (e) => {
          e.stopPropagation();
          await sb.from('conversations').delete().eq('id', c.id);
          if (currentId === c.id) newChat();
          loadConversations();
        };
        row.onclick = () => openConversation(c.id);
        row.append(t, del);
        box.appendChild(row);
      });
      highlight();
    }
  
    // ---------- sending ----------
    const prompt = $('prompt'), sendBtn = $('send');
  
    function resize() {
      prompt.style.height = 'auto';
      prompt.style.height = Math.min(prompt.scrollHeight, 200) + 'px';
    }
    function updateSend() { sendBtn.disabled = sending || !prompt.value.trim(); }
  
    async function sendMessage() {
      const text = prompt.value.trim();
      if (!text || sending) return;
      sending = true; updateSend();
      setEmpty(false);
      addMsg('user', text);
      prompt.value = ''; resize();
      const typing = addTyping();
  
      try {
        const { data: { session: s } } = await sb.auth.getSession();
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
          body: JSON.stringify({ message: text, conversation_id: currentId }),
        });
        const j = await r.json().catch(() => ({}));
        typing.remove();
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        addMsg('assistant', j.reply);
        if (!currentId) currentId = j.conversation_id;
        loadConversations();
      } catch (e) {
        typing.remove();
        const msg = e && e.message && !/failed to fetch/i.test(e.message)
          ? e.message : 'Connection problem. Check your internet and try again.';
        addMsg('assistant', msg, 'error');
      } finally {
        sending = false; updateSend(); prompt.focus();
      }
    }
  
    prompt.addEventListener('input', () => { resize(); updateSend(); });
    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    sendBtn.addEventListener('click', sendMessage);
  
    // ---------- sidebar, menu, buttons ----------
    const sidebar = $('sidebar'), scrim = $('scrim');
    function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('open'); }
    $('burger').onclick = () => { sidebar.classList.add('open'); scrim.classList.add('open'); };
    scrim.onclick = closeSidebar;
    $('newChat').onclick = newChat;
  
    const menu = $('menu');
    $('userBtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => { menu.hidden = true; });
    $('logout').onclick = () => Auth.signOut();
  
    $('clearAll').onclick = async () => {
      if (!confirm('Delete all your conversations? This cannot be undone.')) return;
      await sb.from('conversations').delete().eq('user_id', session.user.id);
      newChat();
      loadConversations();
    };
  
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('/login'); });
  
    setEmpty(true);
    updateSend();
    loadConversations();
  })();