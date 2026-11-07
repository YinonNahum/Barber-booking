// Offline UI walkthrough of the admin panel with a mocked backend.
const { chromium, devices } = require('playwright');
const path = require('path');
const { handle } = require('./mock');
const root = 'file://' + path.resolve(__dirname, '..');
const out = process.argv[2] || '/tmp';

const iso = (h, dayOffset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(h - 2, 0, 0, 0); return d.toISOString(); };
const cust = (n, p) => ({ full_name: n, phone: p });
const bookings = [
  { id: 'b1', customer_id: 'c1', service_name: 'תספורת ועיצוב שיער', price: 70, starts_at: iso(9), ends_at: iso(9.75), status: 'completed', customers: cust('ישראל ישראלי', '0501234567') },
  { id: 'b2', customer_id: 'c2', service_name: 'סידור זקן', price: 25, starts_at: iso(11), ends_at: iso(11.25), status: 'booked', customers: cust('משה כהן', '0521112222') },
  { id: 'b3', customer_id: 'c3', service_name: 'תספורת חייל', price: 50, starts_at: iso(23), ends_at: iso(23.3), status: 'booked', customers: cust('רון לוי', '0545556666') }
];
function admin(route, url, body, json) {
  if (url.includes('/rpc/is_admin')) return json(true);
  if (url.includes('/rest/v1/business')) return json([{ id: 'biz', name: 'ינון נחום', tagline: 'לא עוד סתם תספורת.', address: 'הרצל 10', phone: '0501234567', site_url: 'https://yn.netlify.app', cancel_cutoff_hours: 3, booking_window_days: 28, slot_step_min: 15 }]);
  if (url.includes('/rest/v1/services')) return json([{ id: 's1', name: 'תספורת ועיצוב שיער', description: 'כולל זקן', price: 70, duration_min: 45, active: true, sort: 1 }, { id: 's3', name: 'סידור זקן', description: null, price: 25, duration_min: 15, active: true, sort: 3 }]);
  if (url.includes('/rest/v1/bookings')) return json(bookings);
  if (url.includes('/rest/v1/debts') && url.includes('select=customer_id')) return json([{ customer_id: 'c2', amount: 70 }]);
  if (url.includes('/rest/v1/debts')) return json([{ amount: 70 }]);
  if (url.includes('/rest/v1/waitlist') && url.includes('services(name)')) return json([{ id: 'w1', day: new Date(Date.now() + 86400e3).toISOString().slice(0, 10), full_name: 'דני אבירם', phone: '0541234567', status: 'slot_opened', from_time: '16:00:00', to_time: '21:00:00', services: { name: 'סידור זקן' } }, { id: 'w2', day: new Date(Date.now() + 86400e3).toISOString().slice(0, 10), full_name: 'יוסי', phone: '0541234568', status: 'waiting', services: null }]);
  if (url.includes('/rest/v1/waitlist')) return json([{ id: 'w1' }]);
  if (url.includes('/rest/v1/weekly_hours')) return json([0, 1, 2, 3, 4].map((w) => ({ weekday: w, start_time: '09:00:00', end_time: '13:00:00' })).concat([0, 1, 2, 3, 4].map((w) => ({ weekday: w, start_time: '16:00:00', end_time: '20:00:00' })), [{ weekday: 5, start_time: '08:00:00', end_time: '14:00:00' }]));
  if (url.includes('/rest/v1/date_overrides')) return json([{ day: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), closed: true, note: 'חופש' }]);
  if (url.includes('/rest/v1/blocks')) return json([{ id: 1, starts_at: iso(13, 1), ends_at: iso(14, 1), reason: 'הפסקה' }]);
  if (url.includes('/rest/v1/customers')) return json([
    { id: 'c2', full_name: 'משה כהן', phone: '0521112222', notes: null, created_at: iso(9, -20), bookings: [{ id: 'x', starts_at: iso(11, -7), service_name: 'סידור זקן', status: 'late_cancelled', price: 70 }, { id: 'y', starts_at: iso(11), service_name: 'סידור זקן', status: 'booked', price: 25 }], debts: [{ id: 'd1', amount: 70, reason: 'ביטול מאוחר: תספורת ועיצוב שיער', paid_at: null, created_at: iso(9, -7) }] },
    { id: 'c1', full_name: 'ישראל ישראלי', phone: '0501234567', notes: 'אוהב פייד נמוך', created_at: iso(9, -30), bookings: [{ id: 'z', starts_at: iso(9), service_name: 'תספורת ועיצוב שיער', status: 'completed', price: 70 }], debts: [] }]);
  if (url.includes('/rpc/admin_analytics')) {
    const per_day = Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10), views: Math.round(5 + 20 * Math.abs(Math.sin(i / 3))) }));
    return json({ totals: { views_today: 23, uniques_today: 14, views_7: 160, uniques_7: 88, views_30: 610, uniques_30: 301 }, booked_visitors_30: 37, per_day, referrers: [{ source: 'ישיר', views: 300 }, { source: 'l.instagram.com', views: 210 }, { source: 'www.google.com', views: 100 }], devices: [{ device: 'נייד', views: 520 }, { device: 'מחשב', views: 90 }], recent: [{ created_at: iso(10), path: '/', device: 'נייד', browser: 'Instagram', source: 'l.instagram.com', customer: 'ישראל ישראלי' }, { created_at: iso(9), path: '/', device: 'מחשב', browser: 'Chrome', source: 'ישיר', customer: null }] });
  }
  if (url.includes('/rest/v1/notifications')) return json([{ id: 'n1', type: 'confirmation', status: 'pending', phone: '0521112222', body: 'היי משה, התור שלך לסידור זקן נקבע ליום ראשון 08.11 בשעה 11:00.', scheduled_for: iso(8) }, { id: 'n2', type: 'reminder', status: 'pending', phone: '0545556666', body: 'בוקר טוב רון! תזכורת: היום בשעה 23:00 יש לך תספורת חייל.', scheduled_for: iso(8, 1) }]);
  return json([]);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [label, opts] of [['m', devices['iPhone 13']], ['d', { viewport: { width: 1366, height: 900 } }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
    await page.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : handle(r, { admin }));
    await page.goto(root + '/admin.html');
    await page.waitForSelector('#auth-form');
    if (label === 'm') await page.screenshot({ path: `${out}/a0-login.png` });
    await page.evaluate(() => localStorage.setItem('barber_admin_session', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3600e3, email: 'yinon@example.com' })));
    for (const tab of ['today', 'calendar', 'hours', 'services', 'customers', 'waitlist', 'stats', 'outbox', 'settings']) {
      await page.goto(root + '/admin.html#' + tab); if (tab === 'today') await page.reload();
      await page.waitForSelector('#view h1');
      await page.waitForTimeout(250);
      if (tab === 'customers') await page.$eval('details.cust', (d) => { d.open = true; });
      await page.screenshot({ path: `${out}/a-${label}-${tab}.png`, fullPage: label === 'd' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (ov) errors.push(`${label} ${tab}: horizontal overflow`);
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ errors }, null, 1));
  await browser.close();
})();
