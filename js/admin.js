(function () {
  const { rpc, auth, db, fmt, esc, errorText } = window.API;
  const TZ = window.APP_CONFIG.TIMEZONE;
  const app = document.getElementById('app');
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const STATUS = { booked: 'מתוכנן', completed: 'הושלם', no_show: 'לא הגיע', cancelled: 'בוטל', late_cancelled: 'ביטול מאוחר' };
  const WL_STATUS = { waiting: 'ממתין', slot_opened: 'התפנה מקום', contacted: 'נוצר קשר', closed: 'סגור' };
  const NT_TYPE = { confirmation: 'אישור תור', reminder: 'תזכורת בוקר', cancellation: 'ביטול' };
  const NT_STATUS = { pending: 'ממתינה', sent: 'נשלחה', cancelled: 'בוטלה', failed: 'נכשלה' };
  let biz = null;
  let services = [];

  // ---------- time helpers (Asia/Jerusalem) ----------
  function tzOffsetMs(date) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
  }
  // local "YYYY-MM-DD" + "HH:MM" in the shop's zone -> Date
  function zoned(isoDay, hhmm = '00:00') {
    const [y, m, d] = isoDay.split('-').map(Number);
    const [hh, mm] = hhmm.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let t = guess - tzOffsetMs(new Date(guess));
    t = guess - tzOffsetMs(new Date(t));
    return new Date(t);
  }
  const addDays = (isoDay, n) => { const d = new Date(isoDay + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const today = () => fmt.todayIso();
  const dayRange = (isoDay, n = 1) => `starts_at=gte.${zoned(isoDay).toISOString()}&starts_at=lt.${zoned(addDays(isoDay, n)).toISOString()}`;
  const hhmm = (t) => (t || '').slice(0, 5);
  const longDay = (isoDay) => fmt.dateLong(isoDay + 'T12:00:00Z');

  // ---------- ui helpers ----------
  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  const fail = (err) => {
    if (String(err && err.message).includes('not_signed_in') || (err && err.status === 401)) { renderAuth('login', 'פג תוקף ההתחברות. היכנס שוב.'); return; }
    toast(errorText(err), true);
  };
  const ICON = {
    phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    wa: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21z"/></svg>'
  };
  const phoneLinks = (p, text) => `
    <a class="sbtn" href="tel:${esc(p)}" aria-label="התקשר ${esc(fmt.phoneDisplay(p))}">${ICON.phone}<span dir="ltr">${esc(fmt.phoneDisplay(p))}</span></a>
    <a class="sbtn wa" href="${fmt.whatsapp(p)}${text ? '?text=' + encodeURIComponent(text) : ''}" target="_blank" rel="noopener">${ICON.wa}וואטסאפ</a>`;
  const siteUrl = () => (biz && biz.site_url ? biz.site_url.replace(/\/$/, '') : location.origin + location.pathname.replace(/admin\.html$/, '').replace(/\/$/, ''));

  // ================= AUTH =================
  function renderAuth(mode = 'login', message = '') {
    const titles = { login: 'כניסת מנהל', signup: 'יצירת חשבון מנהל', reset: 'שחזור סיסמה', newpass: 'סיסמה חדשה' };
    app.innerHTML = `
      <div class="auth-box">
        <div class="card">
          <h1>${titles[mode]}</h1>
          <p class="hint" style="margin:0 0 18px">${mode === 'signup' ? 'החשבון הראשון שנפתח הופך למנהל היחיד של האתר.' : mode === 'reset' ? 'נשלח אליך קישור לאיפוס הסיסמה.' : mode === 'newpass' ? 'בחר סיסמה חדשה לחשבון.' : 'אזור הניהול של המספרה.'}</p>
          <form id="auth-form" novalidate>
            ${mode !== 'newpass' ? '<label class="field">אימייל<input name="email" type="email" autocomplete="email" required dir="ltr"></label>' : ''}
            ${mode !== 'reset' ? `<label class="field">סיסמה<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="8" dir="ltr"></label>` : ''}
            <button class="btn btn-dark btn-block" type="submit">${{ login: 'כניסה', signup: 'צור חשבון', reset: 'שלח קישור', newpass: 'שמור סיסמה' }[mode]}</button>
            <div id="auth-msg" role="alert">${message ? `<div class="alert ${/נשלח|נוצר|נשמרה/.test(message) ? 'ok' : 'error'}">${esc(message)}</div>` : ''}</div>
          </form>
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:10px">
            ${mode === 'login' ? '<button class="linkbtn" data-mode="reset">שכחתי סיסמה</button><button class="linkbtn" data-mode="signup">פעם ראשונה? יצירת חשבון</button>' : '<button class="linkbtn" data-mode="login">חזרה לכניסה</button>'}
          </div>
        </div>
        <p class="hint" style="text-align:center;margin-top:16px"><a href="./">לאתר הלקוחות</a></p>
      </div>`;
    app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const msg = document.getElementById('auth-msg');
      const email = f.email ? f.email.value.trim() : '';
      const password = f.password ? f.password.value : '';
      if (f.email && !/^\S+@\S+\.\S+$/.test(email)) { msg.innerHTML = '<div class="alert error">נא להזין אימייל תקין.</div>'; return; }
      if (f.password && password.length < 8) { msg.innerHTML = '<div class="alert error">סיסמה של 8 תווים לפחות.</div>'; return; }
      const btn = f.querySelector('button'); btn.disabled = true;
      try {
        if (mode === 'login') { await auth.signIn(email, password); return boot(); }
        if (mode === 'signup') {
          const s = await auth.signUp(email, password);
          if (s) return boot();
          return renderAuth('login', 'החשבון נוצר. שלחנו אליך מייל לאישור. אחרי האישור אפשר להיכנס.');
        }
        if (mode === 'reset') { await auth.resetPassword(email); return renderAuth('login', 'נשלח מייל עם קישור לאיפוס.'); }
        if (mode === 'newpass') { await auth.updatePassword(password); toast('הסיסמה נשמרה'); return boot(); }
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`;
        btn.disabled = false;
      }
    });
  }

  // ================= SHELL =================
  const TABS = [
    ['today', 'היום'], ['calendar', 'יומן תורים'], ['hours', 'שעות פעילות'], ['services', 'שירותים'],
    ['customers', 'לקוחות וחובות'], ['waitlist', 'רשימת המתנה'], ['stats', 'צפיות באתר'], ['outbox', 'הודעות'], ['settings', 'הגדרות']
  ];
  const VIEWS = {};
  let badges = {};

  function renderShell() {
    const s = auth.session();
    app.innerHTML = `
      <header class="admin-top"><div class="inner">
        <a class="brand" href="#today">${esc(biz.name)}<small>ניהול</small></a>
        <div style="display:flex;gap:6px;align-items:center">
          <a class="sbtn" style="background:transparent;border-color:#444" href="./" target="_blank" rel="noopener">לאתר</a>
          <button class="sbtn" style="background:transparent;border-color:#444" id="logout" title="${esc(s && s.email || '')}">יציאה</button>
        </div>
      </div></header>
      <nav class="tabs" aria-label="אזורי ניהול"><div class="inner">
        ${TABS.map(([id, label]) => `<a href="#${id}" data-tab="${id}">${label}<span class="dot" data-badge="${id}" hidden></span></a>`).join('')}
      </div></nav>
      <main class="view" id="view" tabindex="-1"></main>`;
    document.getElementById('logout').addEventListener('click', async () => { await auth.signOut(); renderAuth('login'); });
    route();
    refreshBadges();
  }

  async function refreshBadges() {
    try {
      const wl = await db.select('waitlist', `select=id&status=eq.slot_opened&day=gte.${today()}`);
      badges.waitlist = wl.length;
    } catch (e) { /* ignore */ }
    Object.entries(badges).forEach(([k, v]) => {
      const el = document.querySelector(`[data-badge="${k}"]`);
      if (el) { el.hidden = !v; el.textContent = v; }
    });
  }

  async function route() {
    const id = (location.hash.slice(1) || 'today').split('?')[0];
    const tab = VIEWS[id] ? id : 'today';
    document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
    const cur = document.querySelector('.tabs a[aria-current="page"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<div class="skeleton" style="height:36px;width:40%;margin:8px 0 18px"></div><div class="skeleton" style="height:240px"></div>';
    try { await VIEWS[tab](view); } catch (err) { fail(err); view.innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`; }
  }
  window.addEventListener('hashchange', () => { if (document.getElementById('view')) route(); });

  // ---------- shared: bookings list ----------
  async function openDebtsByCustomer(customerIds) {
    if (!customerIds.length) return {};
    const rows = await db.select('debts', `select=customer_id,amount&paid_at=is.null&customer_id=in.(${customerIds.join(',')})`);
    const out = {};
    rows.forEach((r) => { out[r.customer_id] = (out[r.customer_id] || 0) + Number(r.amount); });
    return out;
  }

  function bookingRow(b, debts, opts = {}) {
    const c = b.customers || {};
    const past = new Date(b.ends_at) < new Date();
    const debt = debts[b.customer_id];
    const active = b.status === 'booked';
    return `
      <div class="bk ${['cancelled', 'late_cancelled'].includes(b.status) ? 'dim' : ''}" data-id="${b.id}">
        <div class="time">${fmt.time(b.starts_at)}<small>${opts.showDate ? esc(fmt.date(b.starts_at)) + ' · ' : ''}עד ${fmt.time(b.ends_at)}</small></div>
        <div>
          <div class="who"><b>${esc(c.full_name || '—')}</b><span class="chip ${b.status}">${STATUS[b.status]}</span>
            ${debt ? `<span class="chip debt" title="חוב פתוח">חוב ${fmt.money(debt)}</span>` : ''}</div>
          <div class="meta">${esc(b.service_name)} · ${fmt.money(b.price)}</div>
        </div>
        <div class="acts">
          ${c.phone ? phoneLinks(c.phone) : ''}
          ${active ? `
            <button class="sbtn" data-act="completed">הושלם</button>
            <button class="sbtn" data-act="no_show">לא הגיע</button>
            ${!past ? '<button class="sbtn red" data-act="cancel">ביטול</button><button class="sbtn red" data-act="cancel-charge">ביטול + חיוב</button>' : ''}` : ''}
          ${!active && ['completed', 'no_show'].includes(b.status) ? '<button class="sbtn" data-act="booked">החזר למתוכנן</button>' : ''}
        </div>
      </div>`;
  }

  function wireBookingActions(container, reload) {
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('.bk').dataset.id;
      const act = btn.dataset.act;
      try {
        if (act === 'cancel') {
          if (!confirm('לבטל את התור? הלקוח לא יחויב.')) return;
          await rpc('admin_cancel_booking', { p_id: id, p_charge: false }, true);
          toast('התור בוטל. מי שברשימת ההמתנה לאותו יום סומן.');
        } else if (act === 'cancel-charge') {
          if (!confirm('לבטל ולרשום ללקוח חוב במחיר המלא?')) return;
          await rpc('admin_cancel_booking', { p_id: id, p_charge: true }, true);
          toast('התור בוטל ונרשם חוב.');
        } else {
          btn.disabled = true;
          await db.update('bookings', `id=eq.${id}`, { status: act });
          toast('עודכן');
        }
        reload();
      } catch (err) { fail(err); btn.disabled = false; }
    });
  }

  const BK_SELECT = 'select=id,customer_id,service_name,price,starts_at,ends_at,status,customers(full_name,phone)';

  // ================= TODAY =================
  VIEWS.today = async (view) => {
    const t = today();
    const weekStart = addDays(t, -new Date(t + 'T12:00:00Z').getUTCDay());
    const [todayB, weekB, debts, wl] = await Promise.all([
      db.select('bookings', `${BK_SELECT}&${dayRange(t)}&order=starts_at`),
      db.select('bookings', `select=id,price,status,starts_at,customer_id,service_name,ends_at,customers(full_name,phone)&${dayRange(weekStart, 7)}&order=starts_at`),
      db.select('debts', 'select=amount&paid_at=is.null'),
      db.select('waitlist', `select=id&status=eq.slot_opened&day=gte.${t}`)
    ]);
    const live = (b) => ['booked', 'completed'].includes(b.status);
    const weekLive = weekB.filter(live);
    const debtsBy = await openDebtsByCustomer([...new Set(weekB.map((b) => b.customer_id))]);
    const upcoming = weekB.filter((b) => b.status === 'booked' && fmt.isoDayOf(b.starts_at) > t);
    const todayLive = todayB.filter(live);
    view.innerHTML = `
      <h1>${esc(longDay(t))}</h1>
      <div class="tiles">
        <div class="tile"><div class="v">${todayLive.length}</div><div class="l">תורים היום · ${fmt.money(todayLive.reduce((s, b) => s + Number(b.price), 0))}</div></div>
        <div class="tile"><div class="v">${weekLive.length}</div><div class="l">תורים השבוע</div></div>
        <div class="tile"><div class="v">${fmt.money(weekLive.reduce((s, b) => s + Number(b.price), 0))}</div><div class="l">הכנסה צפויה השבוע</div></div>
        <a class="tile ${wl.length ? 'hot' : ''}" href="${wl.length ? '#waitlist' : '#customers'}" style="text-decoration:none">
          ${wl.length ? `<div class="v">${wl.length}</div><div class="l">התפנה מקום, יש ממתינים</div>` : `<div class="v">${fmt.money(debts.reduce((s, d) => s + Number(d.amount), 0))}</div><div class="l">חובות פתוחים</div>`}
        </a>
      </div>
      <div class="grid2">
        <section class="panel"><div class="toolbar" style="justify-content:space-between;margin:0 0 4px"><h2 style="margin:0">היום</h2><a class="sbtn dark" href="#calendar">+ תור ידני</a></div>
          <div id="today-list">${todayB.length ? todayB.map((b) => bookingRow(b, debtsBy)).join('') : '<div class="empty">אין תורים היום</div>'}</div></section>
        <section class="panel"><h2>בהמשך השבוע</h2>
          <div id="week-list">${upcoming.length ? upcoming.map((b) => bookingRow(b, debtsBy, { showDate: true })).join('') : '<div class="empty">אין עוד תורים השבוע</div>'}</div></section>
      </div>`;
    wireBookingActions(view.querySelector('#today-list'), route);
    wireBookingActions(view.querySelector('#week-list'), route);
  };

  // ================= CALENDAR =================
  VIEWS.calendar = async (view) => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '') ? q.get('d') : today();
    const [rows, ov, bl] = await Promise.all([
      db.select('bookings', `${BK_SELECT}&${dayRange(day)}&order=starts_at`),
      db.select('date_overrides', `select=*&day=eq.${day}`),
      db.select('blocks', `select=*&starts_at=lt.${zoned(addDays(day, 1)).toISOString()}&ends_at=gt.${zoned(day).toISOString()}`)
    ]);
    const debtsBy = await openDebtsByCustomer([...new Set(rows.map((b) => b.customer_id))]);
    const go = (d) => { location.hash = 'calendar?d=' + d; };
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    const weekly = (await db.select('weekly_hours', `select=start_time,end_time&weekday=eq.${dow}&order=start_time`));
    const hoursTxt = ov.some((o) => o.closed) ? 'סגור (יום מיוחד)'
      : ov.length ? ov.map((o) => hhmm(o.start_time) + '–' + hhmm(o.end_time)).join(', ') + ' (שעות מיוחדות)'
      : weekly.length ? weekly.map((w) => hhmm(w.start_time) + '–' + hhmm(w.end_time)).join(', ') : 'סגור';
    view.innerHTML = `
      <h1>יומן תורים</h1>
      <div class="toolbar">
        <button class="sbtn" id="prev" aria-label="יום קודם">→</button>
        <input type="date" id="d" value="${day}" aria-label="תאריך">
        <button class="sbtn" id="next" aria-label="יום הבא">←</button>
        <button class="sbtn" id="tod">היום</button>
      </div>
      <div class="grid2">
        <section class="panel">
          <h2>${esc(longDay(day))}</h2>
          <p class="muted" style="margin:-6px 0 8px">שעות: ${esc(hoursTxt)}${bl.length ? ' · חסום: ' + bl.map((b) => fmt.time(b.starts_at) + '–' + fmt.time(b.ends_at) + (b.reason ? ' ' + esc(b.reason) : '')).join(', ') : ''}</p>
          <div id="list">${rows.length ? rows.map((b) => bookingRow(b, debtsBy)).join('') : '<div class="empty">אין תורים ביום הזה</div>'}</div>
        </section>
        <section class="panel">
          <h2>הוספת תור ידני</h2>
          <p class="muted" style="margin:-6px 0 12px">לתורים שנקבעו בטלפון או בהודעה. אפשר גם מחוץ לשעות הפעילות, אבל לא על תור קיים.</p>
          <form id="add" class="form-grid" novalidate>
            <label class="field">שירות<select name="service" required>${services.map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.duration_min} דק׳</option>`).join('')}</select></label>
            <label class="field">שעה<input name="time" type="time" step="300" required></label>
            <label class="field">שם מלא<input name="name" required maxlength="60"></label>
            <label class="field">טלפון<input name="phone" type="tel" inputmode="tel" dir="ltr" required></label>
            <label class="field" style="flex-direction:row;align-items:center;gap:8px;min-height:44px"><input type="checkbox" name="notify" checked style="width:20px;height:20px;accent-color:#FF4D1F">הכן הודעת אישור ותזכורת</label>
            <button class="btn btn-dark" type="submit">הוסף תור</button>
          </form>
        </section>
      </div>`;
    view.querySelector('#prev').onclick = () => go(addDays(day, -1));
    view.querySelector('#next').onclick = () => go(addDays(day, 1));
    view.querySelector('#tod').onclick = () => go(today());
    view.querySelector('#d').onchange = (e) => e.target.value && go(e.target.value);
    wireBookingActions(view.querySelector('#list'), route);
    view.querySelector('#add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.time.value || f.name.value.trim().length < 2 || f.phone.value.replace(/\D/g, '').length < 9) { toast('נא למלא שעה, שם וטלפון', true); return; }
      const btn = f.querySelector('button'); btn.disabled = true;
      try {
        await rpc('admin_create_booking', { p_service: f.service.value, p_starts_at: zoned(day, f.time.value).toISOString(), p_full_name: f.name.value, p_phone: f.phone.value, p_notify: f.notify.checked }, true);
        toast('התור נוסף');
        route();
      } catch (err) { fail(err); btn.disabled = false; }
    });
  };

  // ================= HOURS =================
  VIEWS.hours = async (view) => {
    const t = today();
    const [weekly, overrides, blocks] = await Promise.all([
      db.select('weekly_hours', 'select=*&order=weekday,start_time'),
      db.select('date_overrides', `select=*&day=gte.${t}&order=day,start_time`),
      db.select('blocks', `select=*&ends_at=gte.${new Date().toISOString()}&order=starts_at`)
    ]);
    const byDay = DAYS.map((_, i) => weekly.filter((w) => w.weekday === i).map((w) => [hhmm(w.start_time), hhmm(w.end_time)]));
    const rangeHtml = (s = '09:00', e = '20:00') => `<div class="range"><input type="time" value="${s}" step="300" aria-label="משעה"><span>עד</span><input type="time" value="${e}" step="300" aria-label="עד שעה"><button type="button" class="sbtn red" data-del aria-label="הסר טווח">✕</button></div>`;
    const ovByDay = {};
    overrides.forEach((o) => { (ovByDay[o.day] = ovByDay[o.day] || []).push(o); });
    view.innerHTML = `
      <h1>שעות פעילות</h1>
      <div class="grid2">
        <section class="panel">
          <h2>שבוע קבוע</h2>
          <p class="muted" style="margin:-6px 0 6px">אפשר כמה טווחים ביום (למשל הפסקת צהריים). יום בלי טווחים = סגור.</p>
          <div id="weekly">${byDay.map((ranges, i) => `
            <div class="wh-row" data-wd="${i}"><div class="dn">${DAYS[i]}</div>
              <div><div class="ranges">${ranges.map(([s, e]) => rangeHtml(s, e)).join('') || '<div class="closed-lbl">סגור</div>'}</div>
              <button type="button" class="linkbtn" data-add>+ הוסף טווח שעות</button></div></div>`).join('')}</div>
          <button class="btn btn-dark btn-block" id="save-weekly" style="margin-top:10px">שמור שבוע קבוע</button>
        </section>
        <div>
          <section class="panel">
            <h2>שינוי ליום מסוים</h2>
            <form id="special" class="form-grid" novalidate>
              <label class="field">תאריך<input type="date" name="day" min="${t}" required></label>
              <label class="field">משעה<input type="time" name="from" value="10:00" step="300"></label>
              <label class="field">עד שעה<input type="time" name="to" value="16:00" step="300"></label>
              <label class="field">הערה<input name="note" maxlength="80" placeholder="אופציונלי"></label>
              <button class="btn btn-dark" type="submit">קבע שעות ליום הזה</button>
            </form>
          </section>
          <section class="panel">
            <h2>חסימת שעות</h2>
            <p class="muted" style="margin:-6px 0 12px">הפסקה, סידור או פגישה. לקוחות לא יוכלו לקבוע בזמן הזה.</p>
            <form id="block" class="form-grid" novalidate>
              <label class="field">תאריך<input type="date" name="day" min="${t}" required></label>
              <label class="field">משעה<input type="time" name="from" value="13:00" step="300" required></label>
              <label class="field">עד שעה<input type="time" name="to" value="14:00" step="300" required></label>
              <label class="field">סיבה<input name="reason" maxlength="80" placeholder="אופציונלי"></label>
              <button class="btn btn-dark" type="submit">חסום</button>
            </form>
          </section>
          <section class="panel">
            <h2>סגירת ימים / חופשה</h2>
            <form id="close" class="form-grid" novalidate>
              <label class="field">מתאריך<input type="date" name="from" min="${t}" required></label>
              <label class="field">עד תאריך<input type="date" name="to" min="${t}" required></label>
              <label class="field">הערה<input name="note" maxlength="80" placeholder="חופשה"></label>
              <button class="btn btn-dark" type="submit">סגור ימים</button>
            </form>
          </section>
          <section class="panel">
            <h2>שינויים קרובים</h2>
            <div id="upcoming">
              ${Object.entries(ovByDay).map(([d, list]) => `<div class="list-row"><div><b>${esc(longDay(d))}</b><div class="muted">${list.some((o) => o.closed) ? 'סגור' : list.map((o) => hhmm(o.start_time) + '–' + hhmm(o.end_time)).join(', ')}${list[0].note ? ' · ' + esc(list[0].note) : ''}</div></div><button class="sbtn red" data-ovday="${d}">בטל שינוי</button></div>`).join('')}
              ${blocks.map((b) => `<div class="list-row"><div><b>${esc(fmt.dateLong(b.starts_at))}</b><div class="muted">חסום ${fmt.time(b.starts_at)}–${fmt.time(b.ends_at)}${b.reason ? ' · ' + esc(b.reason) : ''}</div></div><button class="sbtn red" data-block="${b.id}">הסר חסימה</button></div>`).join('')}
              ${!overrides.length && !blocks.length ? '<div class="empty">אין שינויים קרובים</div>' : ''}
            </div>
          </section>
        </div>
      </div>`;

    const weeklyEl = view.querySelector('#weekly');
    weeklyEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) {
        const ranges = e.target.closest('.wh-row').querySelector('.ranges');
        const closed = ranges.querySelector('.closed-lbl');
        if (closed) closed.remove();
        const last = ranges.querySelectorAll('.range input');
        const startAt = last.length ? last[last.length - 1].value : '09:00';
        ranges.insertAdjacentHTML('beforeend', last.length ? rangeHtml(startAt, '20:00') : rangeHtml());
      }
      if (e.target.closest('[data-del]')) {
        const ranges = e.target.closest('.ranges');
        e.target.closest('.range').remove();
        if (!ranges.children.length) ranges.innerHTML = '<div class="closed-lbl">סגור</div>';
      }
    });
    view.querySelector('#save-weekly').addEventListener('click', async (e) => {
      const rows = [];
      for (const row of weeklyEl.querySelectorAll('.wh-row')) {
        for (const r of row.querySelectorAll('.range')) {
          const [s, en] = [...r.querySelectorAll('input')].map((i) => i.value);
          if (!s || !en || en <= s) { toast(`טווח לא תקין ביום ${DAYS[row.dataset.wd]}`, true); return; }
          rows.push({ business_id: biz.id, weekday: +row.dataset.wd, start_time: s, end_time: en });
        }
      }
      e.target.disabled = true;
      try {
        await db.remove('weekly_hours', `business_id=eq.${biz.id}`);
        if (rows.length) await db.insert('weekly_hours', rows);
        toast('השבוע הקבוע נשמר');
        route();
      } catch (err) { fail(err); e.target.disabled = false; }
    });
    view.querySelector('#special').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.day.value || !f.from.value || !f.to.value || f.to.value <= f.from.value) { toast('נא לבחור תאריך וטווח שעות תקין', true); return; }
      try {
        await db.remove('date_overrides', `day=eq.${f.day.value}`);
        await db.insert('date_overrides', [{ business_id: biz.id, day: f.day.value, closed: false, start_time: f.from.value, end_time: f.to.value, note: f.note.value || null }]);
        toast('נשמר'); route();
      } catch (err) { fail(err); }
    });
    view.querySelector('#block').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.day.value || f.to.value <= f.from.value) { toast('נא לבחור תאריך וטווח שעות תקין', true); return; }
      try { await rpc('admin_add_block', { p_day: f.day.value, p_from: f.from.value, p_to: f.to.value, p_reason: f.reason.value }, true); toast('נחסם'); route(); }
      catch (err) { fail(err); }
    });
    view.querySelector('#close').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.from.value || !f.to.value || f.to.value < f.from.value) { toast('נא לבחור טווח תאריכים תקין', true); return; }
      try {
        const r = await rpc('admin_close_days', { p_from: f.from.value, p_to: f.to.value, p_note: f.note.value }, true);
        toast(`נסגרו ${r.days} ימים`); route();
      } catch (err) { fail(err); }
    });
    view.querySelector('#upcoming').addEventListener('click', async (e) => {
      const ov = e.target.closest('[data-ovday]');
      const bl = e.target.closest('[data-block]');
      try {
        if (ov) { await db.remove('date_overrides', `day=eq.${ov.dataset.ovday}`); toast('היום חזר לשעות הרגילות'); route(); }
        if (bl) { await db.remove('blocks', `id=eq.${bl.dataset.block}`); toast('החסימה הוסרה'); route(); }
      } catch (err) { fail(err); }
    });
  };

  // ================= SERVICES =================
  VIEWS.services = async (view) => {
    const rows = await db.select('services', 'select=*&order=sort,created_at');
    const row = (s) => `
      <form class="svc-edit" data-id="${s ? s.id : ''}" novalidate>
        <label class="field">שם השירות<input name="name" value="${esc(s ? s.name : '')}" required maxlength="60"></label>
        <label class="field">תיאור קצר<input name="description" value="${esc(s && s.description || '')}" maxlength="120" placeholder="אופציונלי"></label>
        <label class="field">מחיר ₪<input name="price" type="number" min="0" step="1" value="${s ? Number(s.price) : ''}" required inputmode="numeric"></label>
        <label class="field">דקות<input name="duration" type="number" min="5" max="480" step="5" value="${s ? s.duration_min : 30}" required inputmode="numeric"></label>
        <div class="row-acts">
          <button class="sbtn dark" type="submit">${s ? 'שמור' : 'הוסף שירות'}</button>
          ${s ? `<label style="display:flex;gap:6px;align-items:center;min-height:40px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} style="width:20px;height:20px;accent-color:#FF4D1F">מוצג ללקוחות</label>
          <label style="display:flex;gap:6px;align-items:center">סדר<input name="sort" type="number" value="${s.sort}" style="width:64px;min-height:40px;border:1px solid #CFCFCA;border-radius:4px;padding:0 6px"></label>` : ''}
        </div>
      </form>`;
    view.innerHTML = `
      <h1>שירותים ומחירים</h1>
      <section class="panel" id="list">${rows.map(row).join('')}</section>
      <section class="panel"><h2>שירות חדש</h2>${row(null)}</section>
      <p class="muted">שינוי מחיר משפיע רק על תורים חדשים. תורים קיימים שומרים את המחיר שנקבע.</p>`;
    view.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const values = { name: f.name.value.trim(), description: f.description.value.trim() || null, price: +f.price.value, duration_min: +f.duration.value };
      if (!values.name || !(values.price >= 0) || !(values.duration_min >= 5)) { toast('נא למלא שם, מחיר ומשך', true); return; }
      try {
        if (f.dataset.id) {
          values.active = f.active.checked; values.sort = +f.sort.value || 0;
          await db.update('services', `id=eq.${f.dataset.id}`, values);
        } else {
          await db.insert('services', [{ ...values, business_id: biz.id, sort: rows.length + 1 }]);
        }
        services = await db.select('services', 'select=*&order=sort');
        toast('נשמר'); route();
      } catch (err) { fail(err); }
    });
  };

  // ================= CUSTOMERS =================
  VIEWS.customers = async (view) => {
    const rows = await db.select('customers', 'select=id,full_name,phone,notes,created_at,bookings(id,starts_at,service_name,status,price),debts(id,amount,reason,paid_at,created_at)&order=created_at.desc&limit=1000');
    rows.forEach((c) => {
      c.openDebt = c.debts.filter((d) => !d.paid_at).reduce((s, d) => s + Number(d.amount), 0);
      c.visits = c.bookings.filter((b) => b.status === 'completed').length;
      const past = c.bookings.filter((b) => new Date(b.starts_at) < new Date() && ['completed', 'booked'].includes(b.status)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      c.last = past[0] && past[0].starts_at;
      c.next = c.bookings.filter((b) => b.status === 'booked' && new Date(b.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    });
    const totalDebt = rows.reduce((s, c) => s + c.openDebt, 0);
    view.innerHTML = `
      <h1>לקוחות וחובות</h1>
      <div class="tiles">
        <div class="tile"><div class="v">${rows.length}</div><div class="l">לקוחות</div></div>
        <div class="tile ${totalDebt ? 'hot' : ''}"><div class="v">${fmt.money(totalDebt)}</div><div class="l">חובות פתוחים · ${rows.filter((c) => c.openDebt).length} לקוחות</div></div>
      </div>
      <div class="toolbar">
        <input type="search" class="grow" id="q" placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש לקוח">
        <label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" id="only-debt" style="width:20px;height:20px;accent-color:#FF4D1F">רק עם חוב</label>
      </div>
      <section class="panel" id="list"></section>`;
    const list = view.querySelector('#list');
    const draw = () => {
      const q = view.querySelector('#q').value.trim().toLowerCase();
      const qd = q.replace(/\D/g, '');
      const onlyDebt = view.querySelector('#only-debt').checked;
      const shown = rows.filter((c) => (!onlyDebt || c.openDebt) && (!q || c.full_name.toLowerCase().includes(q) || (qd && c.phone.includes(qd))));
      list.innerHTML = shown.map((c) => `
        <details class="cust" data-id="${c.id}">
          <summary>
            <div><b>${esc(c.full_name)}</b> ${c.openDebt ? `<span class="chip debt">חוב ${fmt.money(c.openDebt)}</span>` : ''}
              <div class="muted"><span dir="ltr">${esc(fmt.phoneDisplay(c.phone))}</span> · ${c.visits} ביקורים${c.last ? ' · אחרון ' + fmt.date(c.last) : ''}${c.next ? ' · הבא ' + fmt.date(c.next.starts_at) : ''}</div></div>
            <span aria-hidden="true">▾</span>
          </summary>
          <div class="body">
            <div class="toolbar">${phoneLinks(c.phone)}</div>
            ${c.debts.length ? `<h2 style="font-size:16px">חובות</h2><table class="mini"><tbody>${c.debts.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((d) => `
              <tr><td>${fmt.date(d.created_at)}</td><td>${esc(d.reason || '')}</td><td><b>${fmt.money(d.amount)}</b></td>
              <td>${d.paid_at ? `<span class="chip completed">שולם ${fmt.date(d.paid_at)}</span>` : `<button class="sbtn orange" data-pay="${d.id}">סמן כשולם</button>`}</td></tr>`).join('')}</tbody></table>` : ''}
            <h2 style="font-size:16px;margin-top:14px">היסטוריית תורים</h2>
            ${c.bookings.length ? `<table class="mini"><tbody>${c.bookings.sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map((b) => `
              <tr><td>${fmt.date(b.starts_at)} ${fmt.time(b.starts_at)}</td><td>${esc(b.service_name)}</td><td>${fmt.money(b.price)}</td><td><span class="chip ${b.status}">${STATUS[b.status]}</span></td></tr>`).join('')}</tbody></table>` : '<div class="muted">אין תורים</div>'}
            <label class="field" style="margin-top:14px">הערות על הלקוח<textarea data-notes="${c.id}" maxlength="500">${esc(c.notes || '')}</textarea></label>
            <button class="sbtn dark" data-save-notes="${c.id}">שמור הערה</button>
          </div>
        </details>`).join('') || '<div class="empty">לא נמצאו לקוחות</div>';
    };
    view.querySelector('#q').addEventListener('input', draw);
    view.querySelector('#only-debt').addEventListener('change', draw);
    list.addEventListener('click', async (e) => {
      const pay = e.target.closest('[data-pay]');
      const notes = e.target.closest('[data-save-notes]');
      try {
        if (pay) {
          pay.disabled = true;
          await db.update('debts', `id=eq.${pay.dataset.pay}`, { paid_at: new Date().toISOString() });
          rows.forEach((c) => c.debts.forEach((d) => { if (d.id === pay.dataset.pay) d.paid_at = new Date().toISOString(); }));
          rows.forEach((c) => { c.openDebt = c.debts.filter((d) => !d.paid_at).reduce((s, d) => s + Number(d.amount), 0); });
          toast('החוב סומן כשולם');
          const open = pay.closest('details').dataset.id;
          draw();
          const el = list.querySelector(`details[data-id="${open}"]`); if (el) el.open = true;
        }
        if (notes) {
          const id = notes.dataset.saveNotes;
          const val = list.querySelector(`[data-notes="${id}"]`).value;
          await db.update('customers', `id=eq.${id}`, { notes: val || null });
          rows.find((c) => c.id === id).notes = val;
          toast('נשמר');
        }
      } catch (err) { fail(err); if (pay) pay.disabled = false; }
    });
    draw();
  };

  // ================= WAITLIST =================
  VIEWS.waitlist = async (view) => {
    const rows = await db.select('waitlist', `select=*,services(name)&day=gte.${today()}&status=neq.closed&order=day,created_at`);
    const byDay = {};
    rows.forEach((w) => { (byDay[w.day] = byDay[w.day] || []).push(w); });
    view.innerHTML = `
      <h1>רשימת המתנה</h1>
      <p class="muted" style="margin:-8px 0 14px">כשמתבטל תור ביום מסוים, כל הממתינים לאותו יום מסומנים בכתום. שלח להם הודעה בלחיצה.</p>
      ${Object.keys(byDay).length ? Object.entries(byDay).map(([d, list]) => `
        <section class="panel"><h2>${esc(longDay(d))}</h2>
          ${list.map((w) => {
            const msg = `היי ${w.full_name.split(' ')[0]}, כאן ${biz.name}. התפנה תור ביום ${longDay(d)}. רוצה לקבוע? ${siteUrl()}/`;
            return `<div class="list-row ${w.status === 'slot_opened' ? 'hl' : ''}" data-id="${w.id}">
              <div><b>${esc(w.full_name)}</b> <span class="chip ${w.status}">${WL_STATUS[w.status]}</span>
                <div class="muted">${w.services ? esc(w.services.name) + ' · ' : ''}${w.from_time ? 'מעדיף ' + hhmm(w.from_time) + '–' + hhmm(w.to_time) : 'כל שעה'}</div></div>
              <div class="toolbar" style="margin:0">${phoneLinks(w.phone, msg)}
                ${w.status !== 'contacted' ? '<button class="sbtn" data-st="contacted">נוצר קשר</button>' : ''}
                <button class="sbtn" data-st="closed">הסר</button></div>
            </div>`;
          }).join('')}
        </section>`).join('') : '<section class="panel"><div class="empty">אין ממתינים כרגע</div></section>'}`;
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      try { await db.update('waitlist', `id=eq.${b.closest('[data-id]').dataset.id}`, { status: b.dataset.st }); toast('עודכן'); refreshBadges(); route(); }
      catch (err) { fail(err); }
    });
  };

  // ================= STATS =================
  VIEWS.stats = async (view) => {
    const a = await rpc('admin_analytics', {}, true);
    const T = a.totals;
    const conv = T.uniques_30 ? Math.round((a.booked_visitors_30 / T.uniques_30) * 1000) / 10 : 0;
    const max = Math.max(1, ...a.per_day.map((d) => d.views));
    const hbar = (label, n, mx) => `<div class="hbar"><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${Math.round(n / mx * 100)}%"></div></div><span class="n">${n}</span></div>`;
    const refMax = Math.max(1, ...a.referrers.map((r) => r.views));
    const devMax = Math.max(1, ...a.devices.map((r) => r.views));
    view.innerHTML = `
      <h1>צפיות באתר</h1>
      <div class="tiles">
        <div class="tile"><div class="v">${T.views_today}</div><div class="l">צפיות היום · ${T.uniques_today} מבקרים</div></div>
        <div class="tile"><div class="v">${T.views_7}</div><div class="l">צפיות 7 ימים · ${T.uniques_7} מבקרים</div></div>
        <div class="tile"><div class="v">${T.views_30}</div><div class="l">צפיות 30 ימים · ${T.uniques_30} מבקרים</div></div>
        <div class="tile hot"><div class="v">${conv}%</div><div class="l">מהמבקרים קבעו תור (30 ימים)</div></div>
      </div>
      <section class="panel"><h2>צפיות ביום · 30 ימים אחרונים</h2>
        <div class="bars" role="img" aria-label="גרף צפיות יומיות">${a.per_day.map((d, i) => `<div class="b ${i === a.per_day.length - 1 ? 'today' : ''}" style="height:${Math.max(1, d.views / max * 100)}%" title="${fmt.date(d.day + 'T12:00:00Z')}: ${d.views}"></div>`).join('')}</div>
        <div class="bars-x"><span>${fmt.date(a.per_day[0].day + 'T12:00:00Z')}</span><span>${fmt.date(a.per_day[15].day + 'T12:00:00Z')}</span><span>היום</span></div>
      </section>
      <div class="grid2">
        <section class="panel"><h2>מאיפה הגיעו</h2>${a.referrers.length ? a.referrers.map((r) => hbar(r.source, r.views, refMax)).join('') : '<div class="empty">אין נתונים עדיין</div>'}</section>
        <section class="panel"><h2>מכשירים</h2>${a.devices.length ? a.devices.map((r) => hbar(r.device, r.views, devMax)).join('') : '<div class="empty">אין נתונים עדיין</div>'}</section>
      </div>
      <section class="panel"><h2>ביקורים אחרונים</h2>
        <div class="table-wrap"><table class="mini"><thead><tr><th>מתי</th><th>מי</th><th>עמוד</th><th>מקור</th><th>מכשיר</th></tr></thead><tbody>
        ${a.recent.map((r) => `<tr><td>${fmt.date(r.created_at)} ${fmt.time(r.created_at)}</td><td>${r.customer ? '<b>' + esc(r.customer) + '</b>' : '<span class="muted">מבקר אנונימי</span>'}</td><td dir="ltr" style="text-align:right">${esc(r.path)}</td><td>${esc(r.source)}</td><td>${esc(r.device || '')} · ${esc(r.browser || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">אין ביקורים עדיין</td></tr>'}
        </tbody></table></div>
        <p class="muted" style="margin:10px 0 0">מבקר שקבע תור מופיע בשמו. שאר המבקרים אנונימיים: האתר לא אוסף פרטים מזהים בלי הסכמה.</p>
      </section>`;
  };

  // ================= OUTBOX =================
  VIEWS.outbox = async (view) => {
    const rows = await db.select('notifications', 'select=*&order=scheduled_for.desc&limit=150');
    const due = rows.filter((n) => n.status === 'pending' && new Date(n.scheduled_for) <= new Date());
    view.innerHTML = `
      <h1>הודעות ללקוחות</h1>
      <div class="notice"><b>שליחה אוטומטית עדיין לא מחוברת.</b> המערכת מכינה כאן את הודעת האישור ואת תזכורת הבוקר (08:00) לכל תור. כשיחובר ספק SMS או וואטסאפ, הן יישלחו לבד. עד אז אפשר לשלוח ידנית בלחיצה על "שלח בוואטסאפ".</div>
      ${due.length ? `<p><b>${due.length} הודעות מחכות לשליחה עכשיו.</b></p>` : ''}
      <section class="panel" id="list">
        ${rows.map((n) => {
          const isDue = n.status === 'pending' && new Date(n.scheduled_for) <= new Date();
          return `<div class="list-row ${isDue ? 'hl' : ''}" data-id="${n.id}">
            <div style="flex:1;min-width:240px"><div><b>${NT_TYPE[n.type]}</b> <span class="chip ${n.status}">${NT_STATUS[n.status]}</span>
              <span class="muted">· ${n.status === 'pending' && !isDue ? 'מתוזמנת ל-' : ''}${fmt.date(n.scheduled_for)} ${fmt.time(n.scheduled_for)} · <span dir="ltr">${esc(fmt.phoneDisplay(n.phone))}</span></span></div>
              <div class="muted" style="margin-top:4px">${esc(n.body)}</div></div>
            ${n.status === 'pending' ? `<div class="toolbar" style="margin:0"><a class="sbtn wa" href="${fmt.whatsapp(n.phone)}?text=${encodeURIComponent(n.body)}" target="_blank" rel="noopener" data-sent>${ICON.wa}שלח בוואטסאפ</a><button class="sbtn" data-mark>סמן כנשלחה</button></div>` : ''}
          </div>`;
        }).join('') || '<div class="empty">אין הודעות עדיין</div>'}
      </section>`;
    view.querySelector('#list').addEventListener('click', async (e) => {
      const mark = e.target.closest('[data-mark]');
      const sent = e.target.closest('[data-sent]');
      if (!mark && !sent) return;
      const id = e.target.closest('[data-id]').dataset.id;
      try {
        if (mark || (sent && confirm('לסמן את ההודעה כנשלחה?'))) {
          await db.update('notifications', `id=eq.${id}`, { status: 'sent', sent_at: new Date().toISOString() });
          toast('סומן כנשלח'); route();
        }
      } catch (err) { fail(err); }
    });
  };

  // ================= SETTINGS =================
  VIEWS.settings = async (view) => {
    biz = (await db.select('business', 'select=*'))[0];
    view.innerHTML = `
      <h1>הגדרות</h1>
      <div class="grid2">
        <section class="panel"><h2>פרטי העסק</h2>
          <form id="biz" novalidate>
            <label class="field">שם העסק<input name="name" value="${esc(biz.name)}" required maxlength="60"></label>
            <label class="field">משפט פתיחה<input name="tagline" value="${esc(biz.tagline || '')}" maxlength="80"></label>
            <label class="field">כתובת<input name="address" value="${esc(biz.address || '')}" maxlength="120" placeholder="רחוב, מספר, עיר"></label>
            <label class="field">טלפון המספרה<input name="phone" type="tel" dir="ltr" value="${esc(biz.phone || '')}"></label>
            <label class="field">כתובת האתר (לקישורים בהודעות)<input name="site_url" type="url" dir="ltr" value="${esc(biz.site_url || '')}" placeholder="https://..."></label>
            <div class="row2">
              <label class="field">ביטול חינם עד (שעות לפני)<input name="cutoff" type="number" min="0" max="72" value="${biz.cancel_cutoff_hours}"></label>
              <label class="field">קביעה עד (ימים קדימה)<input name="window" type="number" min="1" max="120" value="${biz.booking_window_days}"></label>
            </div>
            <label class="field">מרווח בין שעות התחלה אפשריות
              <select name="step">${[10, 15, 20, 30].map((n) => `<option value="${n}" ${n === biz.slot_step_min ? 'selected' : ''}>כל ${n} דקות</option>`).join('')}</select></label>
            <button class="btn btn-dark btn-block" type="submit">שמור</button>
          </form>
        </section>
        <section class="panel"><h2>החשבון שלי</h2>
          <p class="muted">מחובר כ-<span dir="ltr">${esc((auth.session() || {}).email || '')}</span></p>
          <form id="pass" novalidate>
            <label class="field">סיסמה חדשה<input name="password" type="password" autocomplete="new-password" minlength="8" dir="ltr"></label>
            <button class="btn btn-ghost btn-block" type="submit">החלף סיסמה</button>
          </form>
        </section>
      </div>`;
    view.querySelector('#biz').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const phone = f.phone.value.replace(/\D/g, '');
      if (!f.name.value.trim()) { toast('נא להזין שם', true); return; }
      try {
        await db.update('business', `id=eq.${biz.id}`, {
          name: f.name.value.trim(), tagline: f.tagline.value.trim() || null, address: f.address.value.trim() || null,
          phone: phone || null, site_url: f.site_url.value.trim().replace(/\/$/, '') || null,
          cancel_cutoff_hours: +f.cutoff.value, booking_window_days: +f.window.value, slot_step_min: +f.step.value
        });
        toast('נשמר'); renderShellKeepTab();
      } catch (err) { fail(err); }
    });
    view.querySelector('#pass').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p = e.target.password.value;
      if (p.length < 8) { toast('סיסמה של 8 תווים לפחות', true); return; }
      try { await auth.updatePassword(p); e.target.reset(); toast('הסיסמה הוחלפה'); } catch (err) { fail(err); }
    });
  };

  async function renderShellKeepTab() {
    biz = (await db.select('business', 'select=*'))[0];
    renderShell();
  }

  // ================= BOOT =================
  async function boot() {
    const fromUrl = auth.consumeUrlSession();
    if (fromUrl && fromUrl.type === 'recovery') { renderAuth('newpass'); return; }
    if (!auth.session()) { renderAuth('login'); return; }
    try {
      const isAdmin = await rpc('is_admin', {}, true);
      if (!isAdmin) {
        await auth.signOut();
        renderAuth('login', 'החשבון הזה לא מוגדר כמנהל של האתר.');
        return;
      }
      [biz] = await db.select('business', 'select=*');
      services = await db.select('services', 'select=*&order=sort');
      renderShell();
    } catch (err) {
      if (String(err.message).includes('not_signed_in') || err.status === 401) { renderAuth('login'); return; }
      app.innerHTML = `<div class="auth-box"><div class="alert error">${esc(errorText(err))}</div></div>`;
    }
  }
  boot();
})();
