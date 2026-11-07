-- Barber booking: schema, security and public functions
create extension if not exists btree_gist with schema extensions;

-- ---------- Tables ----------
create table public.business (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  address text,
  phone text,
  site_url text,
  timezone text not null default 'Asia/Jerusalem',
  slot_step_min int not null default 15 check (slot_step_min between 5 and 60),
  booking_window_days int not null default 28 check (booking_window_days between 1 and 120),
  cancel_cutoff_hours int not null default 3 check (cancel_cutoff_hours between 0 and 72),
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  duration_min int not null check (duration_min between 5 and 480),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- weekday: 0 = Sunday ... 6 = Saturday
create table public.weekly_hours (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

-- A day with any override rows ignores weekly hours for that day.
-- closed = true closes the day; otherwise each row is an open range.
create table public.date_overrides (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  day date not null,
  closed boolean not null default false,
  start_time time,
  end_time time,
  note text,
  check (closed or (start_time is not null and end_time is not null and end_time > start_time))
);

-- Blocked time (break, vacation, errand)
create table public.blocks (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  phone text not null,
  full_name text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  price numeric(10,2) not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked'
    check (status in ('booked','completed','no_show','cancelled','late_cancelled')),
  token uuid not null unique default gen_random_uuid(),
  visitor_id text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at),
  -- No two active bookings may overlap: enforced by the database itself
  constraint bookings_no_overlap exclude using gist (
    business_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('booked','completed','no_show'))
);
create index bookings_starts_idx on public.bookings (business_id, starts_at);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_visitor_idx on public.bookings (visitor_id);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  amount numeric(10,2) not null check (amount >= 0),
  reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index debts_customer_idx on public.debts (customer_id);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  day date not null,
  full_name text not null,
  phone text not null,
  service_id uuid references public.services(id) on delete set null,
  from_time time,
  to_time time,
  status text not null default 'waiting'
    check (status in ('waiting','slot_opened','contacted','closed')),
  created_at timestamptz not null default now()
);
create index waitlist_day_idx on public.waitlist (business_id, day);

create table public.page_views (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  created_at timestamptz not null default now(),
  path text,
  referrer text,
  device text,
  browser text,
  visitor_id text
);
create index page_views_created_idx on public.page_views (business_id, created_at);
create index page_views_visitor_idx on public.page_views (visitor_id);

-- Outbox: what would be sent. A sender (SMS / WhatsApp) can be plugged in later.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  type text not null check (type in ('confirmation','reminder','cancellation')),
  phone text not null,
  body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','cancelled','failed')),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index notifications_due_idx on public.notifications (status, scheduled_for);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references public.business(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Helpers ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._business()
returns public.business language sql stable security definer set search_path = public as $$
  select * from public.business order by created_at limit 1;
$$;

-- The first account that signs up becomes the admin; later sign-ups get nothing.
create or replace function public._claim_first_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id, business_id) values (new.id, (public._business()).id);
  end if;
  return new;
end $$;
create trigger on_auth_user_created_claim_admin
  after insert on auth.users for each row execute function public._claim_first_admin();

-- Open ranges for one day, honouring date overrides
create or replace function public._day_ranges(p_business uuid, p_day date)
returns table (range_start timestamptz, range_end timestamptz)
language sql stable security definer set search_path = public as $$
  with b as (select timezone from public.business where id = p_business),
       ov as (select * from public.date_overrides where business_id = p_business and day = p_day)
  select (p_day + o.start_time) at time zone b.timezone, (p_day + o.end_time) at time zone b.timezone
    from ov o, b
   where not exists (select 1 from ov where closed) and not o.closed
  union all
  select (p_day + w.start_time) at time zone b.timezone, (p_day + w.end_time) at time zone b.timezone
    from public.weekly_hours w, b
   where w.business_id = p_business
     and w.weekday = extract(dow from p_day)::int
     and not exists (select 1 from ov);
$$;

-- Free start times for a service on a day
create or replace function public._slots(p_business uuid, p_service uuid, p_day date)
returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select s
    from public.business b
    join public.services sv on sv.id = p_service and sv.business_id = b.id and sv.active
    cross join lateral public._day_ranges(b.id, p_day) r
    cross join lateral generate_series(
      r.range_start,
      r.range_end - make_interval(mins => sv.duration_min),
      make_interval(mins => b.slot_step_min)) s
   where b.id = p_business
     and s > now()
     and p_day <= (now() at time zone b.timezone)::date + b.booking_window_days
     and not exists (
       select 1 from public.bookings bk
        where bk.business_id = b.id
          and bk.status in ('booked','completed','no_show')
          and tstzrange(bk.starts_at, bk.ends_at, '[)') && tstzrange(s, s + make_interval(mins => sv.duration_min), '[)'))
     and not exists (
       select 1 from public.blocks bl
        where bl.business_id = b.id
          and tstzrange(bl.starts_at, bl.ends_at, '[)') && tstzrange(s, s + make_interval(mins => sv.duration_min), '[)'))
   order by s;
$$;

create or replace function public._fmt_day(p_ts timestamptz, p_tz text)
returns text language sql immutable as $$
  select (array['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'])[extract(dow from (p_ts at time zone p_tz))::int + 1]
         || ' ' || to_char(p_ts at time zone p_tz, 'DD.MM');
$$;

-- ---------- Public functions (callable without login) ----------
create or replace function public.get_public_info()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'name', b.name, 'tagline', b.tagline, 'address', b.address, 'phone', b.phone,
    'timezone', b.timezone, 'booking_window_days', b.booking_window_days,
    'cancel_cutoff_hours', b.cancel_cutoff_hours,
    'services', coalesce((select json_agg(json_build_object(
        'id', s.id, 'name', s.name, 'description', s.description,
        'price', s.price, 'duration_min', s.duration_min) order by s.sort, s.price)
      from public.services s where s.business_id = b.id and s.active), '[]'::json),
    'hours', coalesce((select json_agg(json_build_object(
        'weekday', w.weekday, 'start', to_char(w.start_time,'HH24:MI'), 'end', to_char(w.end_time,'HH24:MI'))
        order by w.weekday, w.start_time)
      from public.weekly_hours w where w.business_id = b.id), '[]'::json))
  from public._business() b;
$$;

create or replace function public.get_days(p_service uuid)
returns table (day date, is_open boolean, free_slots int)
language sql stable security definer set search_path = public as $$
  select d::date,
         exists (select 1 from public._day_ranges(b.id, d::date)),
         (select count(*)::int from public._slots(b.id, p_service, d::date))
    from public._business() b,
         generate_series((now() at time zone b.timezone)::date,
                         (now() at time zone b.timezone)::date + b.booking_window_days, interval '1 day') d
   order by 1;
$$;

create or replace function public.get_slots(p_service uuid, p_day date)
returns table (starts_at timestamptz, label text)
language sql stable security definer set search_path = public as $$
  select s, to_char(s at time zone b.timezone, 'HH24:MI')
    from public._business() b, public._slots(b.id, p_service, p_day) s;
$$;

create or replace function public.create_booking(
  p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_visitor_id text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  sv public.services;
  v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_name text := btrim(coalesce(p_full_name,''));
  v_day date := (p_starts_at at time zone b.timezone)::date;
  v_customer uuid;
  v_booking public.bookings;
  v_reminder timestamptz;
  v_when text;
  v_link text;
begin
  if v_phone ~ '^9725\d{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^05\d{8}$' then raise exception 'invalid_phone'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'invalid_name'; end if;

  select * into sv from public.services where id = p_service and business_id = b.id and active;
  if not found then raise exception 'invalid_service'; end if;

  if not exists (select 1 from public._slots(b.id, p_service, v_day) s where s = p_starts_at) then
    raise exception 'slot_taken';
  end if;

  insert into public.customers (business_id, phone, full_name) values (b.id, v_phone, v_name)
  on conflict (business_id, phone) do update set full_name = excluded.full_name
  returning id into v_customer;

  if (select count(*) from public.bookings
       where customer_id = v_customer and status = 'booked' and starts_at > now()) >= 3 then
    raise exception 'too_many_bookings';
  end if;

  begin
    insert into public.bookings (business_id, customer_id, service_id, service_name, price, starts_at, ends_at, visitor_id)
    values (b.id, v_customer, sv.id, sv.name, sv.price, p_starts_at,
            p_starts_at + make_interval(mins => sv.duration_min), nullif(p_visitor_id, ''))
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  v_when := public._fmt_day(p_starts_at, b.timezone) || ' בשעה ' || to_char(p_starts_at at time zone b.timezone, 'HH24:MI');
  v_link := coalesce(nullif(rtrim(b.site_url, '/'), ''), '') || '/manage.html?t=' || v_booking.token;

  insert into public.notifications (business_id, booking_id, type, phone, body, scheduled_for)
  values (b.id, v_booking.id, 'confirmation', v_phone,
          'היי ' || split_part(v_name, ' ', 1) || ', התור שלך ל' || sv.name || ' נקבע ליום ' || v_when
          || '. ביטול חינם עד ' || b.cancel_cutoff_hours || ' שעות לפני: ' || v_link,
          now());

  v_reminder := (v_day + time '08:00') at time zone b.timezone;
  if v_reminder > now() and v_reminder < p_starts_at then
    insert into public.notifications (business_id, booking_id, type, phone, body, scheduled_for)
    values (b.id, v_booking.id, 'reminder', v_phone,
            'בוקר טוב ' || split_part(v_name, ' ', 1) || '! תזכורת: היום בשעה '
            || to_char(p_starts_at at time zone b.timezone, 'HH24:MI') || ' יש לך ' || sv.name
            || '. לביטול: ' || v_link,
            v_reminder);
  end if;

  return json_build_object('token', v_booking.token, 'service', sv.name, 'price', sv.price,
    'duration_min', sv.duration_min, 'starts_at', v_booking.starts_at, 'when', v_when,
    'address', b.address);
end $$;

create or replace function public.get_booking(p_token uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'service', bk.service_name, 'price', bk.price, 'status', bk.status,
    'starts_at', bk.starts_at, 'ends_at', bk.ends_at,
    'when', public._fmt_day(bk.starts_at, b.timezone) || ' בשעה ' || to_char(bk.starts_at at time zone b.timezone, 'HH24:MI'),
    'first_name', split_part(c.full_name, ' ', 1),
    'address', b.address, 'business_phone', b.phone,
    'cancel_cutoff_hours', b.cancel_cutoff_hours,
    'free_cancel_until', bk.starts_at - make_interval(hours => b.cancel_cutoff_hours),
    'is_late', now() > bk.starts_at - make_interval(hours => b.cancel_cutoff_hours))
  from public.bookings bk
  join public.customers c on c.id = bk.customer_id
  join public.business b on b.id = bk.business_id
  where bk.token = p_token;
$$;

create or replace function public.cancel_booking(p_token uuid, p_accept_charge boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  bk public.bookings;
  v_late boolean;
  v_day date;
begin
  select * into bk from public.bookings where token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if bk.status <> 'booked' then raise exception 'not_active'; end if;
  if bk.starts_at <= now() then raise exception 'already_started'; end if;

  v_late := now() > bk.starts_at - make_interval(hours => b.cancel_cutoff_hours);
  if v_late and not coalesce(p_accept_charge, false) then
    raise exception 'late_requires_confirmation';
  end if;

  update public.bookings
     set status = case when v_late then 'late_cancelled' else 'cancelled' end, cancelled_at = now()
   where id = bk.id;

  if v_late then
    insert into public.debts (business_id, customer_id, booking_id, amount, reason)
    values (bk.business_id, bk.customer_id, bk.id, bk.price, 'ביטול מאוחר: ' || bk.service_name);
  end if;

  update public.notifications set status = 'cancelled'
   where booking_id = bk.id and status = 'pending';

  v_day := (bk.starts_at at time zone b.timezone)::date;
  update public.waitlist set status = 'slot_opened'
   where business_id = bk.business_id and day = v_day and status = 'waiting';

  return json_build_object('status', case when v_late then 'late_cancelled' else 'cancelled' end,
                           'charged', case when v_late then bk.price else 0 end);
end $$;

create or replace function public.join_waitlist(
  p_day date, p_full_name text, p_phone text, p_service uuid default null,
  p_from time default null, p_to time default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.business := public._business();
  v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_name text := btrim(coalesce(p_full_name,''));
begin
  if v_phone ~ '^9725\d{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^05\d{8}$' then raise exception 'invalid_phone'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'invalid_name'; end if;
  if p_day < (now() at time zone b.timezone)::date
     or p_day > (now() at time zone b.timezone)::date + b.booking_window_days then
    raise exception 'invalid_day';
  end if;
  if exists (select 1 from public.waitlist where business_id = b.id and day = p_day and phone = v_phone
             and status in ('waiting','slot_opened')) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.waitlist (business_id, day, full_name, phone, service_id, from_time, to_time)
  values (b.id, p_day, v_name, v_phone, p_service, p_from, p_to);
  return json_build_object('ok', true);
end $$;

create or replace function public.log_view(
  p_path text, p_referrer text, p_device text, p_browser text, p_visitor_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.page_views (business_id, path, referrer, device, browser, visitor_id)
  select b.id, left(p_path, 200), left(nullif(p_referrer, ''), 300), left(p_device, 20),
         left(p_browser, 40), left(p_visitor_id, 64)
    from public._business() b;
$$;

-- ---------- Admin analytics ----------
create or replace function public.admin_analytics()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  b public.business := public._business();
  v_today date := (now() at time zone b.timezone)::date;
  v_from timestamptz := ((v_today - 29) + time '00:00') at time zone b.timezone;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return json_build_object(
    'totals', (select json_build_object(
        'views_today', count(*) filter (where (created_at at time zone b.timezone)::date = v_today),
        'uniques_today', count(distinct visitor_id) filter (where (created_at at time zone b.timezone)::date = v_today),
        'views_7', count(*) filter (where (created_at at time zone b.timezone)::date > v_today - 7),
        'uniques_7', count(distinct visitor_id) filter (where (created_at at time zone b.timezone)::date > v_today - 7),
        'views_30', count(*), 'uniques_30', count(distinct visitor_id))
      from public.page_views where business_id = b.id and created_at >= v_from),
    'booked_visitors_30', (select count(distinct visitor_id) from public.bookings
        where business_id = b.id and created_at >= v_from and visitor_id is not null),
    'per_day', (select json_agg(json_build_object('day', d::date,
        'views', (select count(*) from public.page_views p where p.business_id = b.id
                   and (p.created_at at time zone b.timezone)::date = d::date)) order by d)
      from generate_series(v_today - 29, v_today, interval '1 day') d),
    'referrers', (select coalesce(json_agg(r), '[]') from (
        select coalesce(substring(referrer from '^https?://([^/]+)'), 'ישיר') as source, count(*) as views
          from public.page_views where business_id = b.id and created_at >= v_from
         group by 1 order by 2 desc limit 8) r),
    'devices', (select coalesce(json_agg(r), '[]') from (
        select coalesce(device, 'לא ידוע') as device, count(*) as views
          from public.page_views where business_id = b.id and created_at >= v_from
         group by 1 order by 2 desc) r),
    'recent', (select coalesce(json_agg(r), '[]') from (
        select p.created_at, p.path, p.device, p.browser,
               coalesce(substring(p.referrer from '^https?://([^/]+)'), 'ישיר') as source,
               (select c.full_name from public.bookings bk join public.customers c on c.id = bk.customer_id
                 where bk.visitor_id = p.visitor_id order by bk.created_at desc limit 1) as customer
          from public.page_views p where p.business_id = b.id
         order by p.created_at desc limit 60) r));
end $$;

-- ---------- Row level security ----------
alter table public.business enable row level security;
alter table public.services enable row level security;
alter table public.weekly_hours enable row level security;
alter table public.date_overrides enable row level security;
alter table public.blocks enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.debts enable row level security;
alter table public.waitlist enable row level security;
alter table public.page_views enable row level security;
alter table public.notifications enable row level security;
alter table public.admins enable row level security;

create policy admin_all on public.business for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.weekly_hours for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.date_overrides for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.blocks for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.customers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.bookings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.debts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.waitlist for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_read on public.page_views for select to authenticated using (public.is_admin());
create policy admin_all on public.notifications for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_self on public.admins for select to authenticated using (user_id = auth.uid());

-- ---------- Function permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_public_info() to anon, authenticated;
grant execute on function public.get_days(uuid) to anon, authenticated;
grant execute on function public.get_slots(uuid, date) to anon, authenticated;
grant execute on function public.create_booking(uuid, timestamptz, text, text, text) to anon, authenticated;
grant execute on function public.get_booking(uuid) to anon, authenticated;
grant execute on function public.cancel_booking(uuid, boolean) to anon, authenticated;
grant execute on function public.join_waitlist(date, text, text, uuid, time, time) to anon, authenticated;
grant execute on function public.log_view(text, text, text, text, text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_analytics() to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- Seed ----------
with b as (
  insert into public.business (name, tagline, address, phone)
  values ('ינון נחום', 'לא עוד סתם תספורת.', null, null)
  returning id
), s as (
  insert into public.services (business_id, name, description, price, duration_min, sort)
  select b.id, x.name, x.descr, x.price, x.dur, x.sort from b, (values
    ('תספורת ועיצוב שיער', 'כולל זקן', 70, 45, 1),
    ('תספורת מספריים', null, 90, 40, 2),
    ('סידור זקן', null, 25, 15, 3),
    ('תספורת חייל', 'תקינה – מכונה למעלה ודירוג לא חד בצדדים', 50, 20, 4)
  ) as x(name, descr, price, dur, sort)
  returning 1
)
insert into public.weekly_hours (business_id, weekday, start_time, end_time)
select b.id, x.wd, x.st::time, x.en::time from b, (values
  (0,'09:00','20:00'),(1,'09:00','20:00'),(2,'09:00','20:00'),(3,'09:00','20:00'),(4,'09:00','20:00'),
  (5,'08:00','14:00')) as x(wd, st, en);
