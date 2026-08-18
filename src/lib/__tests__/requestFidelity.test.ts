import { describe, it, expect } from "vitest";
import {
  toCollectionRequest, fromCollectionRequest, findLiteralSecrets, suggestVariableName,
  type RequestSnapshot,
} from "../requestFidelity";

const kv = (key: string, value: string, enabled = true) => ({ key, value, enabled });

const base: RequestSnapshot = {
  method: "GET",
  url: "https://api.example.com/users",
  headers: [],
  params: [],
  body: "",
  bodyType: "none",
  formFields: [],
  graphqlQuery: "",
  graphqlVariables: "",
  preRequestScript: "",
  postResponseScript: "",
  extractors: [],
  authType: "none",
  authBearer: "",
  authBasicUser: "",
  authBasicPass: "",
  authApiKeyName: "X-API-Key",
  authApiKeyValue: "",
  authApiKeyIn: "header",
  authOAuthGrantType: "authorization_code",
  authOAuthClientId: "",
  authOAuthClientSecret: "",
  authOAuthAuthUrl: "",
  authOAuthTokenUrl: "",
  authOAuthScopes: "",
  authAwsRegion: "us-east-1",
  authAwsService: "execute-api",
  authAwsAccessKeyId: "",
  authAwsSecretAccessKey: "",
  authAwsSessionToken: "",
};

const save = (over: Partial<RequestSnapshot> = {}) =>
  toCollectionRequest({ ...base, ...over }, { id: "r1", name: "R" });

describe("toCollectionRequest", () => {
  it("keeps only enabled key/value rows", () => {
    const req = save({
      headers: [kv("Accept", "application/json"), kv("X-Off", "1", false)],
      params: [kv("page", "2"), kv("skip", "9", false)],
    });
    expect(req.headers).toEqual({ Accept: "application/json" });
    expect(req.params).toEqual({ page: "2" });
  });

  it("omits empty sections instead of writing blank ones", () => {
    const req = save();
    expect(req.params).toBeUndefined();
    expect(req.form).toBeUndefined();
    expect(req.graphql).toBeUndefined();
    expect(req.auth).toBeUndefined();
    expect(req.scripts).toBeUndefined();
    expect(req.extractors).toBeUndefined();
    expect(req.body).toBeUndefined();
    expect(req.bodyType).toBeUndefined();
  });

  it("captures scripts", () => {
    const req = save({ preRequestScript: "pre()", postResponseScript: "post()" });
    expect(req.scripts).toEqual({ preRequest: "pre()", postResponse: "post()" });
  });

  it("captures a graphql body", () => {
    const req = save({ bodyType: "graphql", graphqlQuery: "{ users }", graphqlVariables: '{"a":1}' });
    expect(req.bodyType).toBe("graphql");
    expect(req.graphql).toEqual({ query: "{ users }", variables: '{"a":1}' });
  });

  it("captures form fields", () => {
    const req = save({ bodyType: "form", formFields: [kv("user", "ana"), kv("x", "1", false)] });
    expect(req.form).toEqual({ user: "ana" });
  });

  it("keeps only enabled, fully filled extractors", () => {
    const req = save({
      extractors: [
        { id: "1", path: "$.token", variable: "token", enabled: true },
        { id: "2", path: "$.x", variable: "x", enabled: false },
        { id: "3", path: "", variable: "y", enabled: true },
      ],
    });
    expect(req.extractors).toEqual([{ path: "$.token", variable: "token" }]);
  });

  it("captures each auth type", () => {
    expect(save({ authType: "bearer", authBearer: "{{T}}" }).auth)
      .toEqual({ type: "bearer", token: "{{T}}" });

    expect(save({ authType: "basic", authBasicUser: "ana", authBasicPass: "{{P}}" }).auth)
      .toEqual({ type: "basic", username: "ana", password: "{{P}}" });

    expect(save({ authType: "apikey", authApiKeyValue: "{{K}}" }).auth)
      .toMatchObject({ type: "apikey", key: "X-API-Key", value: "{{K}}", in: "header" });

    expect(save({ authType: "oauth2", authOAuthClientId: "id", authOAuthTokenUrl: "https://t" }).auth)
      .toMatchObject({ type: "oauth2", clientId: "id", tokenUrl: "https://t" });

    expect(save({ authType: "awssigv4", authAwsAccessKeyId: "{{ID}}" }).auth)
      .toMatchObject({ type: "awssigv4", region: "us-east-1", accessKeyId: "{{ID}}" });
  });
});

describe("round trip", () => {
  it("restores everything that was captured", () => {
    const original: RequestSnapshot = {
      ...base,
      method: "QUERY",
      url: "https://api.example.com/search",
      headers: [kv("Content-Type", "application/json")],
      params: [kv("page", "2")],
      body: '{"q":"ana"}',
      bodyType: "json",
      preRequestScript: "pre()",
      postResponseScript: "post()",
      extractors: [{ id: "1", path: "$.token", variable: "token", enabled: true }],
      authType: "bearer",
      authBearer: "{{API_TOKEN}}",
    };

    const restored = fromCollectionRequest(toCollectionRequest(original, { id: "r1", name: "R" }));

    expect(restored.method).toBe("QUERY");
    expect(restored.url).toBe("https://api.example.com/search");
    expect(restored.body).toBe('{"q":"ana"}');
    expect(restored.bodyType).toBe("json");
    expect(restored.preRequestScript).toBe("pre()");
    expect(restored.postResponseScript).toBe("post()");
    expect(restored.authType).toBe("bearer");
    expect(restored.authBearer).toBe("{{API_TOKEN}}");
    expect(restored.headers.map(h => [h.key, h.value])).toEqual([["Content-Type", "application/json"]]);
    expect(restored.params.map(p => [p.key, p.value])).toEqual([["page", "2"]]);
    expect(restored.extractors).toEqual([{ id: "e-0", path: "$.token", variable: "token", enabled: true }]);
  });

  it("returns defaults for a request that carries nothing", () => {
    const restored = fromCollectionRequest({
      id: "r1", name: "R", method: "GET", path: "/x", headers: {}, tests: [],
    });

    expect(restored.authType).toBe("none");
    expect(restored.authBearer).toBe("");
    expect(restored.preRequestScript).toBe("");
    expect(restored.extractors).toEqual([]);
    expect(restored.params).toEqual([]);
    expect(restored.bodyType).toBe("none");
    // Defaults, not blanks, for the fields that have one.
    expect(restored.authApiKeyName).toBe("X-API-Key");
    expect(restored.authAwsRegion).toBe("us-east-1");
  });
});

describe("findLiteralSecrets", () => {
  it("flags a literal bearer token", () => {
    const found = findLiteralSecrets({ ...base, authType: "bearer", authBearer: "sk-live-abc" }, "Get users");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Bearer token");
    expect(found[0].value).toBe("sk-live-abc");
    expect(found[0].suggested).toBe("GET_USERS_TOKEN");
  });

  it("accepts a {{VAR}} reference, with or without spacing", () => {
    expect(findLiteralSecrets({ ...base, authType: "bearer", authBearer: "{{TOKEN}}" }, "R")).toEqual([]);
    expect(findLiteralSecrets({ ...base, authType: "bearer", authBearer: "  {{TOKEN}}  " }, "R")).toEqual([]);
  });

  it("ignores an empty credential", () => {
    expect(findLiteralSecrets({ ...base, authType: "bearer", authBearer: "" }, "R")).toEqual([]);
  });

  it("does not flag non-secret fields", () => {
    const found = findLiteralSecrets(
      { ...base, authType: "basic", authBasicUser: "ana", authBasicPass: "{{P}}" },
      "R",
    );
    expect(found).toEqual([]);
  });

  it("flags every credential of a multi-secret auth type", () => {
    const found = findLiteralSecrets(
      { ...base, authType: "awssigv4", authAwsAccessKeyId: "AKIA123", authAwsSecretAccessKey: "shh" },
      "S3",
    );
    expect(found.map(s => s.field).sort()).toEqual(["authAwsAccessKeyId", "authAwsSecretAccessKey"]);
  });

  it("finds nothing when auth is off", () => {
    expect(findLiteralSecrets({ ...base, authType: "none", authBearer: "leftover" }, "R")).toEqual([]);
  });
});

describe("suggestVariableName", () => {
  it("builds a shouty snake name from the request", () => {
    expect(suggestVariableName("Get users", "authBearer")).toBe("GET_USERS_TOKEN");
    expect(suggestVariableName("créate  user!", "authBasicPass")).toBe("CR_ATE_USER_PASSWORD");
  });

  it("falls back to the bare suffix when the name has nothing usable", () => {
    expect(suggestVariableName("", "authBearer")).toBe("TOKEN");
    expect(suggestVariableName("!!!", "authApiKeyValue")).toBe("API_KEY");
  });
});
