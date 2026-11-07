(function () {
  const { rpc, fmt, esc, errorText, visitorId, logView } = window.API;
  const $ = (s) => document.querySelector(s);
  const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const MY_KEY = 'my_bookings';

  const state = { info: null, service: null, days: [], day: null, slots: [], slot: null, busy: false };

  // ---------- small helpers ----------
  const readMine = () => { try { return JSON.parse(localStorage.getItem(MY_KEY)) || []; } catch (e) { return []; } };
  const writeMine = (list) => { try { localStorage.setItem(MY_KEY, JSON.stringify(list.slice(-5))); } catch (e) { /* ignore */ } };
  const normPhone = (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (/^9725\d{8}$/.test(d)) d = '0' + d.slice(3);
    return d;
  };
  const show = (el, on = true) => { el.hidden = !on; };
  const scrollTo = (el) => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const manageUrl = (token) => new URL('manage.html?t=' + token, location.href).href;

  // ---------- menu ----------
  const menuBtn = $('.menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = $('#nav').classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  $('#nav').addEventListener('click', (e) => {
    if (e.target.closest('a')) { $('#nav').classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  });

  // ---------- render: services ----------
  function renderServices() {
    const list = $('#svc-list');
    list.innerHTML = state.info.services.map((s, i) => `
      <button type="button" class="svc" data-id="${s.id}" aria-pressed="${state.service && state.service.id === s.id}">
        <span class="n">${String(i + 1).padStart(2, '0')}</span>
        <span class="t"><b>${esc(s.name)}</b><small>${s.description ? esc(s.description) + ' · ' : ''}${s.duration_min} דק׳</small></span>
        <span class="p">${fmt.money(s.price)}</span>
      </button>`).join('') || '<p class="hint">אין שירותים זמינים כרגע.</p>';
  }

  $('#svc-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.svc');
    if (!btn) return;
    state.service = state.info.services.find((s) => s.id === btn.dataset.id);
    state.slot = null;
    renderServices();
    show($('#when'));
    show($('#details'), false);
    updateBar();
    loadDays();
    scrollTo($('#when'));
  });

  // ---------- render: days ----------
  async function loadDays() {
    const daysEl = $('#days');
    daysEl.innerHTML = Array.from({ length: 6 }, () => '<div class="day skeleton"></div>').join('');
    $('#slots-area').innerHTML = '';
    try {
      state.days = await rpc('get_days', { p_service: state.service.id });
    } catch (err) {
      $('#slots-area').innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`;
      return;
    }
    const keep = state.day && state.days.find((d) => d.day === state.day && d.is_open);
    const first = keep || state.days.find((d) => d.free_slots > 0) || state.days.find((d) => d.is_open);
    state.day = first ? first.day : null;
    renderDays();
    if (state.day) loadSlots();
    else $('#slots-area').innerHTML = '<p class="hint">אין ימי עבודה פתוחים בתקופה הקרובה.</p>';
  }

  function renderDays() {
    $('#days').innerHTML = state.days.map((d) => {
      const label = d.day === fmt.todayIso() ? 'היום' : fmt.weekdayShort(d.day);
      const full = d.is_open && d.free_slots === 0;
      return `<button type="button" class="day" data-day="${d.day}" ${d.is_open ? '' : 'disabled'}
        aria-pressed="${d.day === state.day}" aria-label="${esc(fmt.dateLong(d.day + 'T12:00:00Z'))}${!d.is_open ? ', סגור' : full ? ', מלא' : ''}">
        <span class="w">${label}</span><span class="d">${fmt.dayNum(d.day)}</span>${full ? '<span class="full">מלא</span>' : ''}
      </button>`;
    }).join('');
    const sel = $('#days .day[aria-pressed="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  $('#days').addEventListener('click', (e) => {
    const btn = e.target.closest('.day');
    if (!btn || btn.disabled) return;
    state.day = btn.dataset.day;
    state.slot = null;
    show($('#details'), false);
    renderDays();
    updateBar();
    loadSlots();
  });

  // ---------- render: slots ----------
  async function loadSlots() {
    const area = $('#slots-area');
    area.innerHTML = '<div class="slots">' + Array.from({ length: 8 }, () => '<div class="slot skeleton"></div>').join('') + '</div>';
    try {
      state.slots = await rpc('get_slots', { p_service: state.service.id, p_day: state.day });
    } catch (err) {
      area.innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`;
      return;
    }
    renderSlots();
  }

  function renderSlots() {
    const area = $('#slots-area');
    if (!state.slots.length) { renderWaitlist(); return; }
    const groups = [['בוקר', (h) => h < 12], ['צהריים', (h) => h >= 12 && h < 16], ['ערב', (h) => h >= 16]];
    area.innerHTML = groups.map(([name, test]) => {
      const items = state.slots.filter((s) => test(+s.label.slice(0, 2)));
      if (!items.length) return '';
      return `<div class="slot-group">${name}</div><div class="slots">` + items.map((s) =>
        `<button type="button" class="slot" data-at="${s.starts_at}" aria-pressed="${state.slot === s.starts_at}">${s.label}</button>`).join('') + '</div>';
    }).join('');
  }

  $('#slots-area').addEventListener('click', (e) => {
    const btn = e.target.closest('.slot');
    if (!btn) return;
    state.slot = btn.dataset.at;
    renderSlots();
    show($('#details'));
    updateBar();
    $('#form-msg').innerHTML = '';
    scrollTo($('#details'));
    setTimeout(() => { if (!$('#f-name').value) $('#f-name').focus({ preventScroll: true }); }, 350);
  });

  // ---------- waitlist ----------
  function renderWaitlist() {
    const d = fmt.dateLong(state.day + 'T12:00:00Z');
    $('#slots-area').innerHTML = `
      <div class="waitlist-box">
        <h3>אין תורים פנויים ביום זה</h3>
        <p>הירשם לרשימת ההמתנה ל${esc(d)}. אם יתפנה מקום, נחזור אליך.</p>
        <form id="wl-form" novalidate>
          <label class="field">שם מלא<input name="name" autocomplete="name" required maxlength="60"></label>
          <label class="field">טלפון נייד<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X-XXXXXXX" dir="ltr" style="text-align:right" required></label>
          <label class="field">מתי נוח לך?
            <select name="pref">
              <option value="">כל שעה</option>
              <option value="09:00-12:00">בוקר (עד 12:00)</option>
              <option value="12:00-16:00">צהריים (12:00–16:00)</option>
              <option value="16:00-21:00">ערב (מ-16:00)</option>
            </select>
          </label>
          <button class="btn btn-dark btn-block" type="submit">הוסף אותי לרשימת ההמתנה</button>
          <div id="wl-msg" role="alert"></div>
        </form>
      </div>`;
    if (state.info.phone) {
      $('#slots-area').insertAdjacentHTML('beforeend', `<p class="hint" style="margin-top:12px">או התקשר: <a href="tel:${esc(state.info.phone)}" dir="ltr">${esc(fmt.phoneDisplay(state.info.phone))}</a></p>`);
    }
    $('#wl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const msg = $('#wl-msg');
      const name = f.name.value.trim();
      const phone = normPhone(f.phone.value);
      if (name.length < 2) { msg.innerHTML = '<div class="alert error">נא להזין שם מלא.</div>'; f.name.focus(); return; }
      if (!/^05\d{8}$/.test(phone)) { msg.innerHTML = `<div class="alert error">${errorText('invalid_phone')}</div>`; f.phone.focus(); return; }
      const [from, to] = f.pref.value ? f.pref.value.split('-') : [null, null];
      const btn = f.querySelector('button');
      btn.disabled = true;
      try {
        await rpc('join_waitlist', { p_day: state.day, p_full_name: name, p_phone: phone, p_service: state.service.id, p_from: from, p_to: to });
        f.innerHTML = '<div class="alert ok">נרשמת לרשימת ההמתנה. אם יתפנה מקום, נחזור אליך.</div>';
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`;
        btn.disabled = false;
      }
    });
  }

  // ---------- confirm bar ----------
  function updateBar() {
    const bar = $('#confirm-bar');
    show(bar, !!state.service && $('#done').hidden);
    if (!state.service) return;
    const slot = state.slot && state.slots.find((s) => s.starts_at === state.slot);
    $('#cb-title').textContent = slot
      ? `${state.service.name} · ${fmt.money(state.service.price)}`
      : state.service.name;
    $('#cb-sub').textContent = slot
      ? `${fmt.dateLong(state.slot)} · ${slot.label}`
      : 'בחר יום ושעה';
    bar.classList.toggle('inactive', !slot);
    $('#confirm-arrow').setAttribute('aria-label', slot ? 'אישור התור' : 'בחר יום ושעה');
  }

  async function onConfirm() {
    if (state.busy) return;
    if (!state.slot) { scrollTo($('#when')); return; }
    const msg = $('#form-msg');
    msg.innerHTML = '';
    const name = $('#f-name').value.trim().replace(/\s+/g, ' ');
    const phone = normPhone($('#f-phone').value);
    if (name.length < 2 || !name.includes(' ')) {
      msg.innerHTML = '<div class="alert error">נא להזין שם מלא (שם פרטי ומשפחה).</div>';
      scrollTo($('#details')); $('#f-name').focus({ preventScroll: true }); return;
    }
    if (!/^05\d{8}$/.test(phone)) {
      msg.innerHTML = `<div class="alert error">${errorText('invalid_phone')}</div>`;
      scrollTo($('#details')); $('#f-phone').focus({ preventScroll: true }); return;
    }
    if (!$('#f-agree').checked) {
      msg.innerHTML = '<div class="alert error">צריך לאשר את מדיניות הביטול.</div>';
      scrollTo($('#details')); $('#f-agree').focus({ preventScroll: true }); return;
    }
    state.busy = true;
    $('#confirm-bar').classList.add('inactive');
    $('#cb-sub').textContent = 'קובע את התור…';
    try {
      const res = await rpc('create_booking', {
        p_service: state.service.id, p_starts_at: state.slot,
        p_full_name: name, p_phone: phone, p_visitor_id: visitorId()
      });
      const mine = readMine().filter((t) => t !== res.token);
      mine.push(res.token);
      writeMine(mine);
      renderDone(res, name);
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(errorText(err))}</div>`;
      if (String(err.message).includes('slot_taken')) { state.slot = null; loadDays(); scrollTo($('#when')); }
    } finally {
      state.busy = false;
      updateBar();
    }
  }
  $('#confirm-main').addEventListener('click', onConfirm);
  $('#confirm-arrow').addEventListener('click', onConfirm);
  $('#details-form').addEventListener('submit', (e) => { e.preventDefault(); onConfirm(); });

  // ---------- done ----------
  function icsFor(res) {
    const start = new Date(res.starts_at);
    const end = new Date(start.getTime() + res.duration_min * 60000);
    const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YN Barber//HE', 'BEGIN:VEVENT',
      'UID:' + res.token + '@barber', 'DTSTAMP:' + z(new Date()), 'DTSTART:' + z(start), 'DTEND:' + z(end),
      'SUMMARY:' + res.service + ' · ' + (state.info.name || 'מספרה'),
      'LOCATION:' + (res.address || ''), 'DESCRIPTION:ניהול/ביטול: ' + manageUrl(res.token),
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:תזכורת לתור', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  function renderDone(res, name) {
    const done = $('#done');
    ['#services', '#when', '#details'].forEach((s) => show($(s), false));
    show($('#confirm-bar'), false);
    const link = manageUrl(res.token);
    done.innerHTML = `
      <span class="badge">התור נקבע</span>
      <h2>נתראה, ${esc(name.split(' ')[0])}.</h2>
      <ul class="summary">
        <li><span>שירות</span><span>${esc(res.service)}</span></li>
        <li><span>מתי</span><span>${esc(fmt.dateLong(res.starts_at))} · ${fmt.time(res.starts_at)}</span></li>
        <li><span>משך</span><span>${res.duration_min} דק׳</span></li>
        <li><span>מחיר</span><span>${fmt.money(res.price)}</span></li>
        ${res.address ? `<li><span>כתובת</span><span>${esc(res.address)}</span></li>` : ''}
      </ul>
      <p class="policy" style="margin:0 0 16px">ביטול חינם עד ${state.info.cancel_cutoff_hours} שעות לפני התור. שמור את הקישור לניהול התור, דרכו אפשר לבטל.</p>
      <div class="actions">
        <a class="btn btn-dark" href="${esc(link)}">ניהול / ביטול התור</a>
        <button class="btn btn-ghost" type="button" id="add-cal">הוסף ליומן</button>
        <button class="btn btn-ghost" type="button" id="copy-link">העתק קישור לתור</button>
        <button class="btn btn-ghost" type="button" id="book-another">קבע תור נוסף</button>
      </div>`;
    show(done);
    scrollTo(done);
    $('#add-cal').addEventListener('click', () => {
      const blob = new Blob([icsFor(res)], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'תור-מספרה.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('#copy-link').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(link); e.target.textContent = 'הקישור הועתק'; }
      catch (err) { prompt('העתק את הקישור:', link); }
    });
    $('#book-another').addEventListener('click', () => {
      state.service = null; state.slot = null; state.day = null;
      show(done, false); show($('#services'));
      renderServices(); updateBar(); scrollTo($('#services'));
    });
    renderMine();
  }

  // ---------- "my upcoming bookings" (this device) ----------
  async function renderMine() {
    const tokens = readMine();
    const old = $('#mine');
    if (old) old.remove();
    if (!tokens.length) return;
    const results = await Promise.all(tokens.map((t) => rpc('get_booking', { p_token: t }).then((b) => b && { ...b, token: t }).catch(() => null)));
    const live = results.filter((b) => b && b.status === 'booked' && new Date(b.starts_at) > new Date());
    writeMine(results.filter((b) => b && b.status === 'booked' && new Date(b.starts_at) > new Date()).map((b) => b.token));
    if (!live.length || !$('#done').hidden) return;
    const box = document.createElement('section');
    box.className = 'card';
    box.id = 'mine';
    box.innerHTML = `<div class="sec-head"><h2>התורים שלך</h2></div>` + live.map((b) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)">
        <div><b>${esc(b.service)}</b><div class="hint">${esc(fmt.dateLong(b.starts_at))} · ${fmt.time(b.starts_at)}</div></div>
        <a class="btn btn-ghost" style="min-height:44px" href="manage.html?t=${esc(b.token)}">ניהול</a>
      </div>`).join('');
    $('#booking').prepend(box);
  }

  // ---------- footer ----------
  function renderFooter() {
    const i = state.info;
    if (i.name) $('#ft-name').textContent = i.name;
    $('#ft-address').textContent = i.address || '';
    if (i.phone) $('#ft-phone').innerHTML = `<a href="tel:${esc(i.phone)}" dir="ltr">${esc(fmt.phoneDisplay(i.phone))}</a>`;
    const byDay = {};
    i.hours.forEach((h) => { (byDay[h.weekday] = byDay[h.weekday] || []).push(h.start + '–' + h.end); });
    // merge consecutive days with identical hours: "א׳–ה׳ 09:00–20:00"
    const short = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const lines = [];
    let d = 0;
    while (d < 7) {
      if (!byDay[d]) { d++; continue; }
      const txt = byDay[d].join(', ');
      let e = d;
      while (e + 1 < 7 && byDay[e + 1] && byDay[e + 1].join(', ') === txt) e++;
      lines.push(`${short[d]}${e > d ? '–' + short[e] : ''} ${txt}`);
      d = e + 1;
    }
    $('#ft-hours').innerHTML = lines.map(esc).join('<br>');
  }

  function renderPolicy() {
    const h = state.info.cancel_cutoff_hours;
    $('#policy-short').textContent = `ביטול חינם עד ${h} שעות לפני התור. ביטול מאוחר — חיוב מלא.`;
    $('#policy-full').innerHTML = `<b>מדיניות ביטול:</b> אפשר לבטל בחינם עד ${h} שעות לפני התור, דרך הקישור שתקבל. ביטול מאוחר יותר יחויב במחיר המלא של השירות.`;
  }

  // ---------- boot ----------
  async function boot() {
    logView();
    try {
      state.info = await rpc('get_public_info');
    } catch (err) {
      $('#svc-list').innerHTML = `<div class="alert error">לא הצלחנו לטעון את השירותים. ${esc(errorText(err))}</div>`;
      return;
    }
    renderServices();
    renderFooter();
    renderPolicy();
    renderMine();
    // deep link: index.html?service=<id>
    const pre = new URLSearchParams(location.search).get('service');
    if (pre) { const b = document.querySelector(`.svc[data-id="${CSS.escape(pre)}"]`); if (b) b.click(); }
  }
  boot();
})();
