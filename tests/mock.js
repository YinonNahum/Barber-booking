// Shared mock of the Supabase API for offline UI tests (Playwright route handler).
const services = [
  { id: 's1', name: 'תספורת ועיצוב שיער', description: 'כולל זקן', price: 70, duration_min: 45 },
  { id: 's2', name: 'תספורת מספריים', description: null, price: 90, duration_min: 40 },
  { id: 's3', name: 'סידור זקן', description: null, price: 25, duration_min: 15 },
  { id: 's4', name: 'תספורת חייל', description: 'תקינה – מכונה למעלה ודירוג לא חד בצדדים', price: 50, duration_min: 20 }
];
function iso(d) { return d.toISOString().slice(0, 10); }
function days() {
  const out = [];
  const t = new Date();
  for (let i = 0; i < 29; i++) {
    const d = new Date(t.getTime() + i * 86400000);
    const dow = d.getUTCDay();
    out.push({ day: iso(d), is_open: dow !== 6, free_slots: dow === 6 ? 0 : (i === 2 ? 0 : 20) });
  }
  return out;
}
function slots(day) {
  const labels = ['09:00', '09:15', '09:30', '10:45', '11:00', '12:30', '13:00', '16:00', '16:15', '17:30', '18:00', '19:15'];
  return labels.map((l) => ({ starts_at: `${day}T${String(+l.slice(0, 2) - 2).padStart(2, '0')}:${l.slice(3)}:00+00:00`, label: l }));
}
const booking = (late) => ({
  service: 'תספורת ועיצוב שיער', price: 70, status: 'booked',
  starts_at: new Date(Date.now() + (late ? 2 : 30) * 3600e3).toISOString(),
  ends_at: new Date(Date.now() + (late ? 2.75 : 30.75) * 3600e3).toISOString(),
  first_name: 'ישראל', address: 'הרצל 10, ראשון לציון', business_phone: '0501234567',
  cancel_cutoff_hours: 3, free_cancel_until: new Date(Date.now() + 27 * 3600e3).toISOString(), is_late: !!late
});

async function handle(route, opts = {}) {
  const url = route.request().url();
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (!url.includes('supabase.co')) return route.abort();
  const body = route.request().postDataJSON ? route.request().postDataJSON() : null;
  if (url.includes('/rpc/get_public_info')) return json({ name: 'ינון נחום', tagline: 'לא עוד סתם תספורת.', address: 'הרצל 10, ראשון לציון', phone: '0501234567', timezone: 'Asia/Jerusalem', booking_window_days: 28, cancel_cutoff_hours: 3, services, hours: [0, 1, 2, 3, 4].map((w) => ({ weekday: w, start: '09:00', end: '20:00' })).concat([{ weekday: 5, start: '08:00', end: '14:00' }]) });
  if (url.includes('/rpc/get_days')) return json(days());
  if (url.includes('/rpc/get_slots')) { const d = days().find((x) => x.day === body.p_day); return json(d && d.free_slots ? slots(body.p_day) : []); }
  if (url.includes('/rpc/create_booking')) return json({ token: '590e043c-4698-4e41-bd38-fcdb474cc46d', service: 'תספורת ועיצוב שיער', price: 70, duration_min: 45, starts_at: body.p_starts_at, when: '', address: 'הרצל 10, ראשון לציון' });
  if (url.includes('/rpc/get_booking')) return json(opts.bookingNull ? null : booking(opts.late));
  if (url.includes('/rpc/log_view') || url.includes('/rpc/join_waitlist')) return json(url.includes('waitlist') ? { ok: true } : null);
  if (opts.admin) return opts.admin(route, url, body, json);
  return json(null);
}
module.exports = { handle };
