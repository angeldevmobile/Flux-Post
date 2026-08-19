import { describe, it, expect } from "vitest";
import { importPostman, importOpenApi, importCurl, detectFormat } from "../importers";

describe("detectFormat", () => {
  it("recognises a Postman collection by its schema url", () => {
    const text = JSON.stringify({
      info: { name: "x", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    });
    expect(detectFormat(text)).toBe("postman");
  });

  it("recognises OpenAPI 3 and Swagger 2", () => {
    expect(detectFormat(JSON.stringify({ openapi: "3.0.0" }))).toBe("openapi");
    expect(detectFormat(JSON.stringify({ swagger: "2.0" }))).toBe("openapi");
  });

  it("recognises cURL, including with leading whitespace", () => {
    expect(detectFormat("curl https://api.example.com")).toBe("curl");
    expect(detectFormat("   \n curl -X POST https://api.example.com")).toBe("curl");
  });

  it("falls back to postman for unrecognised input", () => {
    expect(detectFormat("{}")).toBe("postman");
    expect(detectFormat("nonsense")).toBe("postman");
  });
});

describe("importPostman", () => {
  it("imports top-level requests", () => {
    const col = importPostman({
      info: { name: "My API" },
      item: [
        {
          name: "Get users",
          request: {
            method: "GET",
            url: { raw: "https://api.example.com/users" },
            header: [{ key: "Accept", value: "application/json" }],
          },
        },
      ],
    });

    expect(col.name).toBe("My API");
    expect(col.requests).toHaveLength(1);
    expect(col.requests[0]).toMatchObject({
      name: "Get users",
      method: "GET",
      path: "https://api.example.com/users",
      headers: { Accept: "application/json" },
    });
  });

  it("turns nested items into folders", () => {
    const col = importPostman({
      info: { name: "API" },
      item: [
        {
          name: "Users",
          item: [
            { name: "List", request: { method: "GET", url: { raw: "/users" } } },
            { name: "Create", request: { method: "POST", url: { raw: "/users" } } },
          ],
        },
      ],
    });

    expect(col.requests).toHaveLength(0);
    expect(col.folders).toHaveLength(1);
    expect(col.folders[0].name).toBe("Users");
    expect(col.folders[0].requests.map(r => r.method)).toEqual(["GET", "POST"]);
  });

  it("drops disabled headers", () => {
    const col = importPostman({
      item: [
        {
          name: "R",
          request: {
            method: "GET",
            url: { raw: "/x" },
            header: [
              { key: "Keep", value: "1" },
              { key: "Drop", value: "2", disabled: true },
            ],
          },
        },
      ],
    });
    expect(col.requests[0].headers).toEqual({ Keep: "1" });
  });

  it("carries a raw body through", () => {
    const col = importPostman({
      item: [{ name: "R", request: { method: "POST", url: { raw: "/x" }, body: { mode: "raw", raw: '{"a":1}' } } }],
    });
    expect(col.requests[0].body).toBe('{"a":1}');
  });

  it("encodes a urlencoded body and skips disabled fields", () => {
    const col = importPostman({
      item: [
        {
          name: "R",
          request: {
            method: "POST",
            url: { raw: "/x" },
            body: {
              mode: "urlencoded",
              urlencoded: [
                { key: "a", value: "1" },
                { key: "b", value: "two words" },
                { key: "c", value: "3", disabled: true },
              ],
            },
          },
        },
      ],
    });
    // Van a `form`, no aplanados a cadena: asi el editor los muestra como
    // campos y el usuario puede tocarlos.
    expect(col.requests[0].bodyType).toBe("form");
    expect(col.requests[0].form).toEqual({ a: "1", b: "two words" });
  });

  it("accepts a plain-string url", () => {
    const col = importPostman({
      item: [{ name: "R", request: { method: "GET", url: "https://api.example.com/x" } }],
    });
    expect(col.requests[0].path).toBe("https://api.example.com/x");
  });

  it("accepts QUERY (RFC 10008)", () => {
    const col = importPostman({
      item: [{ name: "Search", request: { method: "QUERY", url: { raw: "/search" }, body: { mode: "raw", raw: '{"q":"x"}' } } }],
    });
    expect(col.requests[0].method).toBe("QUERY");
    expect(col.requests[0].body).toBe('{"q":"x"}');
  });

  it("falls back to defaults for an unknown method and a missing name", () => {
    const col = importPostman({
      item: [{ request: { method: "FROBNICATE", url: { raw: "/x" } } }],
    });
    expect(col.requests[0].method).toBe("GET");
    expect(col.requests[0].name).toBe("/x");
  });

  it("survives an empty document", () => {
    const col = importPostman({});
    expect(col.name).toBe("Imported Collection");
    expect(col.requests).toEqual([]);
    expect(col.folders).toEqual([]);
  });

  it("gives every request a distinct id", () => {
    const col = importPostman({
      item: [
        { name: "A", request: { method: "GET", url: { raw: "/a" } } },
        { name: "B", request: { method: "GET", url: { raw: "/b" } } },
      ],
    });
    const ids = col.requests.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("importOpenApi", () => {
  const doc = {
    info: { title: "Petstore" },
    servers: [{ url: "https://api.petstore.io/v1" }],
    paths: {
      "/pets": {
        get: { summary: "List pets", tags: ["pets"] },
        post: {
          summary: "Create pet",
          tags: ["pets"],
          requestBody: { content: { "application/json": { example: { name: "Rex" } } } },
        },
      },
      "/health": { get: { operationId: "health" } },
    },
  };

  it("puts the server url on the collection and keeps paths relative", () => {
    const col = importOpenApi(doc);
    // Antes se concatenaba en cada ruta, asi que exportar de vuelta a OpenAPI
    // duplicaba el host. El baseUrl vive en la coleccion, como en el exportador.
    expect(col.baseUrl).toBe("https://api.petstore.io/v1");
    const all = [...col.requests, ...col.folders.flatMap(f => f.requests)];
    expect(all.every(r => r.path.startsWith("/"))).toBe(true);
  });

  it("groups tagged operations into folders and leaves untagged at the root", () => {
    const col = importOpenApi(doc);
    expect(col.folders.map(f => f.name)).toEqual(["pets"]);
    expect(col.folders[0].requests).toHaveLength(2);
    expect(col.requests).toHaveLength(1);
    expect(col.requests[0].name).toBe("health");
  });

  it("uses the request body example and sets the content type", () => {
    const col = importOpenApi(doc);
    const post = col.folders[0].requests.find(r => r.method === "POST")!;
    expect(post.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(post.body!)).toEqual({ name: "Rex" });
  });

  it("falls back to an empty object body when no example is given", () => {
    const col = importOpenApi({
      paths: { "/x": { post: { requestBody: { content: { "application/json": {} } } } } },
    });
    expect(col.requests[0].body).toBe("{}");
  });

  it("prefers summary, then operationId, then a generated name", () => {
    const col = importOpenApi({
      paths: {
        "/a": { get: { summary: "Summary wins" } },
        "/b": { get: { operationId: "opId" } },
        "/c": { get: {} },
      },
    });
    expect(col.requests.map(r => r.name)).toEqual(["Summary wins", "opId", "GET /c"]);
  });

  it("survives an empty document", () => {
    const col = importOpenApi({});
    expect(col.name).toBe("Imported API");
    expect(col.requests).toEqual([]);
  });
});

describe("importCurl", () => {
  it("reads a bare GET", () => {
    const r = importCurl("curl https://api.example.com/users");
    expect(r.method).toBe("GET");
    expect(r.path).toBe("https://api.example.com/users");
  });

  it("reads an explicit -X method", () => {
    const r = importCurl("curl -X DELETE https://api.example.com/users/1");
    expect(r.method).toBe("DELETE");
    expect(r.path).toBe("https://api.example.com/users/1");
  });

  it("collects repeated -H headers", () => {
    const r = importCurl(
      `curl https://api.example.com -H "Accept: application/json" -H "Authorization: Bearer tok"`
    );
    expect(r.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("infers POST when a body is present without -X", () => {
    const r = importCurl(`curl https://api.example.com -d '{"a":1}'`);
    expect(r.method).toBe("POST");
    expect(r.body).toBe('{"a":1}');
  });

  it("keeps an explicit method even when a body is present", () => {
    const r = importCurl(`curl -X PUT https://api.example.com -d '{"a":1}'`);
    expect(r.method).toBe("PUT");
  });

  it("keeps an explicit QUERY with its body", () => {
    const r = importCurl(`curl -X QUERY https://api.example.com/search -d '{"q":"ana"}'`);
    expect(r.method).toBe("QUERY");
    expect(r.body).toBe('{"q":"ana"}');
  });

  it("accepts every --data spelling", () => {
    expect(importCurl(`curl https://x.io --data-raw '{"a":1}'`).body).toBe('{"a":1}');
    expect(importCurl(`curl https://x.io --data-binary '{"b":2}'`).body).toBe('{"b":2}');
    expect(importCurl(`curl https://x.io --data '{"c":3}'`).body).toBe('{"c":3}');
    expect(importCurl(`curl https://x.io --data-urlencode 'a=1'`).body).toBe("a=1");
  });

  // A JSON body is mostly double quotes; this is the common case, not an edge one.
  it("keeps a single-quoted JSON body intact", () => {
    const r = importCurl(`curl https://x.io -d '{"name":"ana","tags":["a","b"]}'`);
    expect(r.body).toBe('{"name":"ana","tags":["a","b"]}');
    expect(JSON.parse(r.body!)).toEqual({ name: "ana", tags: ["a", "b"] });
  });

  it("unescapes a double-quoted body", () => {
    const r = importCurl(`curl https://x.io -d "{\\"name\\":\\"ana\\"}"`);
    expect(r.body).toBe('{"name":"ana"}');
    expect(JSON.parse(r.body!)).toEqual({ name: "ana" });
  });

  it("reads an unquoted body", () => {
    expect(importCurl("curl https://x.io -d a=1").body).toBe("a=1");
  });

  it("folds backslash line continuations", () => {
    const r = importCurl(`curl https://api.example.com \\\n  -H "Accept: application/json" \\\n  -X POST`);
    expect(r.method).toBe("POST");
    expect(r.headers).toEqual({ Accept: "application/json" });
  });

  it("finds the url wherever it sits among the flags", () => {
    expect(importCurl(`curl -X POST -H "Accept: application/json" "https://api.example.com/x"`).path)
      .toBe("https://api.example.com/x");
    expect(importCurl(`curl 'https://api.example.com/y' -X GET`).path)
      .toBe("https://api.example.com/y");
  });

  it("does not mistake a url inside a header or body for the target", () => {
    const r = importCurl(
      `curl -H "Referer: https://evil.example.com/page" -d '{"cb":"https://cb.example.com"}' https://api.example.com/real`
    );
    expect(r.path).toBe("https://api.example.com/real");
  });

  it("names the request after the url, or falls back when there is none", () => {
    expect(importCurl("curl https://api.example.com/x").name).toBe("https://api.example.com/x");
    expect(importCurl("curl").name).toBe("Imported cURL");
  });
});

describe("importPostman fidelity", () => {
  const wrap = (request: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    importPostman({
      info: { name: "C" },
      item: [{ name: "R", request, ...extra }],
      ...(extra.collectionAuth ? { auth: extra.collectionAuth } : {}),
    });

  it("brings bearer auth across", () => {
    const col = wrap({
      method: "GET", url: { raw: "/x" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "T" }] },
    });
    expect(col.requests[0].auth).toEqual({ type: "bearer", token: "T" });
  });

  it("brings oauth2 across, mapping accessTokenUrl to tokenUrl", () => {
    const col = wrap({
      method: "GET", url: { raw: "/x" },
      auth: { type: "oauth2", oauth2: [
        { key: "clientId", value: "id" },
        { key: "accessTokenUrl", value: "https://t" },
        { key: "scope", value: "read write" },
      ] },
    });
    expect(col.requests[0].auth).toMatchObject({
      type: "oauth2", clientId: "id", tokenUrl: "https://t", scopes: "read write",
    });
  });

  it("falls back to the collection auth when the request has none", () => {
    const col = importPostman({
      info: { name: "C" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "COL" }] },
      item: [{ name: "R", request: { method: "GET", url: { raw: "/x" } } }],
    });
    expect(col.requests[0].auth).toEqual({ type: "bearer", token: "COL" });
  });

  it("brings scripts across from the event array", () => {
    const col = wrap(
      { method: "GET", url: { raw: "/x" } },
      { event: [
        { listen: "prerequest", script: { exec: ["const a = 1;", "console.log(a);"] } },
        { listen: "test", script: { exec: ["pm.test('ok', () => {});"] } },
      ] },
    );
    expect(col.requests[0].scripts).toEqual({
      preRequest: "const a = 1;\nconsole.log(a);",
      postResponse: "pm.test('ok', () => {});",
    });
  });

  it("brings a graphql body across instead of dropping it", () => {
    const col = wrap({
      method: "POST", url: { raw: "/gql" },
      body: { mode: "graphql", graphql: { query: "{ me }", variables: "{}" } },
    });
    expect(col.requests[0].bodyType).toBe("graphql");
    expect(col.requests[0].graphql).toEqual({ query: "{ me }", variables: "{}" });
  });

  it("brings query params across from url.query", () => {
    const col = wrap({
      method: "GET",
      url: { raw: "/x?page=2", query: [
        { key: "page", value: "2" },
        { key: "draft", value: "1", disabled: true },
      ] },
    });
    expect(col.requests[0].params).toEqual({ page: "2" });
  });

  it("keeps folders nested instead of dropping the inner ones", () => {
    const col = importPostman({
      info: { name: "C" },
      item: [{
        name: "Outer",
        item: [
          { name: "Direct", request: { method: "GET", url: { raw: "/a" } } },
          { name: "Inner", item: [{ name: "Deep", request: { method: "GET", url: { raw: "/b" } } }] },
        ],
      }],
    });
    const outer = col.folders[0];
    expect(outer.requests).toHaveLength(1);
    expect(outer.folders?.[0].name).toBe("Inner");
    expect(outer.folders?.[0].requests[0].name).toBe("Deep");
  });

  it("tags a raw JSON body as json", () => {
    const col = wrap({ method: "POST", url: { raw: "/x" }, body: { mode: "raw", raw: '{"a":1}' } });
    expect(col.requests[0].bodyType).toBe("json");
  });
});

describe("importOpenApi fidelity", () => {
  const spec = {
    info: { title: "API" },
    servers: [{ url: "https://api.test" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths: {
      "/users/{id}": {
        get: {
          summary: "Get user",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "expand", in: "query", schema: { type: "string" }, example: "profile" },
            { name: "X-Trace", in: "header", schema: { type: "string" }, example: "abc" },
          ],
        },
      },
      "/users": {
        post: {
          summary: "Create",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" }, age: { type: "integer" } },
                },
              },
            },
          },
        },
      },
    },
  };

  const col = () => importOpenApi(spec);
  const find = (name: string) => {
    const all = [...col().requests, ...col().folders.flatMap(f => f.requests)];
    return all.find(r => r.name === name)!;
  };

  it("turns path parameters into Flux variables", () => {
    expect(find("Get user").path).toBe("/users/{{id}}");
  });

  it("carries query and header parameters", () => {
    expect(find("Get user").params).toEqual({ expand: "profile" });
    expect(find("Get user").headers["X-Trace"]).toBe("abc");
  });

  it("resolves the security scheme into an auth block", () => {
    expect(find("Get user").auth).toEqual({ type: "bearer", token: "" });
  });

  it("builds a body from the schema when the spec has no example", () => {
    const req = find("Create");
    expect(req.bodyType).toBe("json");
    expect(JSON.parse(req.body!)).toEqual({ name: "", age: 0 });
  });

  it("maps a urlencoded request body to form fields", () => {
    const formSpec = {
      ...spec,
      paths: {
        "/login": {
          post: {
            summary: "Login",
            requestBody: {
              content: {
                "application/x-www-form-urlencoded": {
                  schema: { type: "object", properties: { user: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    };
    const req = importOpenApi(formSpec).requests[0];
    expect(req.bodyType).toBe("form");
    expect(req.form).toEqual({ user: "" });
  });
});
