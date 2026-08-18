-- ═══════════════════════════════════════════════════════════════
-- Flux · Esquema base
--
-- Tablas de sincronización (historial, colecciones, ajustes, entornos)
-- y telemetría (eventos, crashes).
--
-- El tier gratuito de IA vive aparte, en ai_usage.sql.
--
-- Aplicar pegando este archivo en el SQL Editor de Supabase.
-- El script es idempotente: se puede ejecutar varias veces sin efectos.
--
-- NOTA: transcrito desde el esquema ya desplegado. Si has tocado algo
-- directamente en el panel de Supabase, verifica que sigue coincidiendo
-- antes de tratar este archivo como fuente de verdad.
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────
-- Historial de requests
-- ─────────────────────────────────────
create table if not exists public.flux_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  method      text not null,
  url         text not null,
  status      integer not null,
  duration_ms integer not null,
  environment text not null default '',
  created_at  timestamptz not null default now()
);

alter table public.flux_history enable row level security;

drop policy if exists "own history" on public.flux_history;
create policy "own history" on public.flux_history
  for all using (auth.uid() = user_id);


-- ─────────────────────────────────────
-- Collections
-- ─────────────────────────────────────
create table if not exists public.flux_collections (
  id         text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

alter table public.flux_collections enable row level security;

drop policy if exists "own collections" on public.flux_collections;
create policy "own collections" on public.flux_collections
  for all using (auth.uid() = user_id);


-- ─────────────────────────────────────
-- Settings
--
-- El cliente filtra DEVICE_ONLY_KEYS antes de subir (src/lib/sync.ts):
-- claudeApiKey, clientCertPem y clientKeyPem nunca salen del dispositivo.
-- ─────────────────────────────────────
create table if not exists public.flux_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.flux_settings enable row level security;

drop policy if exists "own settings" on public.flux_settings;
create policy "own settings" on public.flux_settings
  for all using (auth.uid() = user_id);


-- ─────────────────────────────────────
-- Environments
-- ─────────────────────────────────────
create table if not exists public.flux_environments (
  id         text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

alter table public.flux_environments enable row level security;

drop policy if exists "Users manage own environments" on public.flux_environments;
create policy "Users manage own environments" on public.flux_environments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─────────────────────────────────────
-- Telemetría
--
-- Solo usuarios autenticados pueden insertar sus propios datos.
-- Sin policy de select: nadie lee estas tablas con un JWT de usuario,
-- solo service_role desde el panel.
-- user_id usa `on delete set null` para conservar los agregados
-- después de que una cuenta se borre.
-- ─────────────────────────────────────
create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  type        text not null,
  data        jsonb,
  ts          bigint not null,
  app_version text,
  created_at  timestamptz default now()
);

create table if not exists public.crash_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  message     text not null,
  ts          bigint not null,
  app_version text,
  created_at  timestamptz default now()
);

alter table public.analytics_events enable row level security;
alter table public.crash_reports   enable row level security;

drop policy if exists "insert own events" on public.analytics_events;
create policy "insert own events" on public.analytics_events
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists "insert own crashes" on public.crash_reports;
create policy "insert own crashes" on public.crash_reports
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);
