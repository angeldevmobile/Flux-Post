# Team Workspaces — plan de implementación

> Documento de diseño. Estado: **propuesta**, sin implementar.
> Contexto: Flux 0.2.0, ya en producción con usuarios reales.

---

## 0. Decisión

Flux pasa de un modelo **estrictamente monousuario** a un modelo de **workspaces con
membresía**, con la nube como plano de coordinación y sincronización en tiempo real.

Se descarta explícitamente el camino barato (compartir vía repositorio de GitHub, que
ya existe parcialmente). El criterio elegido es **seguro y escalable**, aceptando que
el coste es del orden de meses y no de semanas.

El diferenciador frente a Postman no es la paridad de funciones — ahí ellos llevan una
década de ventaja — sino que el workspace pueda vivir en **la infraestructura del propio
cliente** (fase 8). Postman no puede ofrecer eso sin romper su negocio.

---

## 1. Estado actual

### 1.1 Lo que hay

| Pieza | Dónde | Modelo |
|---|---|---|
| Colecciones | YAML en disco (fuente de verdad) + espejo `jsonb` en Supabase | Por usuario |
| Entornos | `localStorage` + espejo `jsonb` en Supabase | Por usuario |
| Historial | SQLite local + `flux_history` | Por usuario |
| Ajustes | `localStorage` + `flux_settings` | Por usuario |
| Cuota de IA | `flux_ai_usage` + RPCs `security definer` | Por usuario |
| Compartir | Ruta GitHub: push/pull de YAML con un PAT | Manual, sin roles |

Las cuatro tablas de sync llevan `user_id` en la PK y una policy RLS
`auth.uid() = user_id`. No existe ninguna noción de organización o equipo.

### 1.2 Los tres defectos que bloquean cualquier trabajo en equipo

**A. El sync no es sync, es «restaurar en una máquina nueva».**
`pullCollections` (`src/lib/sync.ts`) llama a `loadCollection`, y el store hace
`if (exists) return s;` (`src/stores/collections.ts`): si la colección ya está en local,
**la versión de la nube se descarta en silencio**. `pushCollection` es fire-and-forget.
Existe una columna `updated_at` que nadie compara nunca.

Consecuencia inmediata: si dos personas editan la misma colección, el último en guardar
pisa al otro, sin aviso y sin posibilidad de recuperación. Y quien tira del sync no verá
jamás el cambio ajeno.

Este defecto ya afecta hoy a un usuario con dos máquinas.

**B. La colección es un blob.**
Cada guardado sube la colección **entera** como un `jsonb`. Sobre un blob no hay merge
posible: la unidad de conflicto es la colección completa, aunque dos personas hayan
tocado requests distintos. Además mueve cientos de KB por pulsación de guardado.

**C. Los secretos viajan en claro.**
`pushEnvironments` sube el entorno completo, incluyendo las variables marcadas en
`secretKeys` / `globalSecretKeys`. Están enmascaradas en la UI, pero en la tabla son
texto plano dentro de un `jsonb`. Aceptable para uso personal; inaceptable en cuanto se
comparte con terceros.

Hay una segunda vía de fuga, más discreta: **el historial guarda la URL ya interpolada**.
En `src/components/request/RequestPanel.tsx` se hace `req.url = resolveVariable(req.url)`
antes de enviar, y es esa URL resuelta la que se pasa a `saveHistory` y a `pushHistory`.
Una request con `?api_key={{API_KEY}}` acaba escribiendo el valor literal del secreto en
`flux_history.url`, en texto plano y sincronizado a la nube. Ocurre hoy, sin necesidad de
workspaces.

---

## 2. Principios

1. **La granularidad del conflicto define la granularidad del modelo.** Si dos personas
   pueden editar dos requests a la vez sin pisarse, el request es una fila.
2. **RLS es toda la frontera de seguridad.** La anon key es pública por diseño. Una
   policy sin test es un agujero sin descubrir.
3. **Nada destructivo mientras haya clientes viejos vivos.** Expand / contract, siempre.
4. **El servidor no debe poder leer un secreto que no necesita leer.**
5. **Lo que no se registra no existe.** El audit log entra en la primera fase de equipo,
   no después: los eventos no capturados no se pueden retrofitear.

---

## 3. Arquitectura destino

### 3.1 Workspaces y membresía

```sql
create type workspace_role as enum ('owner', 'admin', 'editor', 'viewer');

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id),
  personal   boolean not null default false,   -- el workspace implícito de cada usuario
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         workspace_role not null default 'viewer',
  invited_by   uuid references auth.users(id),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text not null,
  role         workspace_role not null default 'editor',
  token_hash   text not null,      -- sha256; el token en claro solo existe en el enlace
  invited_by   uuid not null references auth.users(id),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id)
);
```

Notas de diseño:

- **El token de invitación se guarda hasheado.** Si la base de datos se filtra, los
  enlaces pendientes no son utilizables.
- `personal = true` marca el workspace que se crea automáticamente por usuario. Permite
  que todo el producto hable un único idioma (todo pertenece a un workspace) sin obligar
  a nadie a entender el concepto para usar la app en solitario.
- `owner` es el único rol que puede borrar el workspace o transferir la propiedad. Debe
  haber siempre exactamente uno.

### 3.2 Colecciones normalizadas

```sql
create table collections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  base_url     text,
  position     integer not null default 0,
  created_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  version      bigint not null default 1
);

create table folders (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,                  -- denormalizado, ver abajo
  collection_id uuid not null references collections(id) on delete cascade,
  parent_id     uuid references folders(id) on delete cascade,
  name          text not null,
  position      integer not null default 0
);

create table requests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,                  -- denormalizado, ver abajo
  collection_id uuid not null references collections(id) on delete cascade,
  folder_id     uuid references folders(id) on delete cascade,
  name          text not null,
  kind          text not null default 'http',   -- 'http' | 'grpc'
  method        text,
  path          text,
  spec          jsonb not null default '{}',    -- headers, params, body, auth,
                                                -- scripts, extractors, tests, grpc
  position      integer not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  version       bigint not null default 1
);
```

**Por qué `spec` sigue siendo `jsonb`.** La normalización se lleva hasta donde llega el
conflicto, y no más allá. Dos personas editando el mismo request van a colisionar de
todos modos, así que explotar `headers`, `params` y `tests` en tres tablas más añade
complejidad sin comprar nada. El request es la unidad; dentro del request, un blob está
bien.

**Por qué `workspace_id` está denormalizado en `folders` y `requests`.** Dos razones
concretas, ambas de rendimiento:

1. La policy RLS puede resolverse sin un JOIN por fila.
2. Los filtros de Supabase Realtime solo admiten igualdad sobre **una** columna. Para
   suscribirse a «todo lo del workspace X» hace falta la columna ahí.

La consistencia se mantiene con un trigger `before insert or update` que la deriva de
`collection_id`. No debe ser escribible por el cliente.

### 3.3 RLS por membresía

El error clásico aquí es la recursión: una policy sobre `workspace_members` que consulta
`workspace_members`. Se evita con una función `security definer`, que salta RLS por
dentro:

```sql
create or replace function public.flux_role_in(p_ws uuid)
returns workspace_role
language sql
security definer
stable
set search_path = public
as $func$
  select role
    from public.workspace_members
   where workspace_id = p_ws
     and user_id = (select auth.uid())
$func$;

revoke execute on function public.flux_role_in(uuid) from public, anon;
grant  execute on function public.flux_role_in(uuid) to authenticated;
```

`(select auth.uid())` envuelto en subquery no es cosmético: así Postgres lo evalúa una
vez por sentencia en lugar de una vez por fila. Con colecciones grandes la diferencia es
de órdenes de magnitud.

Policies:

```sql
create policy "ws read" on requests
  for select using (flux_role_in(workspace_id) is not null);

create policy "ws write" on requests
  for all
  using      (flux_role_in(workspace_id) in ('owner','admin','editor'))
  with check (flux_role_in(workspace_id) in ('owner','admin','editor'));
```

**El `with check` es obligatorio, no decorativo.** Sin él, un editor podría hacer un
`UPDATE` moviendo una fila a un workspace del que no es miembro. El esquema actual ya lo
hace bien en `flux_environments`; hay que ser igual de explícito en todas.

### 3.4 Secretos

Los valores secretos **salen del blob del entorno** y pasan a tabla propia, cifrados en
reposo, sin policy de `select`:

```sql
create table workspace_secrets (
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  key            text not null,
  ciphertext     bytea not null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  primary key (workspace_id, environment_id, key)
);

alter table workspace_secrets enable row level security;
-- Sin policies a propósito: el acceso es exclusivamente por RPC.
```

El acceso va por funciones `security definer` que comprueban el rol **y escriben en el
audit log**. Consecuencia deseable: queda registrado quién leyó qué secreto y cuándo.

El entorno compartido lleva la **forma** (qué variables existen, cuáles son secretas);
el valor vive aparte y con su propio control de acceso. Esto ya deja a Flux por encima
de Postman, que guarda los *initial values* en claro en su nube.

**Capa 2, opt-in por workspace (fase posterior):** cifrado extremo a extremo, con clave
de datos generada en cliente y envuelta para cada miembro. El coste real no es el
cifrado, es la **distribución de claves**: Supabase autentica por email/OAuth y ahí no
hay ningún par de claves del usuario. Hay que generarlo, protegerlo con una passphrase y
resolver la recuperación — si se pierde, los secretos se pierden. Por eso es activable
por workspace y no el comportamiento por defecto: el usuario individual no debe pagar
esa UX.

**Revocación.** Expulsar a un miembro **no recupera lo que ya se sincronizó a su
máquina**. El flujo de expulsión tiene que ofrecer rotación de credenciales y decirlo de
forma explícita, en lugar de dar una falsa sensación de seguridad.

### 3.5 Concurrencia y tiempo real

Concurrencia optimista sobre la columna `version`:

```sql
update requests
   set spec       = $2,
       version    = version + 1,
       updated_at = now(),
       updated_by = (select auth.uid())
 where id = $1 and version = $3
returning version;
```

Cero filas devueltas = conflicto. La UI muestra un diff y deja elegir.
**Para ese diff se reutiliza la pantalla de compare que ya existe** (`src/routes/compare/`).

Realtime: canal por workspace con filtro `workspace_id=eq.<id>` sobre `postgres_changes`,
más un canal de *presence* para «quién está viendo qué request» — que es la señal visible
que justifica el plan de equipo a ojos del usuario.

> **Realtime no sirve de nada hasta que el defecto A esté arreglado.** Supabase entregará
> el evento con la fila nueva y el store la tirará a la basura. Es prerrequisito, no
> trabajo paralelo.

### 3.6 Audit log

```sql
create table workspace_audit (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  action       text not null,     -- member.invited, member.removed, role.changed,
                                  -- request.updated, secret.read, secret.updated, ...
  target       text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
```

Solo `select` para `admin` y `owner`. Escritura exclusiva desde funciones
`security definer`. Nunca se guarda el valor de un secreto en `detail`.

---

## 4. Fases

Cada fase es desplegable por separado y deja el producto en un estado coherente.

### Fase 0 — Infraestructura de migraciones

Había dos ficheros sueltos (`supabase/schema.sql`, `supabase/ai_usage.sql`) con un
comentario que admitía que podían haber divergido de lo desplegado. Eso ya era frágil para
una sola persona; con clientes ejecutando su propia instancia (fase 8) es inviable.

- [x] `supabase/migrations/` con ficheros versionados y ordenados.
- [x] Esquema desplegado reconciliado como migración inicial: los dos ficheros fundidos sin
      cambios de contenido en `20260816000000_baseline.sql`, idempotente, así que aplicarlo
      sobre producción no hace nada.
- [x] `flux_schema_migrations` + `REQUIRED_SCHEMA_VERSION` en `src/lib/schemaVersion.ts`.
      La app avisa al sincronizar si el backend va por detrás, sin bloquear el sync.
- [x] Job `migrations` en CI: aplica todo sobre un Postgres vacío en cada PR.
- [ ] **Proyecto de staging.** Es trabajo de consola, no de repositorio: crear el proyecto y
      guardar `SUPABASE_ACCESS_TOKEN` y `SUPABASE_STAGING_PROJECT_REF` como secretos.

El CI actual ya detecta la migración que solo funciona porque el objeto existía de antes en
la máquina de quien la escribió, que es el fallo más común. Lo que no cubre sin staging es
el comportamiento contra datos reales.

**Salida:** una migración se aplica desde cero en CI sin intervención manual. La convención
para escribir migraciones está en `supabase/README.md`.

### Fase 1 — Arreglar el sync (independiente de todo lo demás)

Beneficia a los usuarios actuales, no necesita workspaces, y es prerrequisito de
Realtime.

- Columna `version` y concurrencia optimista en las tablas actuales.
- Eliminar el `if (exists) return s;` de `loadCollection`; resolver por versión.
- `pushCollection` deja de ser fire-and-forget: reporta error y reintenta.
- UI de conflicto reutilizando la pantalla de compare.
- **Enmascarar los secretos de la URL antes de persistir el historial** (§1.2 C). El store
  ya sabe qué claves son secretas: basta revertirlas a `{{VAR}}` antes de escribir en
  SQLite y en `flux_history`. No depende de nada del resto del plan y arregla una fuga
  que existe hoy.

**Salida:** editar en la máquina A y abrir en la B muestra el cambio. Editar en las dos a
la vez produce un conflicto visible, nunca una pérdida silenciosa. Ninguna URL del
historial contiene el valor de una variable marcada como secreta.

#### Purga del historial remoto — se ejecuta al final, no al principio

El enmascarado solo cubre lo que se escriba desde la versión que lo incluye. Las filas ya
escritas en `flux_history` siguen conteniendo secretos en claro, y no hay forma de
purgarlas selectivamente: no se sabe retroactivamente qué valores eran secretos.

**El orden es lo único que importa aquí:**

1. Publicar la versión con el enmascarado.
2. Esperar a que se adopte. `analytics_events.app_version` da el dato real.
3. **Entonces** purgar.

Purgar antes es tirar el trabajo: los clientes sin actualizar repueblan la tabla en horas,
con los secretos vigentes, que son justo los que importan.

```sql
-- Panel de Supabase, service_role. Irreversible.
delete from public.flux_history;
```

**Qué ve el usuario: nada.** Toda la UI de historial lee de SQLite local
(`src/routes/history/index.tsx`, la paleta de comandos, el contador de Ajustes, el export).
Lo remoto solo lo toca `pullHistory`, que sale antes de tocar nada si la tabla viene vacía
y que únicamente *añade* lo que falta en local — nunca borra. Y nada sube el historial
local en bloque, así que la tabla no se repuebla sola con lo viejo.

Lo único que se pierde es la restauración en nube: quien reinstale o entre desde una
segunda máquina ya no recupera lo anterior a la purga. Va anunciado en las notas de
versión.

### Fase 2 — Workspaces personales (sin UI de equipo)

Se introduce el concepto sin exponerlo todavía.

- Tablas de §3.1.
- Backfill: un workspace `personal = true` por usuario existente, él como `owner`.
- `workspace_id` **nullable** en las tablas actuales + trigger que resuelve el workspace
  personal cuando llega `null` (compatibilidad con clientes viejos, ver §5).
- Nada cambia visualmente para el usuario.

**Salida:** toda fila de datos pertenece a un workspace. Cero cambios en la UI.

### Fase 3 — Normalización (el grueso del trabajo)

- Tablas de §3.2 y sus policies.
- El cliente escribe en **ambos** modelos durante un tiempo (dual-write).
- Backfill de los blobs existentes a filas, **verificado con checksum**.
- El cliente pasa a leer del modelo nuevo.
- Retirada de `flux_collections` solo cuando la telemetría diga que no queda nadie
  escribiendo en él.
- El esquema local de SQLite se alinea con el mismo modelo de filas. El YAML se queda
  como formato de **import/export** — que es lo que consume `flux-cli` y lo que la gente
  mete en git.

**Salida:** dos personas editan requests distintos de la misma colección
simultáneamente y ninguna pierde nada.

### Fase 4 — Equipo de verdad

- Invitaciones por email con token hasheado y caducidad.
- Roles y comprobación de capacidades en RLS.
- Audit log (§3.6).
- Selector de workspace en la UI; mover una colección entre workspaces.
- Tests de RLS: suite que se autentica como dos usuarios distintos y **afirma el
  aislamiento**. Es criterio de bloqueo para el despliegue, no un extra.

**Salida:** un usuario invitado ve exactamente lo que le corresponde por su rol, y hay un
test automatizado que lo demuestra para cada tabla.

### Fase 5 — Secretos cifrados

- `workspace_secrets`, RPCs de acceso, cifrado en reposo (§3.4).
- Migración de los secretos que hoy están en claro dentro de los blobs de entorno.
- Flujo de expulsión con rotación.

**Salida:** ningún valor secreto se puede leer con un JWT de usuario mediante una query
directa a una tabla.

### Fase 6 — Tiempo real

- Canales de `postgres_changes` por workspace.
- Presence: quién está viendo qué.
- Indicadores de edición concurrente en la UI.

### Fase 7 — Facturación y cuota de equipo

`flux_ai_reserve` está bien construida — reserva atómica con lock de fila, `settle` y
`refund`. Generaliza sin reescribir la lógica: la clave deja de ser «usuario» y pasa a
ser **sujeto de facturación** (`user_id` en free, `workspace_id` en plan de equipo). La
tabla se re-clava sobre ese sujeto y la función recibe cuál aplica.

- Límite de colaboradores en el plan free (Postman da 3).
- Cuota de IA agrupada por workspace en planes de pago.

### Fase 8 — Bring your own Supabase

El diferenciador real. Requiere que la fase 0 esté bien hecha.

- `SUPABASE_URL` y anon key configurables (hoy están hardcodeadas en
  `src/lib/supabase.ts`).
- Las migraciones se distribuyen como artefacto versionado.
- **Decisión pendiente:** el proxy de IA asume la instancia propia. En una instancia del
  cliente, o se apunta al proxy alojado con un token, o esos usuarios van
  obligatoriamente con su propia clave de Anthropic.

---

## 5. Migración en producción

Hay usuarios reales con la app instalada. El orden no admite atajos:

1. Tablas nuevas y columnas **nullable**.
2. Backfill, verificado.
3. Solo entonces `not null` y cambio de policies.
4. Retirada de lo viejo, **solo** cuando la telemetría lo permita.

### El punto que más fácil se pasa por alto

**Las versiones antiguas de la app siguen ejecutándose en las máquinas de la gente.** Un
cliente 0.2.0 hace `upsert` sin `workspace_id`. Poner `not null` sin más les rompe el
sync en silencio: verían el toast de «Sync failed — working offline» y nada más.

Mitigación: trigger `before insert` que resuelva el workspace personal cuando llega
`null`, mantenido durante varias versiones.

**Cuándo se puede retirar el trigger:** `analytics_events` ya registra `app_version`. Eso
permite medir la cola de clientes antiguos con datos reales en lugar de adivinar.
Criterio propuesto: menos del 1% de eventos activos desde versiones pre-workspace,
sostenido durante 60 días.

### Red de seguridad antes del backfill de la fase 3

Flux **ya sabe exportar colecciones** (`src/lib/exporters.ts`). Antes de la migración
destructiva, la app genera un export local completo en formato Postman v2.1. Si el
backfill sale mal, el usuario tiene sus datos en disco, en un formato estándar,
independientemente de lo que haya pasado en el servidor.

---

## 6. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Backfill de la fase 3 pierde datos | Crítico | Checksum de verificación + export local previo + dual-write |
| Policy RLS recursiva | Caída total del sync | Función `security definer`, probada en staging |
| Falta un `with check` en un `UPDATE` | Fuga entre workspaces | Suite de tests de aislamiento, obligatoria por tabla |
| Clientes viejos rotos por `not null` | Sync roto en silencio | Trigger de compatibilidad + telemetría de versión |
| Realtime demasiado hablador | Coste y batería | Filtro por workspace, deltas por fila, debounce |
| Secretos ya sincronizados a un ex-miembro | Fuga de credenciales | Flujo de rotación explícito en la expulsión |
| Convertirse en encargado del tratamiento | Legal | DPA, GDPR, cifrado en reposo, retención definida |

---

## 7. Decisiones tomadas

Resueltas el 2026-08-28. Las tres primeras condicionan el esquema, y por eso van con su
razonamiento completo; las tres últimas son de producto y de negocio.

### 7.1 El historial no se comparte

**Decisión:** `flux_history` **no** lleva `workspace_id`. Sigue siendo por usuario.

*Seguridad.* La URL se persiste ya interpolada (§1.2 C): una request con
`?api_key={{API_KEY}}` escribe el valor literal del secreto en `flux_history.url`.
Compartir el historial sería difundir eso al equipo entero, de forma automática y sin que
nadie lo pida.

*Escalabilidad.* Es la tabla que más crece — una fila por request enviado. `pullHistory`
trae 200 filas y deduplica en cliente comparando `method|url|timestamp`. Un feed
compartido exigiría paginación, retención y filtrado construidos desde cero, justo sobre
la tabla de mayor volumen.

*Si más adelante se pide:* compartir **un** request concreto al workspace como acción
explícita del usuario, nunca un feed automático.

### 7.2 Los ajustes siguen siendo personales

**Decisión:** `flux_settings` **no** lleva `workspace_id`.

Compartir preferencias de UI no aporta nada y sí abre superficie. Los device-only
(`claudeApiKey`, `clientCertPem`, `clientKeyPem`) ya están excluidos del sync y ahí siguen.

**El matiz que sí importa:** algunos ajustes actuales no son preferencias, son **postura
de seguridad** — el toggle de verificación SSL y la configuración de proxy. En un equipo,
«aquí nadie desactiva la verificación SSL» es una política del workspace, no un gusto
personal, y es exactamente el tipo de control que compra un cliente de empresa.

Para eso, tabla `workspace_policies` **separada** (fase 4 o posterior), donde el workspace
impone un mínimo que el ajuste personal no puede rebajar. Nunca fusionada dentro de
`flux_settings`: mezclar preferencia y política en la misma fila hace imposible razonar
sobre cuál de las dos gana.

### 7.3 Copiar entre workspaces sí; mover, restringido

**Decisión:** la operación por defecto es **copiar**, con IDs nuevos, y **los secretos no
cruzan**. La colección aterriza en el destino con sus `{{VAR}}` sin resolver, y ese
workspace define sus propios valores. Una copia nunca transporta credenciales a través de
una frontera de permisos.

**Mover** de verdad — mismo ID, auditoría continua — queda restringido a quien sea `owner`
o `admin` en **ambos** workspaces, y deja entrada en los dos audit logs.

**Por qué mover tiene que ser una RPC transaccional.** Con `workspace_id` denormalizado
(§3.2), mover es un `UPDATE` sobre tres tablas. Si se queda a medias, quedan filas cuyo
`workspace_id` no concuerda con el de su colección — y como RLS filtra precisamente por
esa columna, **son datos que existen pero que no puede ver nadie**, irrecuperables sin
`service_role`. Nunca orquestado desde el cliente.

### 7.4 Plan free: 3 colaboradores

El mismo número que Postman, para que la comparación sea inmediata a quien venga de allí.

### 7.5 E2E en el plan más alto — pero la línea base no se monetiza

La **capa 1** de §3.4 (secretos fuera del blob, cifrados en reposo, acceso solo por RPC)
va en **todos los planes, free incluido**. Lo que se cobra es el control de la clave, no
el hecho de estar protegido.

### 7.6 La ruta de GitHub se mantiene

Como export/import a git, no absorbida. Es la salida para quien no quiera nube, y encaja
con el discurso de la fase 8.

---

## 8. Planes y precios

### 8.1 La licencia decide qué se puede cobrar — y bloquea la fase 0

Flux es **MIT y el repositorio es público**. Cualquiera puede forkear el cliente, quitar la
comprobación de plan y redistribuirlo, y estaría en su derecho. De ahí salen dos reglas.

**Regla 1: no se cobra por funciones del cliente, se cobra por el servicio.** Encaja con
este plan por casualidad afortunada: workspaces, roles, realtime, secretos y audit log son
todos de servidor. Un fork puede borrarte un `if` en React; no puede darse permisos en tu
Postgres.

**Regla 2: el gate de plan nunca vive solo en el cliente.** Si `plan === 'team'` es lo
único que separa a alguien de invitar a treinta personas, el gate no existe. Va en la
policy o en la RPC, siempre.

**El conflicto que hay que resolver en la fase 0.** La fase 8 (BYO Supabase) regala
exactamente la parte monetizable: si `supabase/migrations/` se publica bajo MIT, cualquier
empresa se autohospeda el producto de equipo completo, gratis y legalmente. Una vez
publicado no hay marcha atrás.

Las salidas habituales son licenciar los componentes de servidor aparte (cliente MIT,
servidor BSL o comercial) o dejarlo todo abierto y cobrar por alojamiento y soporte. Lo
que no cabe es aplazarlo: **la fase 0 consiste literalmente en crear esos ficheros**, así
que la decisión de licencia es un bloqueante suyo.

### 8.2 Lo que ya está prometido gratis

La tabla comparativa del README publica como gratis, y en contraste explícito con Postman
de pago: el CLI para CI/CD, el load test, los mock servers, la extracción automática de
variables y el import/export. Quedan **fuera del pricing de forma permanente**. Meterlas
tras un muro después sería el peor movimiento de confianza posible, y justo con los
usuarios que llegaron por esa promesa.

### 8.3 La fecha que manda

El baseline dice, literal: *«Tier gratuito de IA (beta hasta 2026-12-31)»*. Eso obliga a
tener planes definidos antes de esa fecha aunque los workspaces no estén listos: la IA es
hoy el único coste variable real del proyecto.

### 8.4 Plano por workspace, no por asiento

**Decisión: se cobra por workspace, con tope de miembros. No por asiento.**

*Producto.* El cobro por asiento es precisamente lo que duele en Postman: acabas
racionando quién entra, y quien mira una vez al mes cuesta igual que quien vive dentro. Un
precio plano elimina esa fricción entera. Es un diferenciador, no un descuento.

*Ingeniería.* El cobro por asiento obliga a prorrateos, altas y bajas a mitad de ciclo y
reconciliación de asientos contra Stripe. Tramos planos con tope de miembros son una
fracción de ese código — y aquí eso importa, porque lo mantiene una persona.

*Contrapartida.* Se deja dinero sobre la mesa con equipos grandes. Se compensa con tramos
por tamaño, y con Enterprise por encima del último tramo.

### 8.5 Los planes

| Plan | Precio | Incluye |
|---|---|---|
| **Free** | 0 € | Todo lo local sin límite, sync personal, 1 workspace de equipo con **3 miembros**. IA: cuota actual (100/mes, 20/día) o tu propia clave, ilimitada |
| **Team** | ~29 €/mes, hasta **10** miembros | Roles, invitaciones, realtime y presence, audit log 90 días, entornos compartidos con secretos cifrados, bolsa de IA común |
| **Business** | ~79 €/mes, hasta **25** miembros | Lo anterior + audit log extendido |
| **Enterprise** | A medida | BYO Supabase, E2E opt-in, `workspace_policies`, SSO/SCIM, DPA y SLA |

Referencia: Postman ronda los 14 $/asiento en su tier básico — **verificar, el dato puede
estar desfasado**. Un equipo de 10 pagaría allí ~140 $/mes frente a ~29 € aquí. La
diferencia es lo bastante grande como para no necesitar explicación.

**Sin plan individual de pago.** Lo único que pagaría un usuario en solitario es más IA sin
traer su clave, y para eso ya existe la válvula gratis de traer la suya. Se resuelve con
paquetes de acciones sueltos, no con un escalón: menos niveles, menos confusión, menos
soporte.

**Subir precios después.** Se hace con clientes nuevos, respetando el precio a los
primeros. Empezar agresivo y corregir al alza es viable; empezar caro y bajar, no.

### 8.6 El coste variable: cuánto cuesta una acción de IA

El proxy fuerza `claude-haiku-4-5`, a **1 $/MTok de entrada y 5 $/MTok de salida**.

Una acción típica (generar aserciones a partir de una respuesta, debug assist) mueve del
orden de 4K tokens de entrada y 1K de salida:

```
entrada:  4.000 × $1  / 1.000.000 = $0,004
salida:   1.000 × $5  / 1.000.000 = $0,005
                                    ────────
por acción                          ≈ $0,01
```

De ahí:

- Un usuario free que agote su cuota: 100 acciones ≈ **$1/mes**.
- Un Team de 10 con bolsa de 100 × miembro: 1.000 acciones ≈ **$9/mes**, sobre ~29 € de
  ingreso. Aceptable, pero es un tercio del margen en el peor caso.

**No hay que adivinarlo: los datos ya se están recogiendo.** `flux_ai_usage` acumula
`in_tokens` / `out_tokens` por usuario y `flux_ai_calls` guarda cada llamada con su
desglose. Antes de fijar el número definitivo, sacar de ahí el consumo real (mediana y
p95) y calcular el coste con datos propios en lugar de con esta estimación.

**La bolsa común conserva el tope diario por miembro.** Sin él, un solo integrante puede
quemar el saldo de veinte.

### 8.7 Qué plan desbloquea cada fase

| Fase | Plan |
|---|---|
| 0–3 (migraciones, sync, workspaces personales, normalización) | Todos, free incluido — son arreglos, no funciones de pago |
| 4 (roles, invitaciones, audit log) | Es lo que **hace existir** el plan Team |
| 5 capa 1 (cifrado en reposo) | Todos, free incluido (§7.5) |
| 5 capa 2 (E2E) | Enterprise |
| 6 (realtime, presence) | Team |
| 7 | El motor de cobro en sí |
| 8 (BYO Supabase) | Enterprise — y es la que choca con MIT (§8.1) |

Conviene verlo claro de antemano: **las fases 0 a 3 no venden nada**. Son cuatro fases de
trabajo duro sin ingreso asociado, y es correcto que lo sean — son el suelo sobre el que la
fase 4 se puede cobrar. Saberlo evita desanimarse a mitad.

---

## 9. Fuera de alcance

No entra en este plan, aunque el roadmap del README lo mencione:

- Forks y pull requests sobre colecciones (el modelo de versionado de Postman).
- Comentarios en requests.
- Workspaces públicos / galería de plantillas.
- SSO, SCIM, y el resto del paquete de empresa.

Todo eso se apoya en las fases 3 y 4. Antes de tenerlas, no es construible.
