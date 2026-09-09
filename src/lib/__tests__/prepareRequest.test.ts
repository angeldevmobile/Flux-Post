import { describe, it, expect } from "vitest";
import { prepareRequest } from "../prepareRequest";
import type { Collection, CollectionFolder, CollectionRequest } from "@/lib/tauri";

const VARS: Record<string, string> = {
  BASE_URL: "https://api.acme.com",
  TOKEN: "t0ken",
  ADMIN_KEY: "k123",
  PAGE: "2",
  NAME: "ana",
};
const resolve = (v: string) => v.replace(/\{\{([^}]+)\}\}/g, (o, k) => (k in VARS ? VARS[k] : o));

function req(extra: Partial<CollectionRequest> = {}): CollectionRequest {
  return { id: "r", name: "r", method: "GET", path: "/x", headers: {}, tests: [], ...extra };
}

function folder(id: string, extra: Partial<CollectionFolder> = {}): CollectionFolder {
  return { id, name: id, expanded: true, requests: [], ...extra };
}

function col(extra: Partial<Collection> = {}): Collection {
  return { id: "c", name: "c", requests: [], folders: [], expanded: true, ...extra };
}

describe("prepareRequest", () => {
  it("interpolates the base url and the path", () => {
    const c = col({ baseUrl: "{{BASE_URL}}", requests: [req({ path: "/users" })] });
    expect(prepareRequest(c, c.requests[0], resolve).url).toBe("https://api.acme.com/users");
  });

  it("lets an absolute path win over the base url", () => {
    const c = col({
      baseUrl: "https://api.acme.com",
      requests: [req({ path: "https://other.example.com/x" })],
    });
    expect(prepareRequest(c, c.requests[0], resolve).url).toBe("https://other.example.com/x");
  });

  it("interpolates header values", () => {
    const c = col({ requests: [req({ headers: { "X-Token": "{{TOKEN}}" } })] });
    expect(prepareRequest(c, c.requests[0], resolve).headers["X-Token"]).toBe("t0ken");
  });

  it("interpolates the body", () => {
    const c = col({ requests: [req({ body: '{"name":"{{NAME}}"}' })] });
    expect(prepareRequest(c, c.requests[0], resolve).body).toBe('{"name":"ana"}');
  });

  it("leaves the body undefined when there is none", () => {
    const c = col({ requests: [req()] });
    expect(prepareRequest(c, c.requests[0], resolve).body).toBeUndefined();
  });

  it("puts saved query params in the url, interpolated", () => {
    const c = col({ requests: [req({ params: { page: "{{PAGE}}" } })] });
    expect(prepareRequest(c, c.requests[0], resolve).url).toBe("/x?page=2");
  });

  it("applies inherited auth as a header", () => {
    const c = col({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      requests: [req()],
    });
    expect(prepareRequest(c, c.requests[0], resolve).headers.Authorization).toBe("Bearer t0ken");
  });

  it("lets a folder's auth replace the collection's", () => {
    const c = col({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      folders: [
        folder("Admin", {
          auth: { type: "apikey", key: "X-Admin-Key", value: "{{ADMIN_KEY}}" },
          requests: [req()],
        }),
      ],
    });
    const out = prepareRequest(c, c.folders[0].requests[0], resolve);
    expect(out.headers["X-Admin-Key"]).toBe("k123");
    expect(out.headers.Authorization).toBeUndefined();
  });

  it("merges inherited headers with the request's own", () => {
    const c = col({
      headers: { "X-Tenant": "acme" },
      folders: [folder("f", { headers: { "X-Scope": "admin" }, requests: [req({ headers: { "X-Own": "1" } })] })],
    });
    expect(prepareRequest(c, c.folders[0].requests[0], resolve).headers).toEqual({
      "X-Tenant": "acme",
      "X-Scope": "admin",
      "X-Own": "1",
    });
  });

  it("sends an api key configured for the query in the url, not the headers", () => {
    const c = col({
      auth: { type: "apikey", key: "api_key", value: "{{ADMIN_KEY}}", in: "query" },
      requests: [req()],
    });
    const out = prepareRequest(c, c.requests[0], resolve);
    expect(out.url).toBe("/x?api_key=k123");
    expect(out.headers.api_key).toBeUndefined();
  });

  it("encodes the resolved value, not the template", () => {
    const c = col({ requests: [req({ params: { q: "{{NAME}} smith" } })] });
    expect(prepareRequest(c, c.requests[0], resolve).url).toBe("/x?q=ana%20smith");
  });

  it("sends no auth when a folder sets `none`", () => {
    const c = col({
      auth: { type: "bearer", token: "{{TOKEN}}" },
      folders: [folder("public", { auth: { type: "none" }, requests: [req()] })],
    });
    expect(prepareRequest(c, c.folders[0].requests[0], resolve).headers.Authorization).toBeUndefined();
  });

  it("falls back to the request's own values when it is not in the collection", () => {
    // Puede pasar si la coleccion se recargo entre medias.
    const c = col();
    const orphan = req({ headers: { "X-Own": "{{TOKEN}}" }, auth: { type: "bearer", token: "{{TOKEN}}" } });
    const out = prepareRequest(c, orphan, resolve);
    expect(out.headers["X-Own"]).toBe("t0ken");
    expect(out.headers.Authorization).toBe("Bearer t0ken");
  });
});
