-- ═══════════════════════════════════════════════════════════════
-- Flux · Telemetría anónima
--
-- PROBLEMA QUE ARREGLA ESTA MIGRACIÓN
--
-- El baseline solo dejaba insertar a `authenticated`:
--
--   create policy "insert own events" on public.analytics_events
--     for insert to authenticated ...
--
-- Flux es un cliente de escritorio donde iniciar sesión es opcional, así que
-- la mayoría de las instalaciones nunca autentican. Sus inserts los rechazaba
-- RLS y `flushEvents` se los tragaba en su `catch` vacío: sin error visible,
-- sin datos. La tabla solo veía a la minoría con cuenta.
--
-- SOLUCIÓN
--
-- La app deja de escribir directo contra PostgREST. Manda a la edge function
-- `telemetry`, que valida el payload y escribe con service_role. Las tablas
-- quedan cerradas al rol anon: la anon key es pública (va dentro del binario),
-- y abrir un insert a anon es abrir la tabla a cualquiera con un curl.
--
-- Las policies viejas de `authenticated` se conservan a propósito: las
-- instalaciones de v0.2.0 que ya están ahí fuera siguen escribiendo por la vía
-- directa, y romperlas solo perdería los pocos datos que hoy sí entran.
-- Se distinguen porque llegan sin `install_id`.
-- ═══════════════════════════════════════════════════════════════


-- `digest()` y `gen_random_bytes()` los aporta pgcrypto. En Supabase vive en el
-- esquema `extensions`, y por eso las llamadas van cualificadas.
create extension if not exists pgcrypto with schema extensions;


-- ─────────────────────────────────────
-- Identidad de instalación
--
-- `install_id` es un UUID aleatorio generado en el cliente y guardado en local.
-- No identifica a una persona ni se deriva de nada del equipo: identifica a una
-- copia de Flux. Es lo que convierte "421 eventos" en "N usuarios activos",
-- que es la pregunta que de verdad importa. Nullable porque los clientes
-- antiguos no lo mandan.
-- ─────────────────────────────────────
alter table public.analytics_events add column if not exists install_id text;
alter table public.analytics_events add column if not exists platform   text;

alter table public.crash_reports add column if not exists install_id text;
alter table public.crash_reports add column if not exists platform   text;

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_install_day_idx
  on public.analytics_events (install_id, created_at desc);
create index if not exists analytics_events_type_idx
  on public.analytics_events (type, created_at desc);
create index if not exists crash_reports_created_at_idx
  on public.crash_reports (created_at desc);


-- ─────────────────────────────────────
-- Pings de instalación · usuarios activos
--
-- Un ping por instalación y día. Es la tabla que responde "cuánta gente usa
-- Flux hoy", y se mantiene barata: la app hace upsert sobre la misma fila
-- durante todo el día en vez de acumular filas.
--
-- `source` distingue de dónde vino:
--   'app'     → la app arrancó y la telemetría está activada (opt-in).
--   'updater' → comprobación de actualización, sin install_id. Ver la columna
--               `visitor_hash` más abajo.
-- ─────────────────────────────────────
create table if not exists public.app_pings (
  install_id  text        not null,
  day         date        not null,
  source      text        not null default 'app',
  app_version text,
  platform    text,
  hits        integer     not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (install_id, day)
);

alter table public.app_pings enable row level security;

create index if not exists app_pings_day_idx on public.app_pings (day desc);


-- ─────────────────────────────────────
-- Pings del updater
--
-- El updater de Tauri no puede mandar un install_id: la URL del endpoint se
-- fija en tauri.conf.json y solo admite los placeholders de versión/target.
-- Así que estos pings se cuentan sin identificador persistente.
--
-- `visitor_hash` = sha256(sal_del_día + ip + user_agent). La sal rota cada día
-- y no se guarda en ningún sitio consultable, así que el hash no es reversible
-- ni se puede correlacionar de un día para otro. Es el mismo enfoque que usa
-- Plausible. La IP en crudo no se escribe nunca.
--
-- Esto cuenta como dato personal en el sentido amplio del RGPD aunque no se
-- pueda revertir. Está documentado en docs/ANALYTICS.md y debe reflejarse en
-- la política de privacidad antes de publicar la versión que lo use.
-- ─────────────────────────────────────
create table if not exists public.updater_pings (
  visitor_hash text        not null,
  day          date        not null,
  app_version  text,
  target       text,
  arch         text,
  hits         integer     not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (visitor_hash, day)
);

alter table public.updater_pings enable row level security;

create index if not exists updater_pings_day_idx on public.updater_pings (day desc);

-- La sal diaria del hash. Se genera sola la primera vez que se usa y se
-- limpia sola: sin filas viejas no hay forma de recalcular hashes pasados.
create table if not exists public.updater_salt (
  day  date primary key,
  salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

alter table public.updater_salt enable row level security;

create or replace function public.updater_salt_for_today()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s text;
begin
  insert into public.updater_salt (day)
  values (current_date)
  on conflict (day) do nothing;

  select salt into s from public.updater_salt where day = current_date;

  -- Las sales de más de dos días no sirven para nada y solo son un riesgo.
  delete from public.updater_salt where day < current_date - 2;

  return s;
end;
$$;


-- ═══════════════════════════════════════════════════════════════
-- Upserts de ping
--
-- En funciones y no en el cliente para que el "una fila por instalación y día"
-- sea una garantía del esquema y no una convención que se rompe el día que
-- alguien escriba un insert a mano.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.record_app_ping(
  p_install_id  text,
  p_app_version text default null,
  p_platform    text default null
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.app_pings (install_id, day, source, app_version, platform)
  values (p_install_id, current_date, 'app', p_app_version, p_platform)
  on conflict (install_id, day) do update
    set hits        = public.app_pings.hits + 1,
        last_seen   = now(),
        app_version = coalesce(excluded.app_version, public.app_pings.app_version),
        platform    = coalesce(excluded.platform,    public.app_pings.platform);
$$;

-- Devuelve el hash del día sin exponer nunca la sal ni la IP al llamante.
create or replace function public.record_updater_ping(
  p_ip          text,
  p_user_agent  text,
  p_app_version text default null,
  p_target      text default null,
  p_arch        text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  v_hash := encode(
    extensions.digest(public.updater_salt_for_today() || coalesce(p_ip, '') || coalesce(p_user_agent, ''), 'sha256'),
    'hex'
  );

  insert into public.updater_pings (visitor_hash, day, app_version, target, arch)
  values (v_hash, current_date, p_app_version, p_target, p_arch)
  on conflict (visitor_hash, day) do update
    set hits        = public.updater_pings.hits + 1,
        last_seen   = now(),
        app_version = coalesce(excluded.app_version, public.updater_pings.app_version),
        target      = coalesce(excluded.target,      public.updater_pings.target),
        arch        = coalesce(excluded.arch,        public.updater_pings.arch);
end;
$$;

-- Solo service_role. Las edge functions usan esa key; ningún cliente llega.
--
-- Postgres concede EXECUTE a PUBLIC por defecto, así que sin este revoke
-- cualquiera con la anon key podría inflar los contadores por RPC. El grant
-- explícito a service_role va después: el revoke a PUBLIC también le afectaría.
revoke all on function public.record_app_ping(text, text, text)                 from public, anon, authenticated;
revoke all on function public.record_updater_ping(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.updater_salt_for_today()                          from public, anon, authenticated;

grant execute on function public.record_app_ping(text, text, text)                 to service_role;
grant execute on function public.record_updater_ping(text, text, text, text, text) to service_role;


-- ═══════════════════════════════════════════════════════════════
-- Vistas de lectura
--
-- Se consultan con service_role desde `npm run stats:app` o desde el SQL
-- Editor. Ningún rol de cliente las puede leer.
--
-- OJO: crear la vista NO basta para eso. Una vista se ejecuta con los
-- privilegios de su propietario (`postgres`, que salta RLS), así que por
-- defecto expone todas las filas a cualquiera con la anon key — que va dentro
-- del binario. El cierre está en 20260905010000_secure_telemetry_views.sql y
-- es obligatorio: sin esa migración, estas vistas son públicas.
-- ═══════════════════════════════════════════════════════════════

-- Usuarios activos por día, uniendo las dos fuentes de señal.
create or replace view public.telemetry_dau as
select
  day,
  count(*) filter (where source = 'app')     as installs_app,
  sum(hits) filter (where source = 'app')    as opens_app
from public.app_pings
group by day
order by day desc;

create or replace view public.telemetry_updater_dau as
select
  day,
  count(*)   as visitors,
  sum(hits)  as checks
from public.updater_pings
group by day
order by day desc;

-- Qué se usa de verdad dentro de la app. Cuenta instalaciones distintas, no
-- eventos: 400 eventos de una sola persona no son señal de producto.
create or replace view public.telemetry_feature_use as
select
  date(created_at)                                as day,
  type,
  count(*)                                        as events,
  count(distinct coalesce(install_id, user_id::text)) as installs
from public.analytics_events
group by 1, 2
order by 1 desc, installs desc;

-- Uso por sección de la app. `route_view` lleva la ruta dentro de `data`, así
-- que sin desanidarla todas las secciones se ven como un único evento y no hay
-- forma de saber si gRPC o el mock server le importan a alguien.
create or replace view public.telemetry_route_use as
select
  data->>'route'                as route,
  count(*)                      as views,
  count(distinct install_id)    as installs,
  max(date(created_at))         as last_day
from public.analytics_events
where type = 'route_view'
  and data ? 'route'
group by 1
order by installs desc, views desc;

-- Primer día de cada instalación: la base para calcular retención.
create or replace view public.telemetry_install_first_seen as
select
  install_id,
  min(day)                                      as first_day,
  max(day)                                      as last_day,
  count(distinct day)                           as active_days,
  min(app_version)                              as first_version,
  max(platform)                                 as platform
from public.app_pings
where source = 'app'
group by install_id;

-- Retención por cohorte semanal. Responde la pregunta que ninguna métrica de
-- la landing puede responder: de los que instalaron, ¿cuántos siguen aquí?
create or replace view public.telemetry_retention as
select
  date_trunc('week', f.first_day)::date       as cohort_week,
  floor((p.day - f.first_day) / 7.0)::int     as week_offset,
  count(distinct p.install_id)                as installs
from public.app_pings p
join public.telemetry_install_first_seen f on f.install_id = p.install_id
where p.source = 'app'
group by 1, 2
order by 1 desc, 2 asc;

-- Crashes agrupados por mensaje, para saber qué arreglar primero.
create or replace view public.telemetry_crashes as
select
  date(created_at)          as day,
  app_version,
  left(message, 200)        as message,
  count(*)                  as occurrences,
  count(distinct install_id) as installs
from public.crash_reports
group by 1, 2, 3
order by occurrences desc;
