import { describe, it, expect } from "vitest";
import { buildNetworkOptions, type NetworkSettings } from "@/lib/networkOptions";

const base: NetworkSettings = {
  timeoutMs: 30000, followRedirects: true, sslVerify: true,
  useSystemProxy: false, proxyHttp: "", proxyHttpPort: "8080",
  proxyHttps: "", proxyHttpsPort: "8443", noProxy: "", proxySslVerify: true,
  clientCerts: false, clientCertPem: "", clientKeyPem: "", enableCookieJar: false,
  connectionTimeoutMs: 10000, readTimeoutMs: 30000, maxResponseSizeMb: 50,
};

const opts = (over: Partial<NetworkSettings> = {}) => buildNetworkOptions({ ...base, ...over });

describe("buildNetworkOptions", () => {
  it("composes proxy urls from host and port", () => {
    expect(opts({ proxyHttp: "http://proxy.corp", proxyHttpPort: "3128" }).proxyHttp)
      .toBe("http://proxy.corp:3128");
  });

  it("drops the manual proxy when the system proxy is on", () => {
    expect(opts({ useSystemProxy: true, proxyHttp: "http://proxy.corp" }).proxyHttp)
      .toBeUndefined();
  });

  it("omits client certs unless the toggle is on", () => {
    expect(opts({ clientCertPem: "PEM", clientKeyPem: "KEY" }).clientCertPem).toBeUndefined();
    expect(opts({ clientCerts: true, clientCertPem: "PEM" }).clientCertPem).toBe("PEM");
  });

  it("carries the cookie jar setting", () => {
    expect(opts().useCookies).toBe(false);
    expect(opts({ enableCookieJar: true }).useCookies).toBe(true);
  });

  it("converts the response cap from megabytes to bytes", () => {
    expect(opts().maxResponseBytes).toBe(52_428_800);
    expect(opts({ maxResponseSizeMb: 1 }).maxResponseBytes).toBe(1_048_576);
  });

  it("passes the connect and read timeouts through", () => {
    const o = opts({ connectionTimeoutMs: 5000, readTimeoutMs: 15000 });
    expect(o.connectTimeoutMs).toBe(5000);
    expect(o.readTimeoutMs).toBe(15000);
  });

  it("turns an empty noProxy into undefined rather than an empty string", () => {
    expect(opts().noProxy).toBeUndefined();
    expect(opts({ noProxy: "localhost" }).noProxy).toBe("localhost");
  });
});
