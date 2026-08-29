/**
 * Reescribe como `{{VAR}}` los valores secretos que hayan quedado literales en
 * un texto.
 *
 * El historial guarda la URL ya interpolada: `resolveVariable` corre antes de
 * enviar, asi que una request con `?api_key={{API_KEY}}` acababa escribiendo el
 * valor literal en SQLite y, con el sync activo, en `flux_history.url`.
 * Enmascarado en el panel de entornos y en claro en la tabla.
 *
 * Efecto secundario deseable: al pulsar una entrada del historial se carga la
 * URL en la barra de direcciones, y ahora vuelve con la variable en vez de con
 * un secreto caducado, asi que el reenvio resuelve el valor vigente.
 */

export interface Secret {
  key: string;
  value: string;
}

/**
 * Por debajo de esta longitud no se enmascara. Un valor de uno o dos caracteres
 * aparece por toda una URL normal, y sustituirlo dejaria el historial ilegible
 * sin proteger nada que fuese de verdad un secreto.
 */
const MIN_SECRET_LENGTH = 4;

/** Segun donde caiga, el valor puede aparecer tal cual o percent-encoded. */
function variantsOf(value: string): string[] {
  const encoded = encodeURIComponent(value);
  return encoded === value ? [value] : [value, encoded];
}

export function maskSecrets(text: string, secrets: Secret[]): string {
  if (!text) return text;

  // De mas largo a mas corto: si un secreto es subcadena de otro, sustituir
  // primero el corto partiria el largo por la mitad y ya no coincidiria.
  const ordered = secrets
    .filter((s) => s.value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.value.length - a.value.length);

  let out = text;
  for (const { key, value } of ordered) {
    for (const variant of variantsOf(value)) {
      // split/join en vez de replaceAll: el lib de TS es ES2020.
      out = out.split(variant).join(`{{${key}}}`);
    }
  }
  return out;
}
