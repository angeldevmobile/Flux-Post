import type {
  CollectionAuth, CollectionExtractor, CollectionGraphql,
  CollectionRequest, CollectionScripts, HttpMethod,
} from "@/lib/tauri";
import type { AuthType, ApiKeyTarget, OAuthGrantType, BodyType, Extractor } from "@/stores/request";
import { resolveRequestUrl } from "@/lib/requestUrl";

/** The slice of the request store a collection can carry. */
export interface RequestSnapshot {
  method: HttpMethod;
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  params: { key: string; value: string; enabled: boolean }[];
  body: string;
  bodyType: BodyType;
  formFields: { key: string; value: string; enabled: boolean }[];
  graphqlQuery: string;
  graphqlVariables: string;
  preRequestScript: string;
  postResponseScript: string;
  extractors: Extractor[];
  authType: AuthType;
  authBearer: string;
  authBasicUser: string;
  authBasicPass: string;
  authApiKeyName: string;
  authApiKeyValue: string;
  authApiKeyIn: ApiKeyTarget;
  authOAuthGrantType: OAuthGrantType;
  authOAuthClientId: string;
  authOAuthClientSecret: string;
  authOAuthAuthUrl: string;
  authOAuthTokenUrl: string;
  authOAuthScopes: string;
  authAwsRegion: string;
  authAwsService: string;
  authAwsAccessKeyId: string;
  authAwsSecretAccessKey: string;
  authAwsSessionToken: string;
}

const enabledPairs = (rows: { key: string; value: string; enabled: boolean }[]) => {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.enabled && r.key.trim()) out[r.key.trim()] = r.value;
  return out;
};

const rows = (map: Record<string, string> | undefined, prefix: string) =>
  Object.entries(map ?? {}).map(([key, value], i) => ({
    id: `${prefix}-${i}`, key, value, enabled: true,
  }));

const clean = (s: string) => (s.trim() ? s : undefined);

function toAuth(s: RequestSnapshot): CollectionAuth | undefined {
  if (s.authType === "none") return undefined;
  const base = { type: s.authType };
  switch (s.authType) {
    case "bearer":
      return { ...base, token: s.authBearer };
    case "basic":
      return { ...base, username: s.authBasicUser, password: s.authBasicPass };
    case "apikey":
      return { ...base, key: s.authApiKeyName, value: s.authApiKeyValue, in: s.authApiKeyIn };
    case "oauth2":
      return {
        ...base,
        grantType: s.authOAuthGrantType,
        clientId: s.authOAuthClientId,
        clientSecret: clean(s.authOAuthClientSecret),
        authUrl: clean(s.authOAuthAuthUrl),
        tokenUrl: s.authOAuthTokenUrl,
        scopes: clean(s.authOAuthScopes),
      };
    case "awssigv4":
      return {
        ...base,
        region: s.authAwsRegion,
        service: s.authAwsService,
        accessKeyId: s.authAwsAccessKeyId,
        secretAccessKey: s.authAwsSecretAccessKey,
        sessionToken: clean(s.authAwsSessionToken),
      };
    default:
      return undefined;
  }
}

/** Builds the persisted shape of the request currently in the panel. */
export function toCollectionRequest(
  s: RequestSnapshot,
  meta: { id: string; name: string; tests?: { assert: string }[] },
): CollectionRequest {
  const scripts: CollectionScripts = {
    preRequest: clean(s.preRequestScript),
    postResponse: clean(s.postResponseScript),
  };
  const graphql: CollectionGraphql = {
    query: clean(s.graphqlQuery),
    variables: clean(s.graphqlVariables),
  };
  const extractors: CollectionExtractor[] = s.extractors
    .filter(e => e.enabled && e.path.trim() && e.variable.trim())
    .map(e => ({ path: e.path.trim(), variable: e.variable.trim() }));

  const params = enabledPairs(s.params);
  const form = enabledPairs(s.formFields);
  const hasScripts = !!(scripts.preRequest || scripts.postResponse);
  const hasGraphql = !!(graphql.query || graphql.variables);

  return {
    id: meta.id,
    name: meta.name,
    kind: "http",
    method: s.method,
    path: s.url,
    headers: enabledPairs(s.headers),
    body: clean(s.body),
    bodyType: s.bodyType === "none" ? undefined : s.bodyType,
    params: Object.keys(params).length ? params : undefined,
    form: Object.keys(form).length ? form : undefined,
    graphql: hasGraphql ? graphql : undefined,
    auth: toAuth(s),
    scripts: hasScripts ? scripts : undefined,
    extractors: extractors.length ? extractors : undefined,
    tests: meta.tests ?? [],
  };
}

/**
 * The store patch that restores a saved request. Fields the collection does not
 * carry come back as their defaults, so nothing leaks in from the request that
 * was open before.
 */
export function fromCollectionRequest(req: CollectionRequest, baseUrl?: string) {
  const a = req.auth;
  return {
    method: req.method,
    url: resolveRequestUrl(baseUrl, req.path),
    headers: rows(req.headers, "h"),
    params: rows(req.params, "p"),
    body: req.body ?? "",
    bodyType: (req.bodyType ?? "none") as BodyType,
    formFields: rows(req.form, "f"),
    graphqlQuery: req.graphql?.query ?? "",
    graphqlVariables: req.graphql?.variables ?? "",
    preRequestScript: req.scripts?.preRequest ?? "",
    postResponseScript: req.scripts?.postResponse ?? "",
    extractors: (req.extractors ?? []).map((e, i) => ({
      id: `e-${i}`, path: e.path, variable: e.variable, enabled: true,
    })),
    authType: (a?.type ?? "none") as AuthType,
    authBearer: a?.token ?? "",
    authBasicUser: a?.username ?? "",
    authBasicPass: a?.password ?? "",
    authApiKeyName: a?.key ?? "X-API-Key",
    authApiKeyValue: a?.value ?? "",
    authApiKeyIn: (a?.in ?? "header") as ApiKeyTarget,
    authOAuthGrantType: (a?.grantType ?? "authorization_code") as OAuthGrantType,
    authOAuthClientId: a?.clientId ?? "",
    authOAuthClientSecret: a?.clientSecret ?? "",
    authOAuthAuthUrl: a?.authUrl ?? "",
    authOAuthTokenUrl: a?.tokenUrl ?? "",
    authOAuthScopes: a?.scopes ?? "",
    authAwsRegion: a?.region ?? "us-east-1",
    authAwsService: a?.service ?? "execute-api",
    authAwsAccessKeyId: a?.accessKeyId ?? "",
    authAwsSecretAccessKey: a?.secretAccessKey ?? "",
    authAwsSessionToken: a?.sessionToken ?? "",
  };
}

/** Credential fields, by auth type, that must not hold a literal value. */
const SECRET_FIELDS: Record<string, (keyof RequestSnapshot)[]> = {
  bearer: ["authBearer"],
  basic: ["authBasicPass"],
  apikey: ["authApiKeyValue"],
  oauth2: ["authOAuthClientSecret"],
  awssigv4: ["authAwsSecretAccessKey", "authAwsAccessKeyId", "authAwsSessionToken"],
};

const LABELS: Partial<Record<keyof RequestSnapshot, string>> = {
  authBearer: "Bearer token",
  authBasicPass: "Password",
  authApiKeyValue: "API key value",
  authOAuthClientSecret: "Client secret",
  authAwsSecretAccessKey: "AWS secret access key",
  authAwsAccessKeyId: "AWS access key id",
  authAwsSessionToken: "AWS session token",
};

export interface LiteralSecret {
  field: keyof RequestSnapshot;
  label: string;
  value: string;
  /** Suggested environment variable name, e.g. `API_TOKEN`. */
  suggested: string;
}

const isReference = (v: string) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v);

/**
 * Credential values that would be written to the collection file verbatim.
 * Saving those into a file the GitHub sync commits is how tokens leak, so the
 * UI offers to move them into the environment first.
 */
export function findLiteralSecrets(s: RequestSnapshot, requestName: string): LiteralSecret[] {
  const fields = SECRET_FIELDS[s.authType] ?? [];
  return fields.flatMap(field => {
    const value = String(s[field] ?? "");
    if (!value.trim() || isReference(value)) return [];
    return [{
      field,
      label: LABELS[field] ?? String(field),
      value,
      suggested: suggestVariableName(requestName, field),
    }];
  });
}

export function suggestVariableName(requestName: string, field: keyof RequestSnapshot): string {
  const suffix =
    field === "authBearer" ? "TOKEN" :
    field === "authBasicPass" ? "PASSWORD" :
    field === "authApiKeyValue" ? "API_KEY" :
    field === "authOAuthClientSecret" ? "CLIENT_SECRET" :
    field === "authAwsAccessKeyId" ? "AWS_ACCESS_KEY_ID" :
    field === "authAwsSecretAccessKey" ? "AWS_SECRET_ACCESS_KEY" :
    field === "authAwsSessionToken" ? "AWS_SESSION_TOKEN" :
    "SECRET";

  const base = requestName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

  return base ? `${base}_${suffix}` : suffix;
}
