import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Collection, CollectionRequest, HttpResponse } from "@/lib/tauri";

// La capa de red es lo unico que se sustituye: todo lo demas (store, scripts,
// jsonpath) corre de verdad, que es donde estan los errores de orden.
const sent: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
let nextResponse: HttpResponse;

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    sendRequest: vi.fn(async (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => {
      sent.push({ method: req.method, url: req.url, headers: req.headers, body: req.body });
      return nextResponse;
    }),
  };
});

const { runCollectionRequest, extractVariables } = await import("@/lib/runCollectionRequest");
const { useEnvironmentStore } = await import("@/stores/environment");

function res(body: string, status = 200): HttpResponse {
  return {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    setCookies: [],
    sentCookies: [],
    body,
    durationMs: 5,
    ttfbMs: 3,
    downloadMs: 2,
    size: body.length,
    bodyEncoding: "text",
  };
}

function req(extra: Partial<CollectionRequest> = {}): CollectionRequest {
  return { id: "r", name: "r", method: "GET", path: "/x", headers: {}, tests: [], ...extra };
}

function col(extra: Partial<Collection> = {}): Collection {
  return { id: "c", name: "c", requests: [], folders: [], expanded: true, ...extra };
}

const vars = () =>
  useEnvironmentStore.getState().environments.find((e) => e.id === "e")?.variables ?? {};

beforeEach(() => {
  sent.length = 0;
  nextResponse = res("{}");
  useEnvironmentStore.setState({
    environments: [{ id: "e", name: "Test", variables: { BASE_URL: "https://api.test" } }],
    activeId: "e",
    globalVariables: {},
  });
});

describe("extractVariables", () => {
  it("captures a value by JSONPath", () => {
    const r = req({ extractors: [{ path: "$.data.token", variable: "TOKEN" }] });
    expect(extractVariables(r, '{"data":{"token":"abc"}}')).toEqual({ TOKEN: "abc" });
  });

  it("captures several rules at once", () => {
    const r = req({
      extractors: [
        { path: "$.id", variable: "ID" },
        { path: "$.nested.name", variable: "NAME" },
      ],
    });
    expect(extractVariables(r, '{"id":7,"nested":{"name":"ana"}}')).toEqual({
      ID: "7",
      NAME: "ana",
    });
  });

  it("skips a path that is not in the response instead of blanking the variable", () => {
    const r = req({ extractors: [{ path: "$.missing", variable: "TOKEN" }] });
    expect(extractVariables(r, '{"other":1}')).toEqual({});
  });

  it("returns nothing for a non-JSON body", () => {
    const r = req({ extractors: [{ path: "$.token", variable: "TOKEN" }] });
    expect(extractVariables(r, "<html>nope</html>")).toEqual({});
  });

  it("returns nothing when the request has no extractors", () => {
    expect(extractVariables(req(), '{"token":"abc"}')).toEqual({});
  });

  it("ignores a half-written rule", () => {
    const r = req({ extractors: [{ path: "", variable: "TOKEN" }, { path: "$.a", variable: "" }] });
    expect(extractVariables(r, '{"a":1}')).toEqual({});
  });
});

describe("runCollectionRequest", () => {
  it("sends with inherited auth and headers, variables resolved", async () => {
    const c = col({
      baseUrl: "{{BASE_URL}}",
      auth: { type: "bearer", token: "t0ken" },
      headers: { "X-Tenant": "acme" },
      requests: [req({ path: "/users" })],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent[0].url).toBe("https://api.test/users");
    expect(sent[0].headers.Authorization).toBe("Bearer t0ken");
    expect(sent[0].headers["X-Tenant"]).toBe("acme");
  });

  it("applies extractors and writes them to the active environment", async () => {
    nextResponse = res('{"data":{"token":"captured"}}');
    const c = col({ requests: [req({ extractors: [{ path: "$.data.token", variable: "TOKEN" }] })] });

    const out = await runCollectionRequest(c, c.requests[0]);

    expect(out.extracted).toEqual({ TOKEN: "captured" });
    expect(vars().TOKEN).toBe("captured");
  });

  it("makes a captured variable available to the next request", async () => {
    // El caso real: login, extraer el token, usarlo en la siguiente.
    const login = req({ id: "login", path: "/login", extractors: [{ path: "$.token", variable: "TOKEN" }] });
    const me = req({ id: "me", path: "/me", headers: { Authorization: "Bearer {{TOKEN}}" } });
    const c = col({ baseUrl: "{{BASE_URL}}", requests: [login, me] });

    nextResponse = res('{"token":"from-login"}');
    await runCollectionRequest(c, login);
    nextResponse = res("{}");
    await runCollectionRequest(c, me);

    expect(sent[1].headers.Authorization).toBe("Bearer from-login");
  });

  it("runs the pre-request script before resolving variables", async () => {
    // Si corriera despues, la peticion saldria con {{TOKEN}} sin resolver.
    const c = col({
      requests: [
        req({
          headers: { Authorization: "Bearer {{TOKEN}}" },
          scripts: { preRequest: 'pm.environment.set("TOKEN", "fresh");' },
        }),
      ],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent[0].headers.Authorization).toBe("Bearer fresh");
  });

  it("lets a pre-request script add a header", async () => {
    const c = col({
      requests: [req({ scripts: { preRequest: 'pm.request.headers.upsert("X-From-Script", "1");' } })],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent[0].headers["X-From-Script"]).toBe("1");
  });

  it("lets a script header override an inherited one", async () => {
    const c = col({
      headers: { "X-Env": "prod" },
      requests: [req({ scripts: { preRequest: 'pm.request.headers.upsert("X-Env", "from-script");' } })],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent[0].headers["X-Env"]).toBe("from-script");
  });

  it("runs the collection's inherited script, concatenated with the request's own", async () => {
    const c = col({
      scripts: { preRequest: 'pm.environment.set("FROM_COL", "yes");' },
      requests: [
        req({
          scripts: { preRequest: 'pm.request.headers.upsert("X-Chain", pm.environment.get("FROM_COL"));' },
        }),
      ],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent[0].headers["X-Chain"]).toBe("yes");
  });

  it("runs a folder's inherited script too", async () => {
    const c = col({
      folders: [
        {
          id: "f",
          name: "f",
          expanded: true,
          scripts: { preRequest: 'pm.request.headers.upsert("X-Folder", "ran");' },
          requests: [req()],
        },
      ],
    });
    await runCollectionRequest(c, c.folders[0].requests[0]);
    expect(sent[0].headers["X-Folder"]).toBe("ran");
  });

  it("returns pm.test() results from the post-response script", async () => {
    nextResponse = res('{"ok":true}', 201);
    const c = col({
      requests: [
        req({
          scripts: {
            postResponse: `
              pm.test("status is 201", () => pm.expect(pm.response.status).to.equal(201));
              pm.test("this one fails", () => pm.expect(pm.response.status).to.equal(500));
            `,
          },
        }),
      ],
    });
    const out = await runCollectionRequest(c, c.requests[0]);
    expect(out.scriptTests.map((t) => [t.name, t.pass])).toEqual([
      ["status is 201", true],
      ["this one fails", false],
    ]);
  });

  it("writes what a post-response script sets into the environment", async () => {
    nextResponse = res('{"token":"post-set"}');
    const c = col({
      requests: [
        req({ scripts: { postResponse: 'pm.environment.set("TOKEN", pm.response.json().token);' } }),
      ],
    });
    await runCollectionRequest(c, c.requests[0]);
    expect(vars().TOKEN).toBe("post-set");
  });

  it("does not touch the environment when nothing was captured", async () => {
    const before = { ...vars() };
    await runCollectionRequest(col({ requests: [req()] }), req());
    expect(vars()).toEqual(before);
  });
});

describe("a broken script fails the run instead of passing quietly", () => {
  it("reports a broken pre-request script as a failed assertion", async () => {
    const c = col({ requests: [req({ scripts: { preRequest: "this is not javascript(" } })] });
    const out = await runCollectionRequest(c, c.requests[0]);
    expect(out.scriptTests[0].name).toBe("pre-request script");
    expect(out.scriptTests[0].pass).toBe(false);
  });

  it("still sends the request, so you can see what came back", async () => {
    const c = col({ requests: [req({ scripts: { preRequest: "nope(((" } })] });
    await runCollectionRequest(c, c.requests[0]);
    expect(sent.length).toBe(1);
  });

  it("reports a broken post-response script too", async () => {
    const c = col({ requests: [req({ scripts: { postResponse: "nope(((" } })] });
    const out = await runCollectionRequest(c, c.requests[0]);
    expect(out.scriptTests.map((t) => t.name)).toContain("post-response script");
  });

  it("reports nothing extra when the scripts are fine", async () => {
    const c = col({ requests: [req({ scripts: { preRequest: 'pm.environment.set("A","1");' } })] });
    const out = await runCollectionRequest(c, c.requests[0]);
    expect(out.scriptTests).toEqual([]);
  });
});
