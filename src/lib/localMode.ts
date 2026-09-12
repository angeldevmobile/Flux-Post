/**
 * Modo local: usar Flux sin cuenta.
 *
 * Hasta ahora el unico camino a la aplicacion pasaba por iniciar sesion, asi
 * que quien instalaba y no queria cuenta se iba en la primera pantalla, y ese
 * tramo del embudo no lo veia nadie, porque tanto la telemetria como la
 * comprobacion de actualizaciones corren ya dentro de la app.
 *
 * Sin cuenta funciona todo lo que es local: peticiones, colecciones, entornos,
 * scripts, tests, mock server, load test, gRPC, WebSocket y SSE. Queda fuera lo
 * que por definicion necesita servidor: la sincronizacion en la nube y el tramo
 * gratuito de IA (que se relaya por un proxy con cuota por cuenta). Con tu
 * propia clave de Claude, la IA tambien funciona sin cuenta.
 *
 * Se guarda aparte de los ajustes a proposito: los ajustes se sincronizan con
 * la nube, y esta eleccion es de esta maquina.
 */

const KEY = "flux_local_mode";

export function isLocalMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Sin almacenamiento se comporta como si nunca se hubiera elegido.
    return false;
  }
}

export function setLocalMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // La sesion actual sigue valiendo aunque no se pueda recordar la eleccion.
  }
}
