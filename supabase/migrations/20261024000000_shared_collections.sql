-- ═══════════════════════════════════════════════════════════════
-- 20261024000000 · colecciones compartidas por link
--
-- Un link es una COPIA de la coleccion en el momento de compartirla, no una
-- coleccion viva: quien lo abre se lleva la suya y lo que edite no vuelve.
-- Es la mitad barata de TEAM-WORKSPACES.md, y mide si alguien quiere la otra.
--
-- La tabla queda cerrada a `anon` y `authenticated`. Todo pasa por RPCs:
--
--   flux_share_collection     crear (con cuenta), con limites de tamaño y numero
--   flux_get_shared_collection leer un link por su id (sin cuenta)
--   flux_revoke_shared_collection revocar uno propio
--
-- Leer sin cuenta es a proposito: quien recibe el link no deberia tener que
-- registrarse para ver lo que le han mandado. Lo que impide enumerar es que el
-- id son 128 bits aleatorios y que no hay ningun `select` abierto sobre la tabla.
--
-- Los secretos se quitan en el cliente antes de subir (src/lib/share.ts). Aqui
-- no se puede: el servidor no sabe que valor es un token y cual un id de usuario.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.flux_shared_collections (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  -- Cuantas veces se ha abierto. Es la señal de si compartir le sirve a alguien.
  open_count  bigint not null default 0,
  last_opened_at timestamptz
);

create index if not exists flux_shared_collections_owner_idx
  on public.flux_shared_collections (owner_id, created_at desc);

alter table public.flux_shared_collections enable row level security;

-- Supabase concede todo sobre `public` a anon y authenticated por defecto. Aqui
-- no queremos ningun camino directo: ni insertar saltandose los limites, ni
-- leer filas ajenas, ni cambiar `data` de un link ya repartido.
revoke all on public.flux_shared_collections from anon, authenticated;

-- El dueño puede listar sus links (pantalla "Mis links"), nada mas.
drop policy if exists "own shares" on public.flux_shared_collections;
create policy "own shares" on public.flux_shared_collections
  for select to authenticated using (auth.uid() = owner_id);

grant select (id, name, created_at, expires_at, revoked_at, open_count, last_opened_at)
  on public.flux_shared_collections to authenticated;


-- ─────────────────────────────────────
-- Crear
--
-- `security definer` porque la tabla no admite insert directo. Por eso mismo
-- la funcion comprueba `auth.uid()` ella misma y fija el dueño: nunca lo toma
-- del cliente.
-- ─────────────────────────────────────
create or replace function public.flux_share_collection(
  p_name            text,
  p_data            jsonb,
  p_expires_in_days int default null
)
returns table (id text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid    uuid := auth.uid();
  v_id     text;
  v_expiry timestamptz;
  v_active int;
begin
  if v_uid is null then
    raise exception 'sign in to share a collection' using errcode = '28000';
  end if;

  -- 1 MB de JSON es una coleccion de miles de requests. Mas que eso es abuso o
  -- un body binario pegado dentro, y ninguno de los dos va en un link.
  if octet_length(p_data::text) > 1048576 then
    raise exception 'collection too large to share (max 1 MB)' using errcode = '54000';
  end if;

  select count(*) into v_active
    from flux_shared_collections s
   where s.owner_id = v_uid
     and s.revoked_at is null
     and (s.expires_at is null or s.expires_at > now());
  if v_active >= 100 then
    raise exception 'too many active links (max 100), revoke some first' using errcode = '54000';
  end if;

  if p_expires_in_days is not null then
    if p_expires_in_days < 1 or p_expires_in_days > 365 then
      raise exception 'expiry must be between 1 and 365 days' using errcode = '22023';
    end if;
    v_expiry := now() + make_interval(days => p_expires_in_days);
  end if;

  -- 128 bits aleatorios en hex. `gen_random_uuid` dejaria 6 bits fijos y los
  -- guiones; esto es mas corto en la URL y sin estructura que adivinar.
  v_id := encode(extensions.gen_random_bytes(16), 'hex');

  insert into flux_shared_collections (id, owner_id, name, data, expires_at)
  values (v_id, v_uid, left(coalesce(nullif(trim(p_name), ''), 'Untitled'), 200), p_data, v_expiry);

  return query select v_id, v_expiry;
end;
$func$;

revoke execute on function public.flux_share_collection(text, jsonb, int) from public, anon;
grant  execute on function public.flux_share_collection(text, jsonb, int) to authenticated;


-- ─────────────────────────────────────
-- Leer
--
-- Abierta a anon: la pagina web del link y la app sin cuenta la llaman. Un link
-- revocado, caducado o inexistente devuelve cero filas, sin distinguir cual:
-- decir "existe pero esta revocado" confirmaria que el id fue valido.
-- ─────────────────────────────────────
create or replace function public.flux_get_shared_collection(p_id text)
returns table (name text, data jsonb, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $func$
begin
  if p_id !~ '^[0-9a-f]{32}$' then
    return;
  end if;

  -- En CTE: `return query` quiere un select, no un update suelto.
  return query
  with opened as (
    update flux_shared_collections s
       set open_count = s.open_count + 1,
           last_opened_at = now()
     where s.id = p_id
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
    returning s.name, s.data, s.created_at, s.expires_at
  )
  select o.name, o.data, o.created_at, o.expires_at from opened o;
end;
$func$;

revoke execute on function public.flux_get_shared_collection(text) from public;
grant  execute on function public.flux_get_shared_collection(text) to anon, authenticated;


-- ─────────────────────────────────────
-- Revocar
--
-- Solo el dueño, y solo marca: la fila se queda para que `open_count` siga
-- contando en las estadisticas. Devuelve si encontro algo que revocar.
-- ─────────────────────────────────────
create or replace function public.flux_revoke_shared_collection(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_found boolean;
begin
  update flux_shared_collections s
     set revoked_at = now()
   where s.id = p_id
     and s.owner_id = auth.uid()
     and s.revoked_at is null
  returning true into v_found;
  return coalesce(v_found, false);
end;
$func$;

revoke execute on function public.flux_revoke_shared_collection(text) from public, anon;
grant  execute on function public.flux_revoke_shared_collection(text) to authenticated;


insert into public.flux_schema_migrations (version, name)
values ('20261024000000', 'shared_collections')
on conflict (version) do nothing;
