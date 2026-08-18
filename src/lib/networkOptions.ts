import { useSettingsStore } from "@/stores/settings";
import type { HttpRequest } from "@/lib/tauri";

export type NetworkOptions = Pick<
  HttpRequest,
  | "timeoutMs" | "followRedirects" | "sslVerify"
  | "proxyHttp" | "proxyHttps" | "noProxy" | "proxySslVerify"
  | "clientCertPem" | "clientKeyPem" | "useCookies"
  | "connectTimeoutMs" | "readTimeoutMs" | "maxResponseBytes"
>;

export interface NetworkSettings {
  timeoutMs: number;
  followRedirects: boolean;
  sslVerify: boolean;
  useSystemProxy: boolean;
  proxyHttp: string;
  proxyHttpPort: string;
  proxyHttps: string;
  proxyHttpsPort: string;
  noProxy: string;
  proxySslVerify: boolean;
  clientCerts: boolean;
  clientCertPem: string;
  clientKeyPem: string;
  enableCookieJar: boolean;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
  maxResponseSizeMb: number;
}

/**
 * Ajustes de red que aplican a toda request, venga del panel, de una colección,
 * de la pantalla de Tests o de Compare. Vive en un solo sitio porque antes cada
 * pantalla armaba los suyos y solo el panel principal los pasaba todos.
 */
export function buildNetworkOptions(s: NetworkSettings): NetworkOptions {
  return {
    timeoutMs: s.timeoutMs,
    followRedirects: s.followRedirects,
    sslVerify: s.sslVerify,
    proxyHttp: !s.useSystemProxy && s.proxyHttp ? `${s.proxyHttp}:${s.proxyHttpPort}` : undefined,
    proxyHttps: !s.useSystemProxy && s.proxyHttps ? `${s.proxyHttps}:${s.proxyHttpsPort}` : undefined,
    noProxy: s.noProxy || undefined,
    proxySslVerify: s.proxySslVerify,
    clientCertPem: s.clientCerts && s.clientCertPem ? s.clientCertPem : undefined,
    clientKeyPem: s.clientCerts && s.clientKeyPem ? s.clientKeyPem : undefined,
    useCookies: s.enableCookieJar,
    connectTimeoutMs: s.connectionTimeoutMs,
    readTimeoutMs: s.readTimeoutMs,
    maxResponseBytes: s.maxResponseSizeMb * 1_048_576,
  };
}

export function networkOptions(): NetworkOptions {
  return buildNetworkOptions(useSettingsStore.getState());
}
