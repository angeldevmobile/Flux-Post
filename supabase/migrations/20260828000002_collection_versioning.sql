-- ═══════════════════════════════════════════════════════════════
-- 20260828000002 · versionado de colecciones
--
-- Hasta ahora `pushCollection` subia la coleccion entera y el ultimo en
-- escribir ganaba, sin aviso. `updated_at` existia pero nadie lo comparaba, y
-- ademas lo ponia el cliente (`new Date().toISOString()`), asi que una maquina
-- con el reloj desfasado ganaba o perdia siempre.
--
-- Aqui entra un contador que solo toca el servidor.
--
-- Compatible con los clientes que ya estan instalados: siguen haciendo `upsert`
-- directo contra la tabla y el trigger les lleva la version sin que lo sepan.
-- Lo que no tienen es la deteccion de conflicto, que vive en la RPC.
-- ═══════════════════════════════════════════════════════════════

alter table public.flux_collections
  add column if not exists version bigint not null default 1;


-- ─────────────────────────────────────
-- El contador lo lleva el servidor
--
-- En trigger y no en la RPC a proposito: mientras haya clientes viejos
-- escribiendo por `upsert` directo, la RPC no es el unico camino de escritura.
-- Si el incremento viviera solo ahi, esas escrituras dejarian la version
-- congelada y el conflicto se volveria indetectable.
-- ─────────────────────────────────────
create or replace function public.flux_bump_collection_version()
returns trigger
language plpgsql
as $func$
begin
  new.version    := old.version + 1;
  new.updated_at := now();   -- de servidor: el del cliente no es fiable
  return new;
end;
$func$;

drop trigger if exists flux_collections_version on public.flux_collections;
create trigger flux_collections_version
  before update on public.flux_collections
  for each row execute function public.flux_bump_collection_version();


-- ─────────────────────────────────────
-- Guardado condicional
--
-- `p_base` es la version sobre la que el cliente edito. Devuelve:
--   conflict = false → guardado, `version` es la nueva
--   conflict = true  → alguien escribio en medio; `version` y `remote` traen
--                      lo que hay ahora, para pintar el diff sin otra vuelta
--
-- Se apoya en el trigger para incrementar: si lo hiciera aqui tambien, cada
-- guardado sumaria dos.
-- ─────────────────────────────────────
create or replace function public.flux_put_collection(
  p_id   text,
  p_data jsonb,
  p_base bigint
)
returns table (version bigint, conflict boolean, remote jsonb)
language plpgsql
security invoker   -- que RLS siga aplicando: la fila es del usuario o no lo es
set search_path = public
as $func$
declare
  v_current bigint;
  v_data    jsonb;
  v_new     bigint;
begin
  select c.version, c.data into v_current, v_data
    from flux_collections c
   where c.id = p_id and c.user_id = auth.uid();

  -- No existia: alta.
  if v_current is null then
    insert into flux_collections (id, user_id, data, updated_at)
    values (p_id, auth.uid(), p_data, now());
    return query select 1::bigint, false, null::jsonb;
    return;
  end if;

  -- Sin base conocida sobre una fila que ya existe: el cliente no sabe de
  -- donde parte, asi que no se le deja pisar. Pasa al reinstalar, o al
  -- sincronizar por primera vez una coleccion creada offline.
  if p_base is null or p_base <> v_current then
    return query select v_current, true, v_data;
    return;
  end if;

  update flux_collections c
     set data = p_data
   where c.id = p_id and c.user_id = auth.uid() and c.version = p_base
  returning c.version into v_new;   -- ya incrementada por el trigger

  -- Carrera entre el select y el update: otra escritura se colo en medio.
  if v_new is null then
    select c.version, c.data into v_current, v_data
      from flux_collections c
     where c.id = p_id and c.user_id = auth.uid();
    return query select v_current, true, v_data;
    return;
  end if;

  return query select v_new, false, null::jsonb;
end;
$func$;

revoke execute on function public.flux_put_collection(text, jsonb, bigint) from public, anon;
grant  execute on function public.flux_put_collection(text, jsonb, bigint) to authenticated;

insert into public.flux_schema_migrations (version, name)
values ('20260828000002', 'collection_versioning')
on conflict (version) do nothing;
