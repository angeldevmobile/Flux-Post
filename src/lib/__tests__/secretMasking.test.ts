import { describe, it, expect } from "vitest";
import { maskSecrets } from "@/lib/secretMasking";

const TOKEN = { key: "API_KEY", value: "sk_live_9f3c2a7b" };

describe("maskSecrets", () => {
  it("reescribe un secreto de la query string", () => {
    expect(
      maskSecrets("https://api.acme.com/users?api_key=sk_live_9f3c2a7b", [TOKEN])
    ).toBe("https://api.acme.com/users?api_key={{API_KEY}}");
  });

  it("reescribe todas las apariciones, no solo la primera", () => {
    expect(
      maskSecrets("https://a.com/sk_live_9f3c2a7b?k=sk_live_9f3c2a7b", [TOKEN])
    ).toBe("https://a.com/{{API_KEY}}?k={{API_KEY}}");
  });

  it("reescribe el valor percent-encoded", () => {
    const secret = { key: "AUTH", value: "Bearer a/b+c" };
    expect(maskSecrets("https://a.com?h=Bearer%20a%2Fb%2Bc", [secret]))
      .toBe("https://a.com?h={{AUTH}}");
  });

  it("deja intacta una URL sin secretos", () => {
    const url = "https://api.acme.com/v1/users?page=2";
    expect(maskSecrets(url, [TOKEN])).toBe(url);
  });

  it("no toca valores demasiado cortos para ser secretos", () => {
    // Enmascarar "1" convertiria "/v1/users?page=1" en algo ilegible.
    const url = "https://api.acme.com/v1/users?page=1";
    expect(maskSecrets(url, [{ key: "N", value: "1" }])).toBe(url);
  });

  it("sustituye el secreto largo cuando otro es subcadena suya", () => {
    const long = { key: "LONG", value: "abcd1234efgh" };
    const short = { key: "SHORT", value: "abcd" };
    // Sin ordenar por longitud, SHORT partiria LONG y este ya no coincidiria.
    expect(maskSecrets("https://a.com?t=abcd1234efgh", [short, long]))
      .toBe("https://a.com?t={{LONG}}");
  });

  it("ignora secretos sin valor y textos vacios", () => {
    expect(maskSecrets("", [TOKEN])).toBe("");
    expect(maskSecrets("https://a.com", [{ key: "EMPTY", value: "" }]))
      .toBe("https://a.com");
  });

  it("enmascara aunque el secreto vaya en el path", () => {
    expect(maskSecrets("https://a.com/sk_live_9f3c2a7b/info", [TOKEN]))
      .toBe("https://a.com/{{API_KEY}}/info");
  });
});
