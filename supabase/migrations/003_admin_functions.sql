-- Admin-only helpers (each checks is_admin()).

-- Queue confirmation + morning reminder for a booking
create or replace function public._queue_booking_notifications(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  bk public.bookings;
  c public.customers;
  v_when text; v_link text; v_reminder timestamptz;
begin
  select * into bk from public.bookings where id = p_booking;
  select * into c from public.customers where id = bk.customer_id;
  v_when := public._fmt_day(bk.starts_at, b.timezone) || ' בשעה ' || to_char(bk.starts_at at time zone b.timezone, 'HH24:MI');
  v_link := coalesce(nullif(rtrim(b.site_url, '/'), ''), '') || '/manage.html?t=' || bk.token;
  insert into public.notifications (business_id, booking_id, type, phone, body, scheduled_for)
  values (b.id, bk.id, 'confirmation', c.phone,
          'היי ' || split_part(c.full_name, ' ', 1) || ', התור שלך ל' || bk.service_name || ' נקבע ליום ' || v_when
          || '. ביטול חינם עד ' || b.cancel_cutoff_hours || ' שעות לפני: ' || v_link, now());
  v_reminder := (((bk.starts_at at time zone b.timezone)::date) + time '08:00') at time zone b.timezone;
  if v_reminder > now() and v_reminder < bk.starts_at then
    insert into public.notifications (business_id, booking_id, type, phone, body, scheduled_for)
    values (b.id, bk.id, 'reminder', c.phone,
            'בוקר טוב ' || split_part(c.full_name, ' ', 1) || '! תזכורת: היום בשעה '
            || to_char(bk.starts_at at time zone b.timezone, 'HH24:MI') || ' יש לך ' || bk.service_name
            || '. לביטול: ' || v_link, v_reminder);
  end if;
end $$;

-- Phone / walk-in booking by the barber. Ignores working hours, still cannot overlap.
create or replace function public.admin_create_booking(
  p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_notify boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  sv public.services;
  v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_name text := btrim(coalesce(p_full_name,''));
  v_customer uuid;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if v_phone ~ '^9725\d{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^0\d{8,9}$' then raise exception 'invalid_phone'; end if;
  if char_length(v_name) < 2 then raise exception 'invalid_name'; end if;
  select * into sv from public.services where id = p_service and business_id = b.id;
  if not found then raise exception 'invalid_service'; end if;

  insert into public.customers (business_id, phone, full_name) values (b.id, v_phone, v_name)
  on conflict (business_id, phone) do update set full_name = excluded.full_name
  returning id into v_customer;

  begin
    insert into public.bookings (business_id, customer_id, service_id, service_name, price, starts_at, ends_at)
    values (b.id, v_customer, sv.id, sv.name, sv.price, p_starts_at, p_starts_at + make_interval(mins => sv.duration_min))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  if p_notify then perform public._queue_booking_notifications(v_id); end if;
  return json_build_object('id', v_id);
end $$;

-- Cancel on the customer's behalf; optional full-price charge.
create or replace function public.admin_cancel_booking(p_id uuid, p_charge boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  bk public.bookings;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into bk from public.bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if bk.status <> 'booked' then raise exception 'not_active'; end if;
  update public.bookings set status = case when p_charge then 'late_cancelled' else 'cancelled' end, cancelled_at = now()
   where id = bk.id;
  if p_charge then
    insert into public.debts (business_id, customer_id, booking_id, amount, reason)
    values (bk.business_id, bk.customer_id, bk.id, bk.price, 'ביטול מאוחר: ' || bk.service_name);
  end if;
  update public.notifications set status = 'cancelled' where booking_id = bk.id and status = 'pending';
  update public.waitlist set status = 'slot_opened'
   where business_id = bk.business_id and day = (bk.starts_at at time zone b.timezone)::date and status = 'waiting';
  return json_build_object('ok', true);
end $$;

-- Block a time range on a local date (break, errand, vacation hours)
create or replace function public.admin_add_block(p_day date, p_from time, p_to time, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare b public.business := public._business(); v_id bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_to <= p_from then raise exception 'invalid_range'; end if;
  insert into public.blocks (business_id, starts_at, ends_at, reason)
  values (b.id, (p_day + p_from) at time zone b.timezone, (p_day + p_to) at time zone b.timezone, nullif(btrim(p_reason), ''))
  returning id into v_id;
  return json_build_object('id', v_id);
end $$;

-- Close a range of whole days (vacation)
create or replace function public.admin_close_days(p_from date, p_to date, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare b public.business := public._business(); d date; n int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'invalid_range'; end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    delete from public.date_overrides where business_id = b.id and day = d;
    insert into public.date_overrides (business_id, day, closed, note) values (b.id, d, true, nullif(btrim(p_note), ''));
    n := n + 1;
  end loop;
  return json_build_object('days', n);
end $$;

revoke execute on function public._queue_booking_notifications(uuid) from public, anon, authenticated;
grant execute on function public.admin_create_booking(uuid, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.admin_cancel_booking(uuid, boolean) to authenticated;
grant execute on function public.admin_add_block(date, time, time, text) to authenticated;
grant execute on function public.admin_close_days(date, date, text) to authenticated;
