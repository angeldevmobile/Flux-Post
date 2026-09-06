import { describe, it, expect } from "vitest";
import { redact, urlShape } from "@/lib/analytics";

/**
 * Estos tests son la garantía de que la telemetría no filtra nada. Flux es un
 * cliente de API: un mensaje de error suelto arrastra tokens, hostnames
 * internos y la ruta personal del usuario. Si algo de esto se rompe, se rompe
 * en silencio y hacia fuera.
 */

describe("redact", () => {
  it("borra la URL entera y conserva solo el esquema", () => {
    expect(redact("Failed to fetch https://api.acme.com/v1/users?api_key=sk_live_9f3c2a7b"))
      .toBe("Failed to fetch https://<url>");
  });

  it("cubre ws, wss y grpc además de http", () => {
    expect(redact("socket closed wss://stream.internal.corp/live")).toBe("socket closed wss://<url>");
    expect(redact("grpc://10.0.0.4:50051 unreachable")).toBe("grpc://<url> unreachable");
  });

  it("no deja el hostname interno, que identifica a la empresa", () => {
    expect(redact("connect ECONNREFUSED https://api.staging.clientex.local/health"))
      .not.toContain("clientex");
  });

  it("quita el nombre real del usuario de una ruta de Windows", () => {
    const out = redact("ENOENT: C:\\Users\\angel.zapata\\Desktop\\flux\\col.json");
    expect(out).not.toContain("angel.zapata");
    expect(out).toContain("C:\\Users\\<user>");
  });

  it("quita el nombre real del usuario de una ruta unix", () => {
    expect(redact("open /home/azapata/.flux/db failed")).toBe("open /home/<user>/.flux/db failed");
    expect(redact("open /Users/azapata/.flux/db failed")).toBe("open /home/<user>/.flux/db failed");
  });

  it("borra correos", () => {
    expect(redact("login failed for ana.ruiz@empresa.com")).toBe("login failed for <email>");
  });

  it("borra el valor que sigue a una etiqueta de credencial", () => {
    expect(redact("Authorization: Bearer abc123")).toContain("<redacted>");
    expect(redact("api_key=sk_test_short")).toContain("<redacted>");
  });

  it("borra cadenas largas sueltas, como un JWT sin etiqueta", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9aaaaaaaaaaaaaaaaaaaa";
    expect(redact(`unexpected token ${jwt}`)).toBe("unexpected token <redacted>");
  });

  it("deja legible un error que no contiene nada sensible", () => {
    expect(redact("Request timed out after 30000 ms")).toBe("Request timed out after 30000 ms");
  });

  it("corta mensajes desmedidos", () => {
    expect(redact("x".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("urlShape", () => {
  it("extrae el esquema sin el host", () => {
    expect(urlShape("https://api.acme.com/users")).toEqual({ scheme: "https", local: false });
  });

  it("detecta localhost en sus varias formas", () => {
    expect(urlShape("http://localhost:3000/api").local).toBe(true);
    expect(urlShape("http://127.0.0.1:8080").local).toBe(true);
    expect(urlShape("http://api.dev.local/v1").local).toBe(true);
  });

  it("no devuelve nada del host ni del path", () => {
    const shape = urlShape("https://api.staging.clientex.local/orders?token=abc");
    expect(JSON.stringify(shape)).not.toContain("clientex");
    expect(JSON.stringify(shape)).not.toContain("orders");
    expect(JSON.stringify(shape)).not.toContain("abc");
  });

  it("no explota con una URL inválida a medio escribir", () => {
    expect(urlShape("api.acme.com/users")).toEqual({ scheme: "unknown", local: false });
    expect(urlShape("")).toEqual({ scheme: "unknown", local: false });
  });
});
