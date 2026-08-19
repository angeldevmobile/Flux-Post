import { describe, it, expect } from "vitest";
import { exportPostman, exportOpenAPI, exportCurl, exportFetch, exportAxios, exportPythonRequests, exportGoHttp } from "../exporters";
import { importPostman, importCurl } from "../importers";
import type { Collection } from "@/stores/collections";

const collection: Collection = {
  id: "col-1",
  name: "My API",
  expanded: true,
  requests: [
    {
      id: "r1",
      name: "Get users",
      method: "GET",
      path: "https://api.example.com/users",
      headers: { Accept: "application/json" },
      tests: [],
    },
  ],
  folders: [
    {
      id: "f1",
      name: "Admin",
      expanded: true,
      requests: [
        {
          id: "r2",
          name: "Create user",
          method: "POST",
          path: "https://api.example.com/admin/users",
          headers: { "Content-Type": "application/json" },
          body: '{"name":"ana"}',
          tests: [],
        },
      ],
    },
  ],
};

const snippet = {
  method: "POST",
  url: "https://api.example.com/users",
  headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
  body: '{"name":"ana"}',
};

describe("exportPostman", () => {
  it("emits a v2.1 document", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.info.name).toBe("My API");
    expect(doc.info.schema).toContain("v2.1.0");
  });

  it("keeps root requests and folders distinct", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.item).toHaveLength(2);
    expect(doc.item[0].name).toBe("Get users");
    expect(doc.item[1].name).toBe("Admin");
    expect(doc.item[1].item).toHaveLength(1);
  });

  it("survives a round trip through the importer", () => {
    const reimported = importPostman(JSON.parse(exportPostman(collection)));

    expect(reimported.name).toBe("My API");
    expect(reimported.requests).toHaveLength(1);
    expect(reimported.requests[0]).toMatchObject({
      name: "Get users",
      method: "GET",
      path: "https://api.example.com/users",
      headers: { Accept: "application/json" },
    });

    expect(reimported.folders).toHaveLength(1);
    expect(reimported.folders[0].name).toBe("Admin");
    expect(reimported.folders[0].requests[0]).toMatchObject({
      name: "Create user",
      method: "POST",
      path: "https://api.example.com/admin/users",
      body: '{"name":"ana"}',
    });
  });

  it("omits the variable block when there is no base url", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.variable).toBeUndefined();
  });

  it("keeps folders nested instead of dropping the inner ones", () => {
    const nested: Collection = {
      ...collection,
      requests: [],
      folders: [
        {
          id: "f1", name: "Outer", expanded: true,
          requests: [{ id: "a", name: "Outer req", method: "GET", path: "/a", headers: {}, tests: [] }],
          folders: [
            {
              id: "f2", name: "Inner", expanded: true,
              requests: [{ id: "b", name: "Inner req", method: "GET", path: "/b", headers: {}, tests: [] }],
            },
          ],
        },
      ],
    };

    const doc = JSON.parse(exportPostman(nested));
    const outer = doc.item[0];
    expect(outer.name).toBe("Outer");
    expect(outer.item.map((i: { name: string }) => i.name)).toEqual(["Outer req", "Inner"]);

    const inner = outer.item[1];
    expect(inner.item[0].name).toBe("Inner req");
  });
});

describe("exportCurl", () => {
  it("includes the method, headers and body", () => {
    const out = exportCurl(snippet);
    expect(out).toContain("curl -X POST");
    expect(out).toContain(`-H "Content-Type: application/json"`);
    expect(out).toContain(`-H "Authorization: Bearer tok"`);
    expect(out).toContain(`-d '{"name":"ana"}'`);
    expect(out).toContain(`"https://api.example.com/users"`);
  });

  it("produces something the cURL importer can read back", () => {
    const back = importCurl(exportCurl(snippet));
    expect(back.method).toBe("POST");
    expect(back.path).toBe("https://api.example.com/users");
    expect(back.body).toBe('{"name":"ana"}');
    expect(back.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("escapes single quotes in the body", () => {
    const out = exportCurl({ ...snippet, body: "it's" });
    expect(out).toContain(`'it'\\''s'`);
  });

  it("omits -d when there is no body", () => {
    expect(exportCurl({ ...snippet, body: undefined })).not.toContain("-d");
  });
});

describe("exportFetch", () => {
  it("emits a fetch call with headers and body", () => {
    const out = exportFetch(snippet);
    expect(out).toContain(`await fetch("https://api.example.com/users"`);
    expect(out).toContain(`method: "POST"`);
    expect(out).toContain(`"Content-Type": "application/json"`);
    expect(out).toContain("body:");
  });

  it("omits the headers block when there are none", () => {
    expect(exportFetch({ ...snippet, headers: {} })).not.toContain("headers:");
  });
});

describe("exportAxios", () => {
  it("inlines a JSON body as an object literal", () => {
    const out = exportAxios(snippet);
    expect(out).toContain(`method: "post"`);
    expect(out).toContain("data: {");
    expect(out).not.toContain('data: `');
  });

  it("falls back to a template literal for a non-JSON body", () => {
    expect(exportAxios({ ...snippet, body: "plain text" })).toContain("data: `plain text`");
  });
});

describe("exportPythonRequests", () => {
  it("emits an import and the request call", () => {
    const out = exportPythonRequests(snippet);
    expect(out).toContain("import requests");
    expect(out).toContain("https://api.example.com/users");
  });
});

describe("exportGoHttp", () => {
  it("emits a compilable-looking Go program", () => {
    const out = exportGoHttp(snippet);
    expect(out).toContain("package main");
    expect(out).toContain("net/http");
    expect(out).toContain("https://api.example.com/users");
  });
});

describe("exportPostman fidelity", () => {
  const full = {
    id: "c1", name: "Full", expanded: true, folders: [],
    requests: [{
      id: "r1", name: "Login", method: "POST" as const, path: "/login",
      headers: { "X-Trace": "1" },
      params: { verbose: "true" },
      body: '{"a":1}', bodyType: "json",
      auth: { type: "bearer", token: "{{TOKEN}}" },
      scripts: { preRequest: "pm.environment.set('t', 1)", postResponse: "console.log(1)" },
      extractors: [{ path: "json.token", variable: "TOKEN" }],
      tests: [{ assert: "status == 200" }],
    }],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = () => JSON.parse(exportPostman(full as any));
  const req = () => doc().item[0].request;

  it("carries the auth block instead of dropping it", () => {
    expect(req().auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{TOKEN}}", type: "string" }],
    });
  });

  it("carries query params", () => {
    expect(req().url.query).toEqual([{ key: "verbose", value: "true" }]);
  });

  it("carries the pre-request script", () => {
    const pre = doc().item[0].event.find((e: { listen: string }) => e.listen === "prerequest");
    expect(pre.script.exec).toEqual(["pm.environment.set('t', 1)"]);
  });

  it("keeps assertions and extractors visible as comments in the test script", () => {
    const test = doc().item[0].event.find((e: { listen: string }) => e.listen === "test");
    expect(test.script.exec).toContain("// Flux assertion: status == 200");
    expect(test.script.exec).toContain("// Flux extractor: TOKEN = json.token");
  });

  it("maps a graphql body to the graphql mode", () => {
    const gql = {
      ...full,
      requests: [{ ...full.requests[0], bodyType: "graphql", graphql: { query: "{ me }", variables: "{}" } }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(exportPostman(gql as any)).item[0].request.body;
    expect(body.mode).toBe("graphql");
    expect(body.graphql.query).toBe("{ me }");
  });

  it("maps a form body to urlencoded", () => {
    const form = {
      ...full,
      requests: [{ ...full.requests[0], bodyType: "form", form: { user: "ana" } }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(exportPostman(form as any)).item[0].request.body;
    expect(body.mode).toBe("urlencoded");
    expect(body.urlencoded).toEqual([{ key: "user", value: "ana", type: "text" }]);
  });
});

describe("exportOpenAPI fidelity", () => {
  const base = {
    id: "c1", name: "API", baseUrl: "https://api.test", expanded: true, folders: [],
  };
  const request = {
    id: "r1", name: "Create user", method: "POST" as const, path: "/users",
    headers: { "X-Trace": "abc", "Content-Type": "application/json" },
    params: { verbose: "true" },
    body: '{"name":"ana"}', bodyType: "json",
    auth: { type: "bearer", token: "{{TOKEN}}" },
    tests: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (req: any = request) =>
    JSON.parse(exportOpenAPI({ ...base, requests: [req] } as any));
  const op = () => doc().paths["/users"].post;

  it("carries params from the Params tab, not just from the url", () => {
    const query = op().parameters.filter((p: { in: string }) => p.in === "query");
    expect(query.map((p: { name: string }) => p.name)).toEqual(["verbose"]);
  });

  it("carries custom headers but not Content-Type", () => {
    const headers = op().parameters.filter((p: { in: string }) => p.in === "header");
    expect(headers.map((p: { name: string }) => p.name)).toEqual(["X-Trace"]);
  });

  it("declares the security scheme and references it", () => {
    expect(doc().components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });
    expect(op().security).toEqual([{ bearerAuth: [] }]);
  });

  it("omits components when no request is authenticated", () => {
    expect(doc({ ...request, auth: { type: "none" } }).components).toBeUndefined();
  });

  it("maps a form body to urlencoded content", () => {
    const body = doc({ ...request, bodyType: "form", form: { user: "ana" } }).paths["/users"].post.requestBody;
    expect(Object.keys(body.content)).toEqual(["application/x-www-form-urlencoded"]);
    expect(body.content["application/x-www-form-urlencoded"].example).toEqual({ user: "ana" });
  });

  it("describes a graphql body as query plus variables", () => {
    const body = doc({
      ...request, bodyType: "graphql", graphql: { query: "{ me }", variables: "{}" },
    }).paths["/users"].post.requestBody;
    expect(body.content["application/json"].example.query).toBe("{ me }");
  });
});
