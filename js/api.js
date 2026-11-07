// Minimal Supabase client (REST + RPC + Auth) without external libraries.
(function () {
  const { SUPABASE_URL, SUPABASE_KEY, TIMEZONE } = window.APP_CONFIG;
  const SESSION_KEY = 'barber_admin_session';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  };

  const ERRORS = {
    slot_taken: 'השעה הזו נתפסה הרגע. בחר שעה אחרת.',
    invalid_phone: 'מספר הטלפון לא תקין. צריך מספר נייד, למשל 050-1234567.',
    invalid_name: 'נא להזין שם מלא.',
    invalid_service: 'השירות לא זמין כרגע.',
    too_many_bookings: 'יש לך כבר 3 תורים פתוחים. לתור נוסף צור קשר עם המספרה.',
    not_found: 'התור לא נמצא. בדוק את הקישור.',
    not_active: 'התור הזה כבר בוטל או הסתיים.',
    already_started: 'אי אפשר לבטל תור שכבר התחיל.',
    late_requires_confirmation: 'ביטול מאוחר מחייב אישור.',
    invalid_day: 'התאריך לא זמין.',
    forbidden: 'אין הרשאה.',
    'Invalid login credentials': 'אימייל או סיסמה שגויים.',
    'Email not confirmed': 'צריך לאשר את האימייל לפני הכניסה. בדוק את תיבת הדואר.',
    'User already registered': 'כבר קיים משתמש עם האימייל הזה.'
  };

  function errorText(err) {
    const msg = (err && (err.message || err.msg || err.error_description || err.error)) || String(err);
    for (const key in ERRORS) if (msg.includes(key)) return ERRORS[key];
    return 'משהו השתבש. נסה שוב בעוד רגע.';
  }

  async function request(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
    const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
    if (auth) {
      const token = await getAccessToken();
      if (!token) throw new Error('not_signed_in');
      h.Authorization = 'Bearer ' + token;
    }
    const res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.msg || data.error_description || data.error)) || res.statusText);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const rpc = (name, args = {}, auth = false) =>
    request('/rest/v1/rpc/' + name, { method: 'POST', body: args, auth });

  // ---- Auth (admin only) ----
  function saveSession(s) {
    if (!s || !s.access_token) return null;
    const session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: Date.now() + (s.expires_in || 3600) * 1000,
      email: s.user && s.user.email
    };
    store.set(SESSION_KEY, session);
    return session;
  }

  async function getAccessToken() {
    let s = store.get(SESSION_KEY);
    if (!s) return null;
    if (Date.now() > s.expires_at - 60000) {
      try {
        const fresh = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
        s = saveSession(fresh);
      } catch (e) { store.del(SESSION_KEY); return null; }
    }
    return s && s.access_token;
  }

  const auth = {
    session: () => store.get(SESSION_KEY),
    async signIn(email, password) {
      return saveSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
    },
    async signUp(email, password) {
      const res = await request('/auth/v1/signup', { method: 'POST', body: { email, password, options: {} } });
      return saveSession(res);
    },
    async resetPassword(email) {
      return request('/auth/v1/recover', { method: 'POST', body: { email } });
    },
    async signOut() {
      try { await request('/auth/v1/logout', { method: 'POST', auth: true }); } catch (e) { /* ignore */ }
      store.del(SESSION_KEY);
    },
    // Supabase email links return tokens in the URL hash
    consumeUrlSession() {
      if (!location.hash.includes('access_token')) return null;
      const p = new URLSearchParams(location.hash.slice(1));
      const s = saveSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') || 3600 });
      history.replaceState(null, '', location.pathname);
      return { session: s, type: p.get('type') };
    },
    async updatePassword(password) {
      return request('/auth/v1/user', { method: 'PUT', body: { password }, auth: true });
    }
  };

  // ---- Table access (admin) ----
  const db = {
    select: (table, query = '') => request(`/rest/v1/${table}?${query}`, { auth: true }),
    insert: (table, rows) => request(`/rest/v1/${table}`, { method: 'POST', body: rows, auth: true, headers: { Prefer: 'return=representation' } }),
    update: (table, filter, values) => request(`/rest/v1/${table}?${filter}`, { method: 'PATCH', body: values, auth: true, headers: { Prefer: 'return=representation' } }),
    remove: (table, filter) => request(`/rest/v1/${table}?${filter}`, { method: 'DELETE', auth: true })
  };

  // ---- Formatting in the shop's time zone ----
  const fmt = {
    time: (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)),
    date: (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit' }).format(new Date(d)),
    dateLong: (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d)),
    weekdayShort: (isoDay) => ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][new Date(isoDay + 'T12:00:00Z').getUTCDay()],
    dayNum: (isoDay) => String(new Date(isoDay + 'T12:00:00Z').getUTCDate()),
    // YYYY-MM-DD of "today" in the shop's time zone
    todayIso: () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date()),
    isoDayOf: (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(d)),
    money: (n) => Math.round(Number(n)) + '₪',
    phoneDisplay: (p) => (p && p.length === 10) ? p.slice(0, 3) + '-' + p.slice(3) : (p || ''),
    whatsapp: (p) => 'https://wa.me/972' + String(p || '').replace(/\D/g, '').replace(/^0/, '')
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Visit logging (public pages only) ----
  function visitorId() {
    let id = null;
    try { id = localStorage.getItem('visitor_id'); } catch (e) { /* storage unavailable */ }
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      try { localStorage.setItem('visitor_id', id); } catch (e) { /* storage unavailable */ }
    }
    return id;
  }

  function browserName() {
    const ua = navigator.userAgent;
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
    if (/WhatsApp/i.test(ua)) return 'WhatsApp';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/SamsungBrowser/.test(ua)) return 'Samsung';
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    return 'אחר';
  }

  function logView() {
    const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'נייד' : 'מחשב';
    let ref = document.referrer || '';
    try { if (ref && new URL(ref).host === location.host) ref = ''; } catch (e) { /* bad referrer */ }
    rpc('log_view', {
      p_path: location.pathname, p_referrer: ref, p_device: device,
      p_browser: browserName(), p_visitor_id: visitorId()
    }).catch(() => { /* analytics must never break the page */ });
  }

  window.API = { rpc, request, auth, db, fmt, esc, errorText, visitorId, logView };
})();
