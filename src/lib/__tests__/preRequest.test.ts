import { describe, it, expect } from "vitest";
import { runPreRequestScript, runPostResponseScript } from "@/lib/preRequest";
import { useConsoleStore } from "@/stores/console";

/**
 * La superficie de `pm` tiene que coincidir con la del shim del CLI
 * (flux-cli/src/js_shim.js). Donde se separen, un script se comporta de una
 * manera al pulsar Send y de otra en CI.
 */

const response = {
  status: 200,
  body: '{"token":"abc","id":7}',
  headers: { "content-type": "application/json" },
  durationMs: 12,
};

describe("runPreRequestScript", () => {
  it("collects what the script sets", () => {
    const out = runPreRequestScript('pm.environment.set("A", "1");', {});
    expect(out.envVars).toEqual({ A: "1" });
  });

  it("reads a variable that already existed", () => {
    const out = runPreRequestScript(
      'pm.request.headers.upsert("X-A", pm.environment.get("A"));',
      { A: "existing" },
    );
    expect(out.headers).toEqual({ "X-A": "existing" });
  });

  /**
   * El caso que estaba roto: dentro de la misma ejecucion, un `get` posterior
   * a un `set` leia el mapa de entrada y devolvia "". El shim del CLI siempre
   * escribio en las dos, asi que `pm.environment.set(...)` seguido de
   * `pm.environment.get(...)` funcionaba en CI y no en la app.
   */
  it("lets a later get see what an earlier set wrote", () => {
    const out = runPreRequestScript(
      'pm.environment.set("SIG", "firmado"); pm.request.headers.upsert("X-Sig", pm.environment.get("SIG"));',
      {},
    );
    expect(out.headers).toEqual({ "X-Sig": "firmado" });
    expect(out.envVars).toEqual({ SIG: "firmado" });
  });

  it("lets a set override an incoming value for later reads", () => {
    const out = runPreRequestScript(
      'pm.environment.set("A", "nuevo"); pm.request.headers.upsert("X-A", pm.environment.get("A"));',
      { A: "viejo" },
    );
    expect(out.headers["X-A"]).toBe("nuevo");
  });

  it("returns an empty string for a variable nobody defined", () => {
    const out = runPreRequestScript('pm.request.headers.upsert("X-A", pm.environment.get("NOPE"));', {});
    expect(out.headers).toEqual({ "X-A": "" });
  });

  /**
   * La app registra el fallo en el panel de consola y deja seguir la peticion;
   * `flux run` en cambio la da por fallada. Es una diferencia deliberada: en la
   * UI quieres ver el error y seguir toqueteando, en CI quieres que reviente.
   */
  it("logs a broken script to the console instead of throwing", () => {
    useConsoleStore.setState({ entries: [] });
    expect(() => runPreRequestScript("this is not javascript(", {})).not.toThrow();
    const errors = useConsoleStore.getState().entries.filter((e) => e.level === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].source).toBe("pre-request");
  });
});

describe("runPostResponseScript", () => {
  it("reads the response body as json", () => {
    const out = runPostResponseScript(
      'pm.environment.set("TOKEN", pm.response.json().token);',
      response,
      {},
    );
    expect(out.envVars).toEqual({ TOKEN: "abc" });
  });

  it("lets a later get see what an earlier set wrote", () => {
    const out = runPostResponseScript(
      'pm.environment.set("A", "1"); pm.environment.set("B", pm.environment.get("A") + "2");',
      response,
      {},
    );
    expect(out.envVars).toEqual({ A: "1", B: "12" });
  });

  it("records passing and failing pm.test() results", () => {
    const out = runPostResponseScript(
      `pm.test("ok", () => pm.expect(pm.response.status).to.equal(200));
       pm.test("nope", () => pm.expect(pm.response.status).to.equal(500));`,
      response,
      {},
    );
    expect(out.testResults.map((t) => [t.name, t.pass])).toEqual([
      ["ok", true],
      ["nope", false],
    ]);
  });

  it("shares the same map between pm.environment and pm.variables", () => {
    const out = runPostResponseScript(
      'pm.variables.set("A", "1"); pm.environment.set("B", pm.environment.get("A"));',
      response,
      {},
    );
    expect(out.envVars.B).toBe("1");
  });
});
