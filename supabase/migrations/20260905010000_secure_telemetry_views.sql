-- ═══════════════════════════════════════════════════════════════
-- Flux · Cierre de las vistas de telemetría
--
-- CORRIGE UN FALLO DE 20260905000000_telemetry_anon.sql
--
-- Aquella migración creó siete vistas sobre tablas con RLS activo dando por
-- hecho que heredarían esa protección. No la heredan: una vista de Postgres se
-- ejecuta con los privilegios de su PROPIETARIO, no con los de quien consulta.
-- El propietario es `postgres`, que salta RLS, así que las vistas exponían
-- todas las filas a cualquiera.
--
-- Y "cualquiera" es literal: la anon key de Supabase viaja dentro de cada
-- binario de Flux y está commiteada en `src/lib/supabase.ts`. Con ella,
-- `GET /rest/v1/telemetry_crashes` devolvía mensajes de crash reales — que en
-- los clientes anteriores a esta versión van SIN pasar por `redact()`, así que
-- podían llevar URLs y rutas de usuario dentro.
--
-- El resto de vistas parecían sanas solo porque sus tablas estaban vacías.
-- Tenían el mismo agujero.
--
-- DOS CIERRES, A PROPÓSITO
--
-- 1. `revoke select`  → funciona en cualquier versión de Postgres y es la
--                       garantía dura: anon y authenticated no llegan.
-- 2. `security_invoker` → hace que la vista respete el RLS de quien consulta,
--                       no el del propietario. Es el arreglo de fondo, pero
--                       necesita Postgres 15+, así que va detrás del revoke y
--                       no como única defensa.
--
-- Las vistas se leen solo con service_role, desde `npm run stats:app` o el SQL
-- Editor. Ningún cliente las necesita.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v text;
  views text[] := array[
    'telemetry_dau',
    'telemetry_updater_dau',
    'telemetry_feature_use',
    'telemetry_route_use',
    'telemetry_install_first_seen',
    'telemetry_retention',
    'telemetry_crashes'
  ];
begin
  foreach v in array views loop
    -- Garantía dura primero.
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);

    -- Arreglo de fondo. En Postgres < 15 la opción no existe: el revoke de
    -- arriba ya deja la vista cerrada, así que se ignora el fallo.
    begin
      execute format('alter view public.%I set (security_invoker = on)', v);
    exception when others then
      raise notice 'security_invoker no disponible para %, cubierto por el revoke', v;
    end;
  end loop;
end;
$$;


-- Las tablas base no dependían de las vistas, pero conviene dejar constancia
-- de que su cierre es intencionado y no un descuido: nadie lee telemetría con
-- una key de cliente. Sin policy de select, RLS devuelve cero filas.
revoke select on public.analytics_events from anon, authenticated;
revoke select on public.crash_reports    from anon, authenticated;
revoke all    on public.app_pings        from anon, authenticated;
revoke all    on public.updater_pings    from anon, authenticated;
revoke all    on public.updater_salt     from anon, authenticated;


-- ─────────────────────────────────────
-- Comprobación
--
-- Tras aplicar esto, con la anon key:
--
--   curl -s "https://zmzfupygrhseljaxzyeb.supabase.co/rest/v1/telemetry_crashes?select=*" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
--
-- debe responder 401 con `permission denied`, NO un array de filas.
-- ─────────────────────────────────────
