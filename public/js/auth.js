// Shared auth helpers. Load after config.js, the supabase-js CDN script and supabase.js.
const Auth = {
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    async requireAuth() {
      const s = await this.session();
      if (!s) { location.replace('/login'); return null; }
      return s;
    },
    async redirectIfAuthed() {
      const s = await this.session();
      if (s) location.replace('/chat');
    },
    async signOut() {
      await sb.auth.signOut();
      location.replace('/login');
    },
    async google() {
      return sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + '/chat' },
      });
    },
  };
  
  function friendlyError(err) {
    const m = (err && err.message ? err.message : '').toLowerCase();
    if (m.includes('invalid login')) return 'Incorrect email or password.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Try logging in.';
    if (m.includes('password should be') || m.includes('at least')) return 'Password must be at least 8 characters.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
    if (m.includes('provider') && m.includes('not')) return 'Google sign-in is not available yet.';
    if (m.includes('valid email') || m.includes('invalid email')) return 'Please enter a valid email address.';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Connection problem. Check your internet and try again.';
    return 'Something went wrong. Please try again.';
  }
  
  function showAlert(el, msg, info) {
    el.textContent = msg;
    el.classList.toggle('info', !!info);
    el.hidden = false;
  }
  function setLoading(btn, on, label) {
    if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
    else { btn.innerHTML = label || btn.dataset.label; btn.disabled = false; }
  }
  function wirePasswordToggle(input, btn) {
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
    });
  }