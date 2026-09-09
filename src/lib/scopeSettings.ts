import type { CollectionAuth, CollectionScripts } from "@/lib/tauri";

/**
 * Reglas del editor de herencia, separadas del componente para poder probarlas.
 *
 * La distincion que importa: "inherit" no escribe nada y deja que el nivel de
 * arriba mande; "none" escribe `type: none`, que es lo que corta la herencia a
 * proposito. En una coleccion no hay nivel superior, asi que las dos cosas se
 * escriben igual: sin campo.
 */
export type AuthChoice = "inherit" | "none" | "bearer" | "basic" | "apikey" | "oauth2";

export function choiceFromAuth(
  auth: CollectionAuth | undefined,
  isFolder: boolean,
): AuthChoice {
  if (!auth) return isFolder ? "inherit" : "none";
  switch (auth.type) {
    case "bearer":
    case "basic":
    case "apikey":
    case "oauth2":
      return auth.type;
    default:
      return "none";
  }
}

/**
 * Construye el `auth` a guardar, quedandose solo con los campos del tipo
 * elegido: arrastrar los de un tipo anterior dejaria credenciales muertas en el
 * YAML.
 */
export function buildScopeAuth(
  choice: AuthChoice,
  draft: CollectionAuth,
  isFolder: boolean,
): CollectionAuth | undefined {
  if (choice === "inherit") return undefined;
  if (choice === "none") return isFolder ? { type: "none" } : undefined;

  switch (choice) {
    case "bearer":
    case "oauth2":
      return { type: choice, token: draft.token ?? "" };
    case "basic":
      return { type: "basic", username: draft.username ?? "", password: draft.password ?? "" };
    case "apikey":
      return {
        type: "apikey",
        key: draft.key ?? "",
        value: draft.value ?? "",
        in: draft.in === "query" ? "query" : "header",
      };
  }
}

/** Un bloque vacio se omite, para no ensuciar el YAML con claves sin contenido. */
export function buildScopeScripts(
  preRequest: string,
  postResponse: string,
): CollectionScripts | undefined {
  const pre = preRequest.trim() ? preRequest : undefined;
  const post = postResponse.trim() ? postResponse : undefined;
  if (!pre && !post) return undefined;
  return { ...(pre ? { preRequest: pre } : {}), ...(post ? { postResponse: post } : {}) };
}
