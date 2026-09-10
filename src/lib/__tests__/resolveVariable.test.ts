import { describe, it, expect, beforeEach } from "vitest";
import { useEnvironmentStore } from "@/stores/environment";

/**
 * El contrato de `{{VAR}}` en la app. `flux-cli` lo replica en
 * `cli_tests::variable_resolution`; si los dos se separan, una request sale
 * distinta en CI que en la app.
 */

const resolve = (v: string) => useEnvironmentStore.getState().resolveVariable(v);

beforeEach(() => {
  useEnvironmentStore.setState({
    environments: [
      {
        id: "e",
        name: "Test",
        variables: { TOKEN: "abc", EMPTY: "", NESTED: "{{TOKEN}}", BOTH: "from-env" },
      },
    ],
    activeId: "e",
    globalVariables: { GLOBAL: "g", BOTH: "from-global" },
  });
});

describe("resolveVariable", () => {
  it("replaces a variable from the active environment", () => {
    expect(resolve("Bearer {{TOKEN}}")).toBe("Bearer abc");
  });

  it("replaces every occurrence", () => {
    expect(resolve("{{TOKEN}}-{{TOKEN}}")).toBe("abc-abc");
  });

  it("leaves an unknown variable exactly as written", () => {
    expect(resolve("{{NOPE}}")).toBe("{{NOPE}}");
    expect(resolve("a {{NOPE}} b")).toBe("a {{NOPE}} b");
  });

  it("resolves an empty variable to an empty string", () => {
    expect(resolve("[{{EMPTY}}]")).toBe("[]");
  });

  it("does not re-resolve what it just substituted", () => {
    // NESTED vale "{{TOKEN}}": una sola pasada, no una expansion recursiva.
    expect(resolve("{{NESTED}}")).toBe("{{TOKEN}}");
  });

  it("resolves a global that the environment does not define", () => {
    expect(resolve("{{GLOBAL}}")).toBe("g");
  });

  /**
   * Los globales son valores por defecto y el entorno los especializa. Al reves
   * un entorno "Local" no podia sobreescribir un `BASE_URL` global y las
   * peticiones seguian saliendo a produccion.
   */
  it("lets the environment win over a global of the same name", () => {
    expect(resolve("{{BOTH}}")).toBe("from-env");
  });

  /**
   * `pm.environment.set()` escribe en las variables del entorno, asi que
   * refrescar un token desde un script solo sirve si el entorno gana.
   */
  it("lets a value written by a script win over a stale global", () => {
    useEnvironmentStore.setState({
      environments: [{ id: "e", name: "Test", variables: {} }],
      activeId: "e",
      globalVariables: { ACCESS_TOKEN: "stale-global" },
    });
    useEnvironmentStore.getState().updateEnvironment("e", {
      variables: { ACCESS_TOKEN: "fresh-from-script" },
    });
    expect(resolve("{{ACCESS_TOKEN}}")).toBe("fresh-from-script");
  });

  it("leaves text with no variables untouched", () => {
    expect(resolve("plain text")).toBe("plain text");
    expect(resolve("")).toBe("");
  });

  it("ignores braces that do not close", () => {
    expect(resolve("{{TOKEN")).toBe("{{TOKEN");
    expect(resolve("{{}}")).toBe("{{}}");
  });
});

describe("dynamic built-ins", () => {
  it("{{$guid}} is a v4 uuid", () => {
    expect(resolve("{{$guid}}")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("each {{$guid}} in the same string is different", () => {
    const [a, b] = resolve("{{$guid}} {{$guid}}").split(" ");
    expect(a).not.toBe(b);
  });

  it("{{$timestamp}} is epoch milliseconds", () => {
    const v = Number(resolve("{{$timestamp}}"));
    expect(Number.isInteger(v)).toBe(true);
    expect(Math.abs(v - Date.now())).toBeLessThan(5000);
  });

  it("{{$isoTimestamp}} parses back to about now", () => {
    const v = resolve("{{$isoTimestamp}}");
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(v) - Date.now())).toBeLessThan(5000);
  });

  it("{{$randomInt}} is between 0 and 999", () => {
    for (let i = 0; i < 50; i++) {
      const v = Number(resolve("{{$randomInt}}"));
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(999);
    }
  });

  it("a built-in wins over an environment variable of the same name", () => {
    useEnvironmentStore.setState({
      environments: [{ id: "e", name: "Test", variables: { $timestamp: "nope" } }],
      activeId: "e",
      globalVariables: {},
    });
    expect(resolve("{{$timestamp}}")).not.toBe("nope");
  });
});
