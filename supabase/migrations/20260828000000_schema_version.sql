-- ═══════════════════════════════════════════════════════════════
-- 20260828000000 · registro de version del esquema
--
-- Hasta ahora no habia forma de saber, desde la app, si la base de datos a la
-- que se esta hablando tiene las tablas que esa version del cliente espera.
-- Con un unico proyecto propio se podia vivir con ello; con clientes que
-- ejecutan su propia instancia (fase 8 del plan) no.
--
-- El CLI de Supabase ya lleva su propio registro en
-- `supabase_migrations.schema_migrations`, pero ese esquema no esta expuesto
-- por PostgREST, asi que el cliente no puede consultarlo. Esta tabla es la
-- version legible por la app.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.flux_schema_migrations (
  version    text primary key,   -- el prefijo del fichero: 20260828000000
  name       text not null,
  applied_at timestamptz not null default now()
);

alter table public.flux_schema_migrations enable row level security;

-- Lectura para cualquier sesion autenticada: la app compara este valor con el
-- que necesita y avisa si el backend va por detras. Sin policy de escritura,
-- asi que ningun JWT de usuario puede falsear el numero.
drop policy if exists "read schema version" on public.flux_schema_migrations;
create policy "read schema version" on public.flux_schema_migrations
  for select to authenticated using (true);

-- El baseline es anterior a esta tabla, asi que se registra desde aqui.
insert into public.flux_schema_migrations (version, name) values
  ('20260816000000', 'baseline'),
  ('20260828000000', 'schema_version')
on conflict (version) do nothing;
