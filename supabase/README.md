# Base de datos

El esquema vive en `migrations/`, en ficheros versionados y ordenados por nombre.
Es la fuente de verdad: **nada se toca a mano en el panel de Supabase.**

Antes había dos ficheros sueltos (`schema.sql` y `ai_usage.sql`) que se pegaban en el SQL
Editor, con un comentario admitiendo que podían haber divergido de lo desplegado. Ese
comentario era el problema: sin forma de saber qué está aplicado, el fichero no es una
fuente de verdad sino una aproximación. Los dos ficheros están ahora fundidos, sin cambios
de contenido, en `20260816000000_baseline.sql`.

## Aplicar

```bash
supabase link --project-ref <ref>   # una vez por máquina
supabase db push
```

El baseline es idempotente de principio a fin (`create table if not exists`,
`create or replace function`, `drop policy if exists` antes de cada `create policy`), así
que aplicarlo sobre el proyecto de producción, que ya lo tiene todo, no hace nada. **No
hace falta `supabase migration repair`.**

## Añadir una migración

```bash
supabase migration new <nombre>
```

Genera `migrations/<timestamp>_<nombre>.sql`. Dos reglas:

**1. Termina siempre registrándose.** Es lo que permite a la app saber contra qué esquema
está hablando:

```sql
insert into public.flux_schema_migrations (version, name)
values ('<timestamp>', '<nombre>')
on conflict (version) do nothing;
```

**2. Nunca destructiva mientras haya clientes viejos vivos.** Hay usuarios con la app
instalada que siguen escribiendo con el esquema anterior. Una columna nueva entra como
`nullable`; el `not null` llega en una migración posterior, cuando la telemetría
(`analytics_events.app_version`) diga que ya no queda nadie en la versión antigua. El plan
completo está en `../TEAM-WORKSPACES.md` §5.

Si la migración añade una columna que el cliente antiguo no rellena, hace falta además un
trigger que le dé valor, mantenido hasta que se pueda retirar.

## Versión del esquema

`flux_schema_migrations` es la tabla que la app consulta al sincronizar. El CLI lleva su
propio registro en `supabase_migrations.schema_migrations`, pero ese esquema no está
expuesto por PostgREST y el cliente no puede leerlo.

La constante `REQUIRED_SCHEMA_VERSION` en `src/lib/schemaVersion.ts` tiene que subir en el
mismo commit que la migración que la necesita.

## Staging

Falta por montar: un segundo proyecto de Supabase contra el que CI aplique las migraciones
en cada PR. Sin eso, la primera vez que una migración se ejecuta de verdad es en
producción. Es trabajo manual de consola, no de repositorio:

1. Crear el proyecto de staging.
2. Guardar `SUPABASE_ACCESS_TOKEN` y `SUPABASE_STAGING_PROJECT_REF` como secretos del
   repositorio.
3. El job `migrations` de `.github/workflows/ci.yml` los usa si están presentes.
