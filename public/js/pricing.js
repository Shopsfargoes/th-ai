(async function () {
    const $ = (id) => document.getElementById(id);
    const msg = $('msg');
    const showMsg = (t) => { msg.textContent = t; msg.hidden = false; };
  
    const session = await Auth.session();
    let currentPlan = null;
    if (session) {
      $('navLink').textContent = 'Back to chat';
      $('navLink').href = '/chat';
      try {
        const r = await fetch('/api/usage', { headers: { Authorization: 'Bearer ' + session.access_token } });
        if (r.ok) currentPlan = (await r.json()).plan;
      } catch (e) { /* ignore */ }
    }
  
    const { data: plans, error } = await sb.from('plans')
      .select('code, name, price_ngn, requests_per_day, history_days, support_level').order('id');
    if (error || !plans) { showMsg('We could not load the plans. Please refresh the page.'); return; }
  
    const HISTORY = { 30: '1 month of history', 90: '3 months of history', 365: '1 year of history' };
    const SUPPORT = { basic: 'Basic customer support', '24/7': '24/7 customer support', premium: 'Premium customer support', unlimited: 'Unlimited customer support' };
    const CTA = { basic: "Let's begin", standard: 'Get started', premium: 'Go premium', custom: 'Get a quote' };
    const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
  
    plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'p-card' + (p.code === 'standard' ? ' pop' : '');
      if (p.code === 'standard') card.innerHTML = '<span class="p-badge">Popular</span>';
  
      const h = document.createElement('h3'); h.textContent = p.name;
      const price = document.createElement('div'); price.className = 'p-price';
      price.innerHTML = p.price_ngn ? naira(p.price_ngn) + ' <small>/ month</small>' : 'Let\'s talk';
  
      const ul = document.createElement('ul'); ul.className = 'p-feats';
      const feats = [
        p.requests_per_day ? p.requests_per_day.toLocaleString() + ' requests per day' : 'Unlimited requests per day',
        p.history_days ? (HISTORY[p.history_days] || p.history_days + ' days of history') : 'Unlimited history',
        SUPPORT[p.support_level] || 'Customer support',
      ];
      feats.forEach((f) => { const li = document.createElement('li'); li.textContent = f; ul.appendChild(li); });
  
      const btn = document.createElement(p.price_ngn ? 'button' : 'a');
      btn.className = 'btn ' + (p.code === 'standard' ? 'btn-primary' : 'btn-outline');
      btn.style.textDecoration = 'none';
      btn.textContent = CTA[p.code] || 'Choose';
  
      if (currentPlan && currentPlan === p.name) {
        btn.textContent = 'Current plan';
        btn.disabled = true;
      } else if (!p.price_ngn) {
        const email = (window.TH_CONFIG || {}).CONTACT_EMAIL;
        if (email) btn.href = 'mailto:' + email + '?subject=' + encodeURIComponent('TH_AI custom plan');
        else btn.style.display = 'none';
      } else {
        btn.onclick = async () => {
          msg.hidden = true;
          if (!session) { location.href = '/signup'; return; }
          const original = btn.textContent;
          btn.disabled = true; btn.textContent = 'Redirecting…';
          try {
            const r = await fetch('/api/paystack-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
              body: JSON.stringify({ plan_code: p.code }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.authorization_url) throw new Error(j.error || 'We could not start the payment. Please try again.');
            location.href = j.authorization_url;
          } catch (e) {
            showMsg(e.message);
            btn.disabled = false; btn.textContent = original;
          }
        };
      }
  
      card.append(h, price, ul, btn);
      $('grid').appendChild(card);
    });
  })();