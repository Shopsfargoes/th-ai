// Chat page logic. Needs: supabase-js CDN, config.js, supabase.js, auth.js
(async function () {
  const $ = (id) => document.getElementById(id);
  const session = await Auth.requireAuth();
  if (!session) return;

  let currentId = null;
  let sending = false;
  let agents = [];
  let selected = null;
  let attachment = null;
  let historyDays = 30;
  let usage = null;
  const convoAgents = {};

  const PRESETS = [
    { name: 'Legal Advisor', desc: 'General legal information and guidance',
      prompt: 'You are a legal information assistant. Explain legal concepts clearly, outline options and typical steps, and always remind the user that you provide general information, not legal advice, and that they should consult a qualified lawyer for their specific situation.' },
    { name: 'Administrative Assistance', desc: 'Emails, plans, notes and documents',
      prompt: 'You are an administrative assistant. Help draft emails, plan schedules, write meeting notes and agendas, and prepare professional documents. Be concise and well organised.' },
    { name: 'Health and Wellness Coach', desc: 'Everyday healthy-habit guidance',
      prompt: 'You are a supportive health and wellness coach. Offer general guidance on healthy habits, nutrition, sleep and exercise. You are not a doctor: do not diagnose, and recommend seeing a healthcare professional for medical concerns.' },
    { name: 'Research Assistant', desc: 'Break down topics and compare sources',
      prompt: 'You are a research assistant. Help break down topics, summarise information, compare viewpoints and suggest how to verify sources. Be clear about uncertainty and never invent citations.' },
  ];

  // ---------- user info ----------
  const u = session.user, meta = u.user_metadata || {};
  const name = meta.full_name || meta.name || u.email.split('@')[0];
  $('userName').textContent = name;
  if (meta.avatar_url) $('avatar').style.backgroundImage = 'url(' + meta.avatar_url + ')';
  else $('avatar').textContent = name.charAt(0).toUpperCase();
  $('greeting').textContent = 'Hello ' + name.split(' ')[0] + ', how can I help?';

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
      } else if (/^\s*-{3,}\s*$/.test(line)) {
        close(); html += '<hr>';
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

  // ---------- notices ----------
  let noticeTimer;
  function notice(msg) {
    const el = $('notice');
    el.textContent = msg; el.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ---------- thread ----------
  function scrollDown() { const el = $('messages'); el.scrollTop = el.scrollHeight; }
  function setEmpty(empty) { $('hero').hidden = !empty; $('thread').hidden = empty; }

  function addMsg(role, content, cls, attName) {
    const el = document.createElement('div');
    el.className = 'msg ' + role + (cls ? ' ' + cls : '');
    if (role === 'assistant' && cls !== 'error') {
      el.innerHTML = md(content);
    } else {
      if (attName) {
        const a = document.createElement('div');
        a.className = 'att';
        a.textContent = '📎 ' + attName;
        el.appendChild(a);
      }
      el.appendChild(document.createTextNode(content));
    }
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

  // ---------- agents ----------
  const defaultAgent = () => agents.find((a) => a.slug === 'general-chatbot') || agents[0];

  function updateAgentUI() {
    if (!selected) return;
    $('agentName').textContent = selected.name;
    $('heroSub').textContent = selected.description || '';
    $('clip').hidden = !selected.accepts_files;
    if (!selected.accepts_files) clearAttachment();
    updateSend();
  }

  async function loadAgents() {
    const { data } = await sb.from('agents')
      .select('id, slug, name, description, user_id, accepts_files')
      .eq('is_active', true).order('id');
    agents = data || [];
    if (!selected || !agents.find((a) => a.id === selected.id)) selected = defaultAgent();
    updateAgentUI();
  }

  function agentCard(a) {
    const el = document.createElement('div');
    el.className = 'agent-card' + (selected && selected.id === a.id ? ' selected' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const b = document.createElement('b'); b.textContent = a.name;
    const d = document.createElement('span'); d.className = 'd'; d.textContent = a.description || '';
    el.append(b, d);

    if (a.user_id) {
      const rm = document.createElement('button');
      rm.className = 'rm'; rm.textContent = '×';
      rm.setAttribute('aria-label', 'Delete agent');
      rm.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete "' + a.name + '"? Your past chats with it are kept.')) return;
        const { error } = await sb.from('agents').delete().eq('id', a.id);
        if (error) { alert('Could not delete this agent. Please try again.'); return; }
        agents = agents.filter((x) => x.id !== a.id);
        if (selected && selected.id === a.id) { selected = defaultAgent(); newChat(); }
        renderAgents();
        loadConversations();
      };
      el.appendChild(rm);
    }

    const pick = () => { selected = a; closeModal(); newChat(); };
    el.onclick = pick;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    return el;
  }

  function renderAgents() {
    const builtin = $('builtin'), custom = $('custom');
    builtin.innerHTML = ''; custom.innerHTML = '';
    agents.filter((a) => !a.user_id).forEach((a) => builtin.appendChild(agentCard(a)));
    const mine = agents.filter((a) => a.user_id);
    if (!mine.length) custom.innerHTML = '<div class="convo-empty">You have not created any agents yet.</div>';
    mine.forEach((a) => custom.appendChild(agentCard(a)));
    $('showCreate').hidden = mine.length >= 5 || !$('createForm').hidden;
  }

  function openModal() { renderAgents(); $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; hideCreate(); }

  function showCreate() { $('createForm').hidden = false; $('showCreate').hidden = true; $('cName').focus(); }
  function hideCreate() {
    $('createForm').hidden = true; $('createForm').reset(); $('cErr').hidden = true;
    $('showCreate').hidden = agents.filter((a) => a.user_id).length >= 5;
  }

  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p.name;
    b.onclick = () => { $('cName').value = p.name; $('cDesc').value = p.desc; $('cPrompt').value = p.prompt; };
    $('presets').appendChild(b);
  });

  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('cErr'); err.hidden = true;
    const nm = $('cName').value.trim(), desc = $('cDesc').value.trim(), prompt = $('cPrompt').value.trim();
    if (!nm || !prompt) { err.textContent = 'Give your agent a name and instructions.'; err.hidden = false; return; }
    const btn = $('cSave'); btn.disabled = true;
    const { data, error } = await sb.from('agents')
      .insert({ user_id: session.user.id, name: nm, description: desc || null, system_prompt: prompt })
      .select('id, slug, name, description, user_id, accepts_files').single();
    btn.disabled = false;
    if (error) {
      err.textContent = /row-level|policy/i.test(error.message)
        ? 'You can create up to 5 custom agents. Delete one to add another.'
        : 'Could not save this agent. Please check the fields and try again.';
      err.hidden = false;
      return;
    }
    agents.push(data);
    selected = data;
    closeModal();
    newChat();
  });

  $('agentBtn').onclick = openModal;
  $('closeModal').onclick = closeModal;
  $('showCreate').onclick = showCreate;
  $('cCancel').onclick = hideCreate;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // ---------- conversations ----------
  function newChat() {
    currentId = null;
    $('thread').innerHTML = '';
    setEmpty(true);
    highlight();
    updateAgentUI();
    closeSidebar();
    $('prompt').focus();
  }

  async function openConversation(id) {
    currentId = id;
    const a = agents.find((x) => x.id === convoAgents[id]);
    if (a) selected = a;
    updateAgentUI();
    highlight();
    closeSidebar();
    const { data, error } = await sb.from('messages')
      .select('role, content, attachment_name').eq('conversation_id', id).order('id', { ascending: true });
    $('thread').innerHTML = '';
    if (error) { setEmpty(false); addMsg('assistant', 'Could not load this conversation.', 'error'); return; }
    setEmpty(false);
    (data || []).forEach((m) => addMsg(m.role, m.content, null, m.attachment_name));
    scrollDown();
  }

  function highlight() {
    document.querySelectorAll('.convo').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === currentId);
    });
  }

  async function loadConversations() {
    let q = sb.from('conversations')
      .select('id, title, agent_id').order('updated_at', { ascending: false }).limit(50);
    if (historyDays) q = q.gte('updated_at', new Date(Date.now() - historyDays * 86400000).toISOString());
    const { data } = await q;
    const box = $('convos');
    box.innerHTML = '';
    if (!data || !data.length) { box.innerHTML = '<div class="convo-empty">No conversations yet</div>'; return; }
    data.forEach((c) => {
      convoAgents[c.id] = c.agent_id;
      const row = document.createElement('div');
      row.className = 'convo';
      row.dataset.id = c.id;
      const t = document.createElement('span');
      t.className = 't'; t.textContent = c.title;
      const del = document.createElement('button');
      del.className = 'del'; del.setAttribute('aria-label', 'Delete conversation'); del.textContent = '×';
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

  // ---------- attachments (text files) ----------
  function showChip() { $('chipName').textContent = '📎 ' + attachment.name; $('chip').hidden = false; }
  function clearAttachment() { attachment = null; $('chip').hidden = true; }

  $('clip').onclick = () => $('file').click();
  $('chipX').onclick = () => { clearAttachment(); updateSend(); };
  $('file').onchange = () => {
    const f = $('file').files[0];
    $('file').value = '';
    if (!f) return;
    if (!/\.(txt|md|csv|json)$/i.test(f.name)) { notice('Only text files (.txt, .md, .csv, .json) are supported for now.'); return; }
    if (f.size > 300 * 1024) { notice('That file is too large. Please use a file under 300 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const t = String(reader.result || '');
      if (t.indexOf('\u0000') !== -1) { notice('That file does not look like plain text.'); return; }
      attachment = { name: f.name, text: t.slice(0, 15000) };
      if (t.length > 15000) notice('Large file: only the first 15,000 characters will be used.');
      showChip(); updateSend();
    };
    reader.readAsText(f);
  };

  // ---------- sending ----------
  const prompt = $('prompt'), sendBtn = $('send');

  function resize() {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 200) + 'px';
  }
  function updateSend() { sendBtn.disabled = sending || (!prompt.value.trim() && !attachment); }

  async function sendMessage() {
    const text = prompt.value.trim() || (attachment ? 'Please summarize this file.' : '');
    if (!text || sending) return;
    if (usage && usage.limit != null && usage.used >= usage.limit) { showLimit(); return; }
    const att = attachment;
    sending = true; updateSend();
    setEmpty(false);
    addMsg('user', text, null, att ? att.name : null);
    prompt.value = ''; resize(); clearAttachment();
    const typing = addTyping();

    try {
      const { data: { session: s } } = await sb.auth.getSession();
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify({
          message: text,
          conversation_id: currentId,
          agent_id: currentId ? undefined : selected.id,
          attachment: att || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      typing.remove();
      if (!r.ok) {
        const err = new Error(j.error || 'Something went wrong. Please try again.');
        err.code = j.code;
        throw err;
      }
      addMsg('assistant', j.reply);
      if (!currentId) { currentId = j.conversation_id; convoAgents[currentId] = selected.id; }
      loadConversations();
      loadPlan();
    } catch (e) {
      typing.remove();
      const msg = e && e.message && !/failed to fetch/i.test(e.message)
        ? e.message : 'Connection problem. Check your internet and try again.';
      const errEl = addMsg('assistant', msg, 'error');
      if (e && e.code === 'limit') {
        const a = document.createElement('a');
        a.href = '/pricing'; a.textContent = ' View plans';
        errEl.appendChild(a);
        showLimit();
      }
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

  // ---------- usage: upgrade box, 80% banner, limit popup ----------
  let planCache = null;
  const warnKey = () => 'thai_warn_' + new Date().toISOString().slice(0, 10);

  function renderUsage() {
    if (!usage) return;
    const j = usage;
    const canUpgrade = !['premium', 'custom'].includes(j.plan_code);
    const limited = j.limit != null && j.limit > 0;

    $('upgradeBox').hidden = !(canUpgrade && limited);
    if (canUpgrade && limited) {
      $('usageText').textContent = j.used.toLocaleString() + ' of ' + Number(j.limit).toLocaleString() + ' requests used today';
      const pct = Math.min(100, Math.round((j.used / j.limit) * 100));
      $('usageFill').style.width = pct + '%';
      $('usageBar').className = 'usage-bar' + (pct >= 100 ? ' full' : pct >= 80 ? ' warn' : '');
    }

    const near = canUpgrade && limited && j.used / j.limit >= 0.8 && j.used < j.limit;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(warnKey()) === '1'; } catch (e) { /* ignore */ }
    if (near && !dismissed) {
      $('bannerText').textContent = "You've used " + j.used + ' of ' + j.limit + ' requests today.';
      $('usageBanner').hidden = false;
    } else {
      $('usageBanner').hidden = true;
    }
  }

  $('bannerX').onclick = () => {
    $('usageBanner').hidden = true;
    try { sessionStorage.setItem(warnKey(), '1'); } catch (e) { /* ignore */ }
  };

  async function showLimit() {
    const u = usage || {};
    $('limitText').textContent = u.limit != null
      ? "You've used all " + Number(u.limit).toLocaleString() + ' requests on the ' + (u.plan || 'current plan') + ' today. Your allowance resets daily, or you can upgrade now to keep chatting.'
      : "You've reached your daily limit. Upgrade your plan to keep chatting.";
    $('limitModal').hidden = false;

    if (!planCache) {
      const { data } = await sb.from('plans')
        .select('code, name, price_ngn, requests_per_day').not('price_ngn', 'is', null).order('id');
      planCache = data || [];
    }
    const box = $('miniPlans');
    box.innerHTML = '';
    planCache.filter((p) => p.requests_per_day > (u.limit || 0)).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'mini-plan';
      const left = document.createElement('span');
      const b = document.createElement('b'); b.textContent = p.name;
      const s = document.createElement('small'); s.textContent = p.requests_per_day.toLocaleString() + ' requests per day';
      left.append(b, s);
      const right = document.createElement('span');
      right.className = 'mp';
      right.textContent = '₦' + Number(p.price_ngn).toLocaleString('en-NG') + ' / month';
      row.append(left, right);
      box.appendChild(row);
    });
  }

  const closeLimit = () => { $('limitModal').hidden = true; };
  $('closeLimit').onclick = closeLimit;
  $('limitLater').onclick = closeLimit;
  $('limitModal').addEventListener('click', (e) => { if (e.target === $('limitModal')) closeLimit(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('limitModal').hidden) closeLimit(); });

  // ---------- plan + usage ----------
  async function loadPlan() {
    try {
      const { data: { session: s } } = await sb.auth.getSession();
      const r = await fetch('/api/usage', { headers: { Authorization: 'Bearer ' + s.access_token } });
      if (!r.ok) return;
      const j = await r.json();
      historyDays = j.history_days;
      usage = j;
      renderUsage();
      $('planInfo').textContent = j.plan + ' · ' + j.used + (j.limit != null ? ' of ' + Number(j.limit).toLocaleString() : '') + ' requests today';
    } catch (e) { /* ignore */ }
  }

  // ---------- start ----------
  $('app').hidden = false;
  setEmpty(true);
  updateSend();
  await loadAgents();
  await loadPlan();
  loadConversations();
})();