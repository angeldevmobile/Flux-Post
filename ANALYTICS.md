# Medición de Flux

Runbook de mantenimiento: cómo desplegar la telemetría, cómo leer las cifras y
qué pasos hay que dar a mano.

**Esto no es documentación para usuarios.** Vive en la raíz del repo y no en
`docs/`, porque `docs/` es la raíz de GitHub Pages (fluxapi.dev) y sirve todos
sus archivos. Lo que un usuario de Flux necesita saber —qué datos se envían,
cuáles no y cómo apagarlos— está en la web, en
[Data & Privacy](https://fluxapi.dev/docs.html#sec-settings-privacy), y se
mantiene en `docs/docs.html`. Si cambias qué se envía, **actualiza los dos**.

Que este archivo sea público no es un descuido: el repo es open-source y aquí no
hay nada secreto. La `service_role` key no está escrita en ninguna parte del
repositorio, y ni el ID de GA4 ni la URL del proyecto de Supabase lo son —
viajan ya dentro del binario y del HTML publicado.

---

## El problema que había

Hasta septiembre de 2026 la medición tenía tres huecos, y los tres apuntaban al
mismo sitio: se veía tráfico web y no se veía uso del producto.

**1. La telemetría de la app no llegaba.** `analytics_events` tenía esta policy:

```sql
create policy "insert own events" on public.analytics_events
  for insert to authenticated
```

Flux es un cliente de escritorio donde iniciar sesión es opcional, y la mayoría
de las instalaciones nunca autentican. Postgres rechazaba sus inserts, y el
`catch {}` vacío de `flushEvents` se comía el error. La tabla solo veía a la
minoría con cuenta, sin ningún síntoma visible.

**2. GA4 medía la landing, no el producto.** 98 usuarios activos en un mes son
98 visitas a `docs/index.html`. No dicen nada de cuánta gente abre Flux.

**3. El updater regalaba la señal.** Cada instalación viva comprueba
actualizaciones al arrancar. Ese ping iba a GitHub, que no devuelve logs.

---

## Cómo se mide ahora

Cuatro fuentes, ninguna sustituye a las otras:

| Fuente | Qué responde | Dónde se lee |
|---|---|---|
| Google Analytics 4 | cuánta gente llega a la web y de dónde | analytics.google.com |
| Descargas de GitHub | cuánta gente se lleva el instalador | `npm run stats` |
| Pings del updater | cuántas instalaciones siguen vivas | `npm run stats:app` |
| Telemetría de la app | qué se usa dentro de Flux y qué se rompe | `npm run stats:app` |

La distancia entre la segunda y la tercera es la métrica más importante que
existe: gente que instaló Flux y no volvió.

---

## Qué se manda y qué no

Flux es donde la gente pega tokens, URLs internas y payloads privados. La
privacidad no es un extra aquí, es el argumento frente a Postman.

**Nunca sale de la máquina:**

- Ninguna URL, ni entera ni troceada. Ni el host: `api.staging.clientex.local`
  identifica a la empresa del usuario.
- Ningún header, body, nombre de colección, entorno o variable.
- Ninguna API key, token ni credencial.
- El nombre del usuario (las rutas tipo `C:\Users\angel.zapata\` se limpian).

**Sí sale, si el usuario lo acepta:**

- Un UUID aleatorio por instalación (`install_id`). Identifica una copia de
  Flux, no a una persona. Se genera en local y se puede borrar.
- Versión de la app y sistema operativo (windows / macos / linux).
- Nombre del evento, de una lista blanca cerrada en la edge function.
- De una request: método, esquema (`https`), y si iba a localhost. Nada más.
- Mensajes de crash, pasados por `redact()`.

La garantía está en `src/lib/analytics.ts` y cubierta por
`src/lib/__tests__/analytics.test.ts`. Si tocas `redact()`, corre esos tests.

**Consentimiento.** `analytics` viene **apagado** de fábrica; `crashReports`,
encendido. Se cambian en Settings → Privacy. Un lote que solo trae un crash
manda `count_active: false` y no cuenta a esa persona como usuario activo: sería
contradictorio contar a quien dijo explícitamente que no quería ser medido.

**El ping del updater es la excepción y hay que ser honesto con ella.** No tiene
opt-out porque no es telemetría: es la comprobación de actualizaciones que la
app ya hacía. Lo que cambia es que antes esa IP la recibía GitHub y ahora la
recibes tú. No se guarda en crudo: se almacena
`sha256(sal_del_día + ip + user_agent)`, con una sal que rota a diario y se
borra a los dos días, así que el hash no es reversible ni correlacionable entre
días. Es el enfoque de Plausible. **Aun así debe constar en la política de
privacidad antes de publicar la versión que lo use.**

---

## Puesta en marcha

### 1. Aplicar las migraciones

```bash
supabase db push
```

O pegar en el SQL Editor de Supabase, **en este orden y las dos**:

1. `20260905000000_telemetry_anon.sql` — esquema, funciones y vistas.
2. `20260905010000_secure_telemetry_views.sql` — cierra las vistas.

Ambas son idempotentes.

**La segunda no es opcional.** Una vista de Postgres se ejecuta con los
privilegios de su propietario, no con los de quien consulta, así que las vistas
de la primera migración saltan el RLS de las tablas que leen y quedan legibles
con la anon key — que va dentro de cada binario de Flux. Comprobación:

```bash
curl -s "https://zmzfupygrhseljaxzyeb.supabase.co/rest/v1/telemetry_crashes?select=*" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"
```

Debe responder `permission denied`. Si devuelve un array de filas, falta aplicar
la segunda migración. Lo mismo vale para cualquier vista que añadas después.

### 2. Desplegar las edge functions

```bash
supabase functions deploy telemetry
supabase functions deploy app-update
```

Ambas van con `verify_jwt = false` (ya está en `supabase/config.toml`): la
mayoría de las instalaciones no tienen sesión, y el updater de Tauri no manda
cabecera `Authorization`.

Comprobar que responden antes de publicar nada:

```bash
# Debe devolver el latest.json de la release actual
curl -s "https://zmzfupygrhseljaxzyeb.supabase.co/functions/v1/app-update?v=0.2.0&target=windows&arch=x86_64"

# Debe devolver 204 sin cuerpo
curl -i -X POST "https://zmzfupygrhseljaxzyeb.supabase.co/functions/v1/telemetry" \
  -H "Content-Type: application/json" \
  -d '{"install_id":"00000000-0000-4000-8000-000000000000","app_version":"0.2.0","platform":"linux","count_active":true,"events":[{"type":"app_open","ts":0}]}'
```

Si el primero no devuelve el manifiesto, **no publiques la release**: revisa la
función antes. El updater tiene GitHub como segundo endpoint y aguantaría, pero
no conviene estrenar el fallback en producción.

### 3. Marcar los eventos clave en GA4

Esto **no se puede hacer desde el código**, y es la razón de que el panel diga
"Eventos clave: 0". Son dos minutos:

1. analytics.google.com → propiedad de Flux (`G-ZCQF29NN2W`)
2. Admin (rueda dentada, abajo a la izquierda) → **Eventos**
3. Buscar `download_click` → activar el interruptor **"Marcar como evento clave"**
4. Repetir con `cta_click`

Los eventos tardan hasta 24 h en aparecer en esa lista si no se han registrado
todavía. `scroll_depth` y `engaged_30s` **no** deben marcarse como clave: son
señal de lectura, no conversiones, y marcarlos ensucia la tasa de conversión.

### 4. Registrar las dimensiones personalizadas

Sin esto los parámetros llegan pero no se pueden usar en informes:

Admin → **Definiciones personalizadas** → Crear dimensión personalizada:

| Nombre | Ámbito | Parámetro del evento |
|---|---|---|
| Link location | Evento | `link_location` |
| Scroll percent | Evento | `percent` |

### 5. Publicar una release

Nada de la telemetría nueva llega hasta que salga una versión que la incluya.
Los binarios v0.2.0 que ya están instalados siguen con el comportamiento viejo:
escriben directo contra PostgREST y solo lo consiguen si el usuario tiene
sesión. Por eso la migración conserva las policies antiguas.

---

## Leer los datos

```bash
npm run stats                                  # descargas por release
SUPABASE_SERVICE_KEY=eyJ... npm run stats:app  # uso real
SUPABASE_SERVICE_KEY=eyJ... npm run stats:app -- --days 90
```

La service key está en Supabase → Project Settings → API → `service_role`. Da
acceso total a la base de datos: no se guarda en el repo ni se pega en ningún
sitio.

Vistas disponibles en el SQL Editor:

| Vista | Para qué |
|---|---|
| `telemetry_dau` | instalaciones activas por día |
| `telemetry_updater_dau` | visitantes del updater por día |
| `telemetry_feature_use` | eventos e instalaciones por tipo y día |
| `telemetry_route_use` | qué secciones de la app se abren |
| `telemetry_install_first_seen` | primera y última vez de cada instalación |
| `telemetry_retention` | retención por cohorte semanal |
| `telemetry_crashes` | crashes agrupados por mensaje |

---

## Cómo leer las cifras sin engañarse

**Un pico tras una release no es crecimiento.** Publicar en Product Hunt, HN o
Threads da un pico de dos o tres días que siempre decae. La pregunta correcta no
es "¿bajó?" sino "¿la línea base de después es más alta que la de antes?".

**Comparar 5 días contra 30 no significa nada.** El panel de inicio de GA4 hace
justo eso a principio de mes. Con 15 usuarios, un -11 % es ruido.

**Cuenta instalaciones, no eventos.** 400 eventos pueden ser una sola persona.
Por eso las vistas traen siempre la columna `installs`.

**La cifra `app` de usuarios activos infraestima siempre.** La telemetría es
opt-in con el interruptor apagado por defecto: solo se cuenta a quien lo activó
a mano, que es poca gente. Para volumen, mira la columna `updater`. Para
comportamiento, mira `app` y trátala como una muestra, no como un censo.

**El número que decide la hoja de ruta** es el porcentaje de instalaciones que
abren Flux una vez y no vuelven. Si es alto, no hay campaña de marketing que
arregle nada: el problema está en los primeros cinco minutos de uso.

---

## Añadir un evento nuevo

1. `trackEvent("mi_evento", { campo: "valor" })` en el sitio que toque.
2. Añadir `"mi_evento"` a `ALLOWED_TYPES` en
   `supabase/functions/telemetry/index.ts`. **Sin esto se descarta en
   silencio**: la lista blanca existe para que la tabla no acabe siendo un
   vertedero, y para que añadir un evento sea una decisión y no un descuido.
3. `supabase functions deploy telemetry`.

`data` solo admite escalares (string, number, boolean), las claves se cortan a
40 caracteres y los valores a 120. Un objeto anidado se descarta: era justo por
ahí por donde se colaría una URL con un token dentro.
