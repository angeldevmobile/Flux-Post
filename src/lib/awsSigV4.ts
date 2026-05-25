// AWS Signature Version 4 signing using Web Crypto API (no external deps)

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toUtf8(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function isoDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateStamp(d: Date): string {
  return isoDate(d).slice(0, 8);
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
}

export interface SignedHeaders {
  [key: string]: string;
}

export async function signAwsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  creds: AwsCredentials,
): Promise<SignedHeaders> {
  const now = new Date();
  const amzDate = isoDate(now);
  const stamp = dateStamp(now);

  const parsed = new URL(url);
  const host = parsed.host;
  const path = parsed.pathname || "/";

  // Canonical query string (sorted by key)
  const queryParams = Array.from(parsed.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  // Headers to sign: host + x-amz-date + optional x-amz-security-token
  const headersToSign: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(headers)
        .map(([k, v]) => [k.toLowerCase(), v.trim()])
        .filter(([k]) => k !== "authorization")
    ),
  };
  if (creds.sessionToken) {
    headersToSign["x-amz-security-token"] = creds.sessionToken;
  }

  const signedHeaderNames = Object.keys(headersToSign).sort().join(";");
  const canonicalHeaders = Object.keys(headersToSign)
    .sort()
    .map(k => `${k}:${headersToSign[k]}`)
    .join("\n") + "\n";

  const payloadHash = await sha256Hex(body ?? "");

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    queryParams,
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");

  const credentialScope = `${stamp}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // Derive signing key
  const kDate   = await hmacSha256(toUtf8(`AWS4${creds.secretAccessKey}`), stamp);
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, creds.service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = [
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaderNames}`,
    `Signature=${signature}`,
  ].join(", ");

  const result: SignedHeaders = {
    "Authorization": authHeader,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (creds.sessionToken) result["x-amz-security-token"] = creds.sessionToken;

  return result;
}
