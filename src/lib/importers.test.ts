import { describe, it, expect } from "vitest";
import { importPostman, importOpenApi, importCurl, detectFormat } from "./importers";

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
    expect(col.requests[0].body).toBe("a=1&b=two%20words");
  });

  it("accepts a plain-string url", () => {
    const col = importPostman({
      item: [{ name: "R", request: { method: "GET", url: "https://api.example.com/x" } }],
    });
    expect(col.requests[0].path).toBe("https://api.example.com/x");
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

  it("prefixes paths with the first server url", () => {
    const col = importOpenApi(doc);
    const all = [...col.requests, ...col.folders.flatMap(f => f.requests)];
    expect(all.every(r => r.path.startsWith("https://api.petstore.io/v1"))).toBe(true);
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
