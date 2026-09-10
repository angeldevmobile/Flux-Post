import { sendRequest, type HttpResponse, type Collection, type CollectionRequest } from "@/lib/tauri";
import { networkOptions } from "@/lib/networkOptions";
import { prepareRequest } from "@/lib/prepareRequest";
import { resolveInherited } from "@/lib/inheritance";
import { runPreRequestScript, runPostResponseScript } from "@/lib/preRequest";
import { evaluatePath } from "@/lib/jsonpath";
import { useEnvironmentStore } from "@/stores/environment";
import type { TestResult } from "@/stores/testResults";

/**
 * Ejecuta una request de coleccion de principio a fin: scripts, variables,
 * herencia, envio y extractores.
 *
 * El collection runner y la pantalla de Tests solo enviaban la peticion. Ni
 * ejecutaban los scripts ni aplicaban los extractores, asi que la cadena
 * habitual —login, capturar el token, usarlo en las siguientes— no funcionaba
 * en ninguna de las dos: solo pulsando Send request a request. El panel si lo
 * hacia, y `flux run` ejecuta los scripts pero tampoco los extractores, de modo
 * que la misma coleccion se comportaba de tres maneras distintas.
 *
 * El orden replica el del panel y el de `run_request` en flux-cli. Importa: el
 * script de pre-request corre *antes* de interpolar variables, porque lo normal
 * es que pida un token y lo escriba en el entorno para que la propia peticion
 * lo use.
 */

export interface RunOutcome {
  response: HttpResponse;
  /** Resultados de `pm.test()` dentro del script de post-response. */
  scriptTests: TestResult[];
  /** Variables capturadas por los extractores, ya escritas en el entorno. */
  extracted: Record<string, string>;
}

/** Variables del entorno activo, leidas frescas en cada paso. */
function currentVars(): Record<string, string> {
  const { environments, activeId } = useEnvironmentStore.getState();
  return environments.find((e) => e.id === activeId)?.variables ?? {};
}

/**
 * Escribe en el entorno activo. Es lo que encadena una peticion con la
 * siguiente: `resolveVariable` lee del store, asi que lo que se escriba aqui lo
 * ve la request que venga detras.
 */
function writeEnv(vars: Record<string, string>): void {
  if (Object.keys(vars).length === 0) return;
  const { environments, activeId, updateEnvironment } = useEnvironmentStore.getState();
  if (!activeId) return;
  const env = environments.find((e) => e.id === activeId);
  if (!env) return;
  updateEnvironment(activeId, { variables: { ...env.variables, ...vars } });
}

/**
 * Aplica los extractores de una request sobre el cuerpo de la respuesta.
 *
 * Pura a proposito: es la parte con reglas y la que conviene poder probar sin
 * levantar el store ni la capa de red.
 */
export function extractVariables(
  request: CollectionRequest,
  body: string,
): Record<string, string> {
  const rules = (request.extractors ?? []).filter((e) => e.path && e.variable);
  if (rules.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Una respuesta que no es JSON no tiene nada que extraer.
    return {};
  }

  const out: Record<string, string> = {};
  for (const rule of rules) {
    const value = evaluatePath(rule.path, parsed);
    // `null` es "no estaba": no se pisa la variable con una cadena vacia.
    if (value !== null) out[rule.variable] = value;
  }
  return out;
}

export async function runCollectionRequest(
  collection: Collection,
  request: CollectionRequest,
): Promise<RunOutcome> {
  const inherited = resolveInherited(collection, request.id);

  // 1. Pre-request. Antes de interpolar, para que lo que escriba en el entorno
  //    lo use esta misma peticion.
  const pre = inherited?.scripts?.preRequest ?? request.scripts?.preRequest;
  let scriptHeaders: Record<string, string> = {};
  const scriptFailures: TestResult[] = [];
  if (pre?.trim()) {
    const mutations = runPreRequestScript(pre, currentVars());
    scriptHeaders = mutations.headers;
    writeEnv(mutations.envVars);
    // Un script roto sale como assertion fallada, no como una linea de consola
    // que nadie mira: la peticion se envia igual, pero la tanda se da por
    // fallada, que es el mismo veredicto que da `flux run`.
    if (mutations.error) {
      scriptFailures.push({ name: "pre-request script", pass: false, error: mutations.error });
    }
  }

  // 2. Herencia, auth, variables y query.
  const prepared = prepareRequest(
    collection,
    request,
    useEnvironmentStore.getState().resolveVariable,
  );

  // 3. Enviar. El script pisa a lo heredado y a lo propio, como en el panel.
  const response = await sendRequest({
    method: request.method,
    ...prepared,
    headers: { ...prepared.headers, ...scriptHeaders },
    ...networkOptions(),
  });

  // 4. Post-response.
  const post = inherited?.scripts?.postResponse ?? request.scripts?.postResponse;
  let scriptTests: TestResult[] = [];
  if (post?.trim()) {
    const mutations = runPostResponseScript(
      post,
      {
        status: response.status,
        body: response.body,
        headers: response.headers,
        durationMs: response.durationMs,
      },
      currentVars(),
    );
    scriptTests = mutations.testResults;
    writeEnv(mutations.envVars);
    if (mutations.error) {
      scriptFailures.push({ name: "post-response script", pass: false, error: mutations.error });
    }
  }

  // 5. Extractores.
  const extracted = extractVariables(request, response.body);
  writeEnv(extracted);

  return { response, scriptTests: [...scriptFailures, ...scriptTests], extracted };
}
