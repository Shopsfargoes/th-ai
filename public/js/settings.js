(async function () {
    const $ = (id) => document.getElementById(id);
    const session = await Auth.requireAuth();
    if (!session) return;
    const u = session.user, meta = u.user_metadata || {};
  
    function flash(id, text, info) {
      const el = $(id);
      el.textContent = text;
      el.classList.toggle('info', !!info);
      el.hidden = false;
    }
  
    // ----- profile -----
    $('email').value = u.email || '';
    $('fullName').value = meta.full_name || meta.name || '';
    $('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('profileMsg').hidden = true;
      const name = $('fullName').value.trim().slice(0, 80);
      const r1 = await sb.auth.updateUser({ data: { full_name: name } });
      const r2 = await sb.from('profiles').update({ full_name: name || null }).eq('id', u.id);
      if (r1.error || r2.error) return flash('profileMsg', 'Could not save your changes. Please try again.');
      flash('profileMsg', 'Saved.', true);
    });
  
    // ----- password -----
    $('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('pwMsg').hidden = true;
      const a = $('pw1').value, b = $('pw2').value;
      if (a.length < 8) return flash('pwMsg', 'Password must be at least 8 characters.');
      if (a !== b) return flash('pwMsg', 'The two passwords do not match.');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) {
        const m = (error.message || '').toLowerCase();
        if (m.includes('same') || m.includes('different')) return flash('pwMsg', 'Choose a password different from your current one.');
        if (m.includes('reauth') || m.includes('recent')) return flash('pwMsg', 'For security, log out and log back in, then try again.');
        return flash('pwMsg', 'Could not update your password. Please try again.');
      }
      $('pw1').value = ''; $('pw2').value = '';
      flash('pwMsg', 'Password updated.', true);
    });
  
    // ----- plan and usage -----
    const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    try {
      const r = await fetch('/api/usage', { headers: { Authorization: 'Bearer ' + session.access_token } });
      const j = await r.json();
      const box = $('planBox');
      box.innerHTML = '';
      const row = (k, v) => {
        const d = document.createElement('div'); d.className = 'row';
        const a = document.createElement('span'); a.textContent = k;
        const b = document.createElement('span'); b.textContent = v;
        d.append(a, b); box.appendChild(d);
      };
      row('Current plan', j.plan);
      if (j.ends_at) row('Renews or ends', fmtDate(j.ends_at));
      row('Requests today', j.limit != null ? j.used + ' of ' + Number(j.limit).toLocaleString() : j.used + ' (unlimited)');
      if (j.limit != null && j.limit > 0) {
        const bar = document.createElement('div'); bar.className = 'bar';
        const fill = document.createElement('div');
        fill.style.width = Math.min(100, Math.round((j.used / j.limit) * 100)) + '%';
        bar.appendChild(fill); box.appendChild(bar);
      }
    } catch (e) {
      $('planBox').textContent = 'Could not load your plan right now.';
    }
  
    // ----- payment history -----
    const { data: pays, error: payErr } = await sb.from('payments')
      .select('created_at, amount_kobo, status, plans(name)').order('created_at', { ascending: false }).limit(10);
    const pb = $('payBox');
    pb.innerHTML = '';
    if (payErr) { pb.textContent = 'Could not load your payments right now.'; }
    else if (!pays.length) { pb.innerHTML = '<span class="muted">No payments yet.</span>'; }
    else {
      const t = document.createElement('table'); t.className = 'hist';
      pays.forEach((p) => {
        const tr = document.createElement('tr');
        const c1 = document.createElement('td'); c1.textContent = fmtDate(p.created_at);
        const c2 = document.createElement('td'); c2.textContent = p.plans ? p.plans.name : '—';
        const c3 = document.createElement('td'); c3.textContent = '₦' + (Number(p.amount_kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
        const c4 = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = 'pill' + (p.status === 'success' ? ' ok' : p.status === 'failed' ? ' bad' : '');
        pill.textContent = p.status === 'success' ? 'Paid' : p.status === 'failed' ? 'Failed' : 'Pending';
        c4.appendChild(pill);
        tr.append(c1, c2, c3, c4); t.appendChild(tr);
      });
      pb.appendChild(t);
    }
  
    $('logout').onclick = () => Auth.signOut();
  })();