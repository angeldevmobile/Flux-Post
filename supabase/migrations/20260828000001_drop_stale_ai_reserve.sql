-- ═══════════════════════════════════════════════════════════════
-- 20260828000001 · retirada de la sobrecarga obsoleta de flux_ai_reserve
--
-- La primera version de la cuota tenia solo ventana mensual, con la firma
-- (uuid, integer). Al anadir el tope diario se escribio (uuid, integer,
-- integer), pero `create or replace function` solo reemplaza cuando la firma
-- coincide: con una distinta crea una sobrecarga y deja la anterior donde
-- estaba. Produccion arrastra las dos desde entonces; una instancia nueva
-- creada desde `migrations/` nace solo con la correcta.
--
-- No es un parche de seguridad. Ambas estan revocadas para anon y
-- authenticated, comprobado sobre el proyecto real, asi que solo service_role
-- podia llamarlas. Es limpieza de deriva: mientras las dos convivan,
-- produccion y una instalacion limpia no son el mismo esquema.
--
-- El motivo de fondo para no dejarla ahi es que una funcion security definer
-- muerta se vuelve peligrosa el dia que alguien escriba un
-- `grant execute on all functions in schema public`.
--
-- PRECONDICION: el proxy desplegado tiene que estar llamando a la version de
-- tres argumentos. Es su unico consumidor posible, y no vive en este
-- repositorio, asi que hay que verificarlo ahi antes de aplicar esto.
-- ═══════════════════════════════════════════════════════════════

drop function if exists public.flux_ai_reserve(uuid, integer);

insert into public.flux_schema_migrations (version, name)
values ('20260828000001', 'drop_stale_ai_reserve')
on conflict (version) do nothing;
