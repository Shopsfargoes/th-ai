// Admin area. Every action goes through POST /api/admin, which re-checks is_admin on the server.
(async function () {
    const $ = (id) => document.getElementById(id);
    const session = await Auth.requireAuth();
    if (!session) return;
  
    async function api(action, params) {
      const { data: { session: s } } = await sb.auth.getSession();
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify(Object.assign({ action }, params || {})),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || 'Request failed.'); e.status = r.status; throw e; }
      return j;
    }
  
    try {
      const me = await api('me');
      $('who').textContent = me.email || '';
    } catch (e) {
      location.replace('/chat'); // not an admin
      return;
    }
    $('shell').hidden = false;
  
    // ---------- helpers ----------
    function h(tag, attrs, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el[k] = v;
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
      kids.flat(2).forEach((c) => {
        if (c == null || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
      return el;
    }
    const naira = (kobo) => '₦' + (Number(kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    const dateOnly = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const dateTime = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));
  
    let toastTimer;
    function toast(msg) {
      const t = $('toast'); t.textContent = msg; t.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
    }
    const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong.');
  
    function openDialog(title, body) {
      $('dlgTitle').textContent = title;
      const box = $('dlgBody'); box.innerHTML = ''; box.append(body);
      $('dlg').hidden = false;
    }
    function closeDialog() { $('dlg').hidden = true; }
    $('dlgX').onclick = closeDialog;
    $('dlg').addEventListener('click', (e) => { if (e.target === $('dlg')) closeDialog(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });
  
    function table(headers, rows, emptyText) {
      if (!rows.length) return h('div', { class: 'a-scroll' }, h('div', { class: 'a-empty' }, emptyText || 'Nothing here yet.'));
      return h('div', { class: 'a-scroll' }, h('table', { class: 'a-table' },
        h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
        h('tbody', null, rows)));
    }
    const badge = (text, kind) => h('span', { class: 'a-badge' + (kind ? ' ' + kind : '') }, text);
  
    function pager(state, total, size, reload) {
      const pages = Math.max(1, Math.ceil(total / size));
      return h('div', { class: 'a-pager' },
        h('button', { class: 'a-btn', disabled: state.page <= 0, onclick: () => { state.page--; reload(); } }, 'Previous'),
        h('span', null, 'Page ' + (state.page + 1) + ' of ' + pages + ' · ' + total + ' total'),
        h('button', { class: 'a-btn', disabled: state.page + 1 >= pages, onclick: () => { state.page++; reload(); } }, 'Next'));
    }
  
    let plansCache = null;
    async function getPlans(force) {
      if (!plansCache || force) plansCache = (await api('plans.list')).plans;
      return plansCache;
    }
  
    const view = $('view');
    const head = (title, sub) => [h('h2', null, title), h('p', { class: 'a-sub' }, sub)];
  
    // ---------- dashboard ----------
    function barChart(title, labels, values) {
      const max = Math.max(1, ...values);
      return h('div', { class: 'a-card' }, h('h4', null, title),
        h('div', { class: 'bars' }, values.map((v, i) =>
          h('div', { class: 'bar', title: labels[i] + ': ' + v },
            h('div', { class: 'fill', style: 'height:' + Math.round((v / max) * 100) + '%' }),
            h('span', null, labels[i].slice(8))))));
    }
  
    async function renderDashboard() {
      view.replaceChildren(...head('Dashboard', 'How TH_AI is doing.'), h('div', { class: 'a-empty' }, 'Loading…'));
      const s = await api('stats');
      const card = (k, v) => h('div', { class: 'a-card' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
      view.replaceChildren(
        ...head('Dashboard', 'How TH_AI is doing.'),
        h('div', { class: 'a-cards' },
          card('Total users', s.users.toLocaleString()),
          card('New users (7 days)', s.new_users_7d.toLocaleString()),
          card('Active subscriptions', s.active_subs.toLocaleString()),
          card('Revenue (30 days)', naira(s.revenue_30d_kobo)),
          card('Revenue (all time)', naira(s.revenue_all_kobo)),
          card('Requests today', s.requests_today.toLocaleString())),
        h('div', { class: 'a-two' },
          barChart('Requests, last 14 days', s.days, s.requests_by_day),
          barChart('New users, last 14 days', s.days, s.signups_by_day)),
        h('div', { class: 'a-card', style: 'max-width:480px' }, h('h4', null, 'Top users this week (requests)'),
          s.top_users.length
            ? h('ul', { class: 'toplist' }, s.top_users.map((t) => h('li', null, h('span', null, t.email), h('span', null, t.requests))))
            : h('div', { class: 'a-help' }, 'No activity yet.')));
    }
  
    // ---------- users ----------
    const usersState = { q: '', page: 0 };
  
    async function renderUsers() {
      const d = await api('users.list', { q: usersState.q, page: usersState.page });
      const search = h('input', { class: 'a-input grow', placeholder: 'Search by email', value: usersState.q });
      const go = () => { usersState.q = search.value.trim(); usersState.page = 0; renderUsers().catch(fail); };
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  
      const rows = d.users.map((u) => h('tr', null,
        h('td', null, u.email || '—'),
        h('td', null, u.plan ? badge(u.plan, 'ok') : badge('Free')),
        h('td', null, String(u.used_today)),
        h('td', null, dateOnly(u.created_at)),
        h('td', null, dateOnly(u.last_login_at)),
        h('td', null, u.suspended ? badge('Suspended', 'bad') : u.is_admin ? badge('Admin') : badge('Active', 'ok')),
        h('td', null, h('button', { class: 'a-btn', onclick: () => manageUser(u) }, 'Manage'))));
  
      view.replaceChildren(
        ...head('Users', 'Search accounts, change plans, suspend or reset usage.'),
        h('div', { class: 'a-bar' }, search, h('button', { class: 'a-btn primary', onclick: go }, 'Search')),
        table(['Email', 'Plan', 'Used today', 'Joined', 'Last login', 'Status', ''], rows, 'No users found.'),
        pager(usersState, d.total, d.page_size, () => renderUsers().catch(fail)));
    }
  
    async function manageUser(u) {
      const plans = await getPlans();
      const planSel = h('select', { class: 'a-select' },
        h('option', { value: 'free' }, 'Free (no plan)'),
        plans.map((p) => h('option', { value: p.code }, p.name)));
      const days = h('input', { class: 'a-input', type: 'number', min: '1', max: '366', value: '30' });
      const done = (msg) => { toast(msg); closeDialog(); renderUsers().catch(fail); };
  
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        h('dl', { class: 'a-kv' },
          h('dt', null, 'Email'), h('dd', null, u.email || '—'),
          h('dt', null, 'Current plan'), h('dd', null, u.plan ? u.plan + ' (until ' + dateOnly(u.plan_ends) + ')' : 'Free'),
          h('dt', null, 'Used today'), h('dd', null, String(u.used_today)),
          h('dt', null, 'Joined'), h('dd', null, dateOnly(u.created_at))),
        h('div', { class: 'a-field' }, 'Set plan manually (no payment taken)', planSel),
        h('div', { class: 'a-field' }, 'Length in days', days),
        h('div', { class: 'a-row' },
          h('button', { class: 'a-btn primary', onclick: async () => {
            try { await api('users.set_plan', { user_id: u.id, plan_code: planSel.value, days: Number(days.value) }); done('Plan updated.'); } catch (e) { fail(e); }
          } }, 'Apply plan'),
          h('button', { class: 'a-btn', onclick: async () => {
            try { await api('users.reset_usage', { user_id: u.id }); done('Usage reset for today.'); } catch (e) { fail(e); }
          } }, 'Reset today\'s usage'),
          !u.is_admin && h('button', { class: 'a-btn danger', onclick: async () => {
            const msg = u.suspended ? 'Unsuspend this account?' : 'Suspend this account? They will not be able to use the chat.';
            if (!confirm(msg)) return;
            try { await api('users.set_status', { user_id: u.id, suspended: !u.suspended }); done(u.suspended ? 'Account unsuspended.' : 'Account suspended.'); } catch (e) { fail(e); }
          } }, u.suspended ? 'Unsuspend' : 'Suspend')));
      openDialog('Manage user', body);
    }
  
    // ---------- plans ----------
    async function renderPlans() {
      const plans = await getPlans(true);
      const rows = plans.map((p) => {
        const name = h('input', { class: 'a-input', value: p.name });
        const price = h('input', { class: 'a-input sm', type: 'number', min: '0', value: p.price_ngn == null ? '' : p.price_ngn, placeholder: 'quote' });
        const reqs = h('input', { class: 'a-input sm', type: 'number', min: '0', value: p.requests_per_day == null ? '' : p.requests_per_day, placeholder: 'unlimited' });
        const hist = h('input', { class: 'a-input sm', type: 'number', min: '0', value: p.history_days == null ? '' : p.history_days, placeholder: 'unlimited' });
        const active = h('input', { type: 'checkbox', checked: p.is_active });
        return h('tr', null,
          h('td', null, p.code), h('td', null, name), h('td', null, price), h('td', null, reqs), h('td', null, hist), h('td', null, active),
          h('td', null, h('button', { class: 'a-btn primary', onclick: async () => {
            try {
              await api('plans.update', { id: p.id, name: name.value, price_ngn: numOrNull(price.value), requests_per_day: numOrNull(reqs.value), history_days: numOrNull(hist.value), is_active: active.checked });
              toast('Plan saved.'); plansCache = null;
            } catch (e) { fail(e); }
          } }, 'Save')));
      });
      view.replaceChildren(
        ...head('Plans', 'Edit prices and limits. Changes apply to new payments and to usage checks straight away.'),
        table(['Code', 'Name', 'Price (₦ / month)', 'Requests / day', 'History (days)', 'Active', ''], rows),
        h('p', { class: 'a-help' }, 'Leave price blank for "get a quote". Leave requests or history blank for unlimited. Payments already started keep the price they were created with.'));
    }
  
    // ---------- payments ----------
    const payState = { status: '', page: 0 };
  
    async function renderPayments() {
      const d = await api('payments.list', { status: payState.status, page: payState.page });
      const sel = h('select', { class: 'a-select', onchange: () => { payState.status = sel.value; payState.page = 0; renderPayments().catch(fail); } },
        [['', 'All statuses'], ['success', 'Successful'], ['pending', 'Pending'], ['failed', 'Failed']]
          .map(([v, l]) => h('option', { value: v, selected: payState.status === v }, l)));
      const rows = d.payments.map((p) => h('tr', null,
        h('td', null, dateTime(p.created_at)),
        h('td', null, p.email || '—'),
        h('td', null, p.plan || '—'),
        h('td', null, naira(p.amount_kobo)),
        h('td', null, badge(p.status, p.status === 'success' ? 'ok' : p.status === 'failed' ? 'bad' : 'warn')),
        h('td', null, h('code', null, p.reference)),
        h('td', null, p.status !== 'success' && h('button', { class: 'a-btn', onclick: async () => {
          try { const r = await api('payments.verify', { reference: p.reference }); toast('Paystack says: ' + r.status); renderPayments().catch(fail); } catch (e) { fail(e); }
        } }, 'Verify'))));
      view.replaceChildren(
        ...head('Payments', 'Paystack transactions. "Verify" asks Paystack again and activates the plan if it was paid.'),
        h('div', { class: 'a-bar' }, sel),
        table(['Date', 'User', 'Plan', 'Amount', 'Status', 'Reference', ''], rows, 'No payments yet.'),
        pager(payState, d.total, d.page_size, () => renderPayments().catch(fail)));
    }
  
    // ---------- agents ----------
    async function renderAgents() {
      const { agents } = await api('agents.list');
      const rows = agents.map((a) => h('tr', null,
        h('td', null, a.name),
        h('td', null, a.owner ? badge('Custom: ' + a.owner) : badge('Built-in', 'ok')),
        h('td', null, a.ai_model),
        h('td', null, a.is_active ? badge('On', 'ok') : badge('Off', 'bad')),
        h('td', null, h('button', { class: 'a-btn', onclick: () => editAgent(a) }, 'Edit'))));
      view.replaceChildren(
        ...head('Agents', 'Edit the bots\' instructions and models, turn them on or off, or remove custom agents.'),
        table(['Name', 'Type', 'Model', 'Status', ''], rows, 'No agents.'));
    }
  
    function editAgent(a) {
      const name = h('input', { class: 'a-input', value: a.name, maxlength: '60' });
      const desc = h('input', { class: 'a-input', value: a.description || '', maxlength: '300' });
      const model = h('input', { class: 'a-input', value: a.ai_model, maxlength: '100' });
      const prompt = h('textarea', { class: 'a-area', maxlength: '2000' }); prompt.value = a.system_prompt;
      const active = h('input', { type: 'checkbox', checked: a.is_active });
      const files = h('input', { type: 'checkbox', checked: a.accepts_files });
      const done = (m) => { toast(m); closeDialog(); renderAgents().catch(fail); };
  
      openDialog(a.owner ? 'Edit custom agent' : 'Edit built-in agent', h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        h('div', { class: 'a-field' }, 'Name', name),
        h('div', { class: 'a-field' }, 'Description', desc),
        h('div', { class: 'a-field' }, 'AI model (OpenRouter id, or "default")', model),
        h('div', { class: 'a-field' }, 'Instructions (system prompt)', prompt),
        h('label', { class: 'a-check' }, active, 'Active (visible to users)'),
        h('label', { class: 'a-check' }, files, 'Allow file attachments'),
        h('div', { class: 'a-row' },
          h('button', { class: 'a-btn primary', onclick: async () => {
            try {
              await api('agents.update', { id: a.id, name: name.value, description: desc.value, ai_model: model.value, system_prompt: prompt.value, is_active: active.checked, accepts_files: files.checked });
              done('Agent saved.');
            } catch (e) { fail(e); }
          } }, 'Save'),
          a.owner && h('button', { class: 'a-btn danger', onclick: async () => {
            if (!confirm('Delete this custom agent? The owner\'s past chats are kept.')) return;
            try { await api('agents.delete', { id: a.id }); done('Agent deleted.'); } catch (e) { fail(e); }
          } }, 'Delete'))));
    }
  
    // ---------- logs ----------
    async function renderLogs() {
      const d = await api('logs.list');
      const actionRows = d.actions.map((x) => h('tr', null,
        h('td', null, dateTime(x.created_at)), h('td', null, x.admin || '—'), h('td', null, x.action), h('td', null, x.target || '—')));
      const errRows = d.errors.map((x) => h('tr', null,
        h('td', null, dateTime(x.created_at)), h('td', null, x.email || '—'), h('td', null, x.agent || '—'), h('td', { class: 'wrap' }, x.message || '—')));
      view.replaceChildren(
        ...head('Logs', 'Recent admin actions and AI errors.'),
        h('h4', { style: 'margin:0 0 8px' }, 'AI errors (latest 50)'),
        table(['Time', 'User', 'Agent', 'Message'], errRows, 'No AI errors recorded.'),
        h('h4', { style: 'margin:22px 0 8px' }, 'Admin actions (latest 50)'),
        table(['Time', 'Admin', 'Action', 'Target'], actionRows, 'No admin actions yet.'));
    }
  
    // ---------- settings ----------
    async function renderSettings() {
      const s = await api('settings.get');
      const maint = h('input', { type: 'checkbox', checked: s.maintenance_mode });
      const models = h('textarea', { class: 'a-area', placeholder: 'one model id per line' }); models.value = s.fallback_models.join('\n');
      view.replaceChildren(
        ...head('Settings', 'Site-wide controls.'),
        h('div', { class: 'a-set' }, h('h4', null, 'Maintenance mode'),
          h('label', { class: 'a-check' }, maint, 'Pause the chat for everyone'),
          h('p', { class: 'a-help' }, 'While on, users see "We are performing maintenance" when they send a message. Admin pages keep working.')),
        h('div', { class: 'a-set' }, h('h4', null, 'Fallback AI models'),
          models,
          h('p', { class: 'a-help' }, 'Tried in order if a bot\'s own model fails (max 5). Use OpenRouter model ids, for example ones ending in ":free".')),
        h('button', { class: 'a-btn primary', onclick: async () => {
          try {
            await api('settings.set', { maintenance_mode: maint.checked, fallback_models: models.value.split('\n') });
            toast('Settings saved.');
          } catch (e) { fail(e); }
        } }, 'Save settings'));
    }
  
    // ---------- navigation ----------
    const TABS = [
      ['dashboard', 'Dashboard', renderDashboard],
      ['users', 'Users', renderUsers],
      ['plans', 'Plans', renderPlans],
      ['payments', 'Payments', renderPayments],
      ['agents', 'Agents', renderAgents],
      ['logs', 'Logs', renderLogs],
      ['settings', 'Settings', renderSettings],
    ];
  
    function show(key) {
      const tab = TABS.find((t) => t[0] === key) || TABS[0];
      document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.key === tab[0]));
      if (location.hash !== '#' + tab[0]) history.replaceState(null, '', '#' + tab[0]);
      view.replaceChildren(h('div', { class: 'a-empty' }, 'Loading…'));
      tab[2]().catch((e) => { view.replaceChildren(h('div', { class: 'a-empty' }, e.message || 'Could not load this page.')); });
    }
  
    TABS.forEach(([key, label]) => {
      const b = h('button', { 'data-key': key, type: 'button', onclick: () => show(key) }, label);
      $('nav').appendChild(b);
    });
    $('out').onclick = () => Auth.signOut();
    show(location.hash.slice(1));
  })();