-- ═══════════════════════════════════════════════════════════════
-- Flux · Tier gratuito de IA (beta hasta 2026-12-31)
--
-- Cuota: 100 acciones al mes, con tope de 20 al día.
-- Modelo: claude-haiku-4-5, forzado del lado del proxy.
--
-- Ambas ventanas se calculan en UTC y se reinician solas: no hace falta
-- ningún cron. El reinicio ocurre dentro de la misma sentencia que
-- reserva la acción, comparando el periodo guardado con el actual.
--
-- Aplicar pegando este archivo en el SQL Editor de Supabase.
-- El script es idempotente y actualiza en sitio una instalación previa.
--
-- IMPORTANTE: a diferencia del resto del esquema, estas tablas NO son
-- escribibles con el JWT del usuario. Solo el proxy, usando la clave
-- service_role, puede modificarlas. Si el usuario pudiera escribir su
-- propia fila, reiniciaría su cuota desde la consola del navegador.
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────
-- Contador de cuota
-- ─────────────────────────────────────
create table if not exists public.flux_ai_usage (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  period      date        not null default date_trunc('month', now() at time zone 'utc')::date,
  actions     integer     not null default 0,   -- consumidas este mes
  day         date        not null default (now() at time zone 'utc')::date,
  day_actions integer     not null default 0,   -- consumidas hoy
  in_tokens   bigint      not null default 0,   -- acumulado histórico
  out_tokens  bigint      not null default 0,   -- acumulado histórico
  updated_at  timestamptz not null default now()
);

-- Para instalaciones anteriores a las ventanas mensual/diaria.
alter table public.flux_ai_usage
  add column if not exists period      date    not null default date_trunc('month', now() at time zone 'utc')::date,
  add column if not exists day         date    not null default (now() at time zone 'utc')::date,
  add column if not exists day_actions integer not null default 0;

alter table public.flux_ai_usage enable row level security;

-- Solo SELECT. Sin policies de insert/update/delete, ningún JWT de usuario
-- puede escribir. Esta policy es la que alimenta el contador en Settings.
-- Si el usuario nunca ha usado la IA no habrá fila: el cliente debe tratar
-- la ausencia de fila como "0 acciones consumidas".
drop policy if exists "read own ai usage" on public.flux_ai_usage;
create policy "read own ai usage" on public.flux_ai_usage
  for select using (auth.uid() = user_id);


-- ─────────────────────────────────────
-- Libro de llamadas (auditoría y detección de abuso)
-- ─────────────────────────────────────
create table if not exists public.flux_ai_calls (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid    not null references auth.users(id) on delete cascade,
  fn         text    not null,   -- generate_tests, debug_assist, edit_content, fix_assertion, analyze_test_failures
  model      text    not null,
  in_tokens  integer not null,
  out_tokens integer not null,
  created_at timestamptz not null default now()
);

create index if not exists flux_ai_calls_user_created_idx
  on public.flux_ai_calls (user_id, created_at desc);

alter table public.flux_ai_calls enable row level security;
-- Sin policies a propósito: acceso exclusivo de service_role.


-- ─────────────────────────────────────
-- Reserva atómica de una acción
--
-- Se llama ANTES de contactar con Anthropic. Reservar antes evita que dos
-- peticiones simultáneas lean el mismo saldo y ambas pasen el control.
--
-- Devuelve una fila:
--   ok         true si la acción queda reservada
--   reason     null | 'month_limit' | 'day_limit'
--   month_used acciones consumidas este mes (tras la reserva)
--   day_used   acciones consumidas hoy (tras la reserva)
--
-- El proxy usa `reason` para elegir el mensaje: con 'day_limit' el usuario
-- vuelve mañana, con 'month_limit' tiene que esperar al mes que viene.
-- ─────────────────────────────────────
create or replace function public.flux_ai_reserve(
  p_user        uuid,
  p_month_limit integer,
  p_day_limit   integer
)
returns table (ok boolean, reason text, month_used integer, day_used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_today date := (now() at time zone 'utc')::date;
  v_m integer;
  v_d integer;
begin
  insert into flux_ai_usage (user_id, period, day)
  values (p_user, v_month, v_today)
  on conflict (user_id) do nothing;

  -- Reinicio de ventana e incremento en una sola sentencia. El UPDATE toma
  -- el lock de la fila, así que las llamadas concurrentes se serializan.
  update flux_ai_usage
     set actions     = (case when period = v_month then actions     else 0 end) + 1,
         day_actions = (case when day    = v_today then day_actions else 0 end) + 1,
         period      = v_month,
         day         = v_today,
         updated_at  = now()
   where user_id = p_user
     and (case when period = v_month then actions     else 0 end) < p_month_limit
     and (case when day    = v_today then day_actions else 0 end) < p_day_limit
  returning actions, day_actions into v_m, v_d;

  if v_m is not null then
    return query select true, null::text, v_m, v_d;
    return;
  end if;

  -- No se reservó: averigua cuál de los dos topes bloqueó.
  select (case when period = v_month then actions     else 0 end),
         (case when day    = v_today then day_actions else 0 end)
    into v_m, v_d
    from flux_ai_usage
   where user_id = p_user;

  -- El mes manda: si está agotado, esperar a mañana no sirve de nada.
  if v_m >= p_month_limit then
    return query select false, 'month_limit'::text, v_m, v_d;
  else
    return query select false, 'day_limit'::text, v_m, v_d;
  end if;
end;
$$;


-- ─────────────────────────────────────
-- Liquidación tras una llamada correcta
--
-- Suma los tokens reales de usage y registra la llamada en el libro.
-- Una sola ida y vuelta desde el proxy.
-- ─────────────────────────────────────
create or replace function public.flux_ai_settle(
  p_user  uuid,
  p_fn    text,
  p_model text,
  p_in    integer,
  p_out   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update flux_ai_usage
     set in_tokens  = in_tokens  + p_in,
         out_tokens = out_tokens + p_out,
         updated_at = now()
   where user_id = p_user;

  insert into flux_ai_calls (user_id, fn, model, in_tokens, out_tokens)
  values (p_user, p_fn, p_model, p_in, p_out);
end;
$$;


-- ─────────────────────────────────────
-- Devolución del crédito si Anthropic falla
--
-- El usuario no debe pagar una acción que nunca recibió.
-- Devuelve en las dos ventanas.
-- ─────────────────────────────────────
create or replace function public.flux_ai_refund(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update flux_ai_usage
     set actions     = greatest(actions - 1, 0),
         day_actions = greatest(day_actions - 1, 0),
         updated_at  = now()
   where user_id = p_user;
end;
$$;


-- ─────────────────────────────────────
-- Llamadas recientes
--
-- Secundaria: con el tope diario de 20, el abuso grave ya está cortado.
-- Sirve para detectar ráfagas dentro del día (por ejemplo, rechazar si
-- devuelve más de 10 en 60 segundos).
-- ─────────────────────────────────────
create or replace function public.flux_ai_recent_calls(p_user uuid, p_minutes integer)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
    from flux_ai_calls
   where user_id = p_user
     and created_at > now() - make_interval(mins => p_minutes);
$$;


-- ─────────────────────────────────────
-- Gasto global del mes (para el tope de $250)
--
-- El proxy la consulta al arrancar y de forma periódica. Precios de
-- Haiku 4.5: $1 por millón de entrada, $5 por millón de salida.
-- ─────────────────────────────────────
create or replace function public.flux_ai_month_cost()
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(in_tokens) / 1000000.0 * 1.0
                + sum(out_tokens) / 1000000.0 * 5.0, 0)::numeric
    from flux_ai_calls
   where created_at >= date_trunc('month', now() at time zone 'utc');
$$;


-- ─────────────────────────────────────
-- Cierre de permisos
--
-- Las funciones security definer son ejecutables por public por defecto,
-- y Supabase concede execute a anon/authenticated en el esquema public.
-- Sin estos revokes, cualquier usuario autenticado podría llamar a
-- flux_ai_refund en bucle y regalarse acciones infinitas.
-- ─────────────────────────────────────
revoke execute on function public.flux_ai_reserve(uuid, integer, integer)            from public, anon, authenticated;
revoke execute on function public.flux_ai_settle(uuid, text, text, integer, integer)  from public, anon, authenticated;
revoke execute on function public.flux_ai_refund(uuid)                                from public, anon, authenticated;
revoke execute on function public.flux_ai_recent_calls(uuid, integer)                 from public, anon, authenticated;
revoke execute on function public.flux_ai_month_cost()                                from public, anon, authenticated;
