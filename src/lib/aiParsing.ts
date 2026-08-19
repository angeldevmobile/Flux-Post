/**
 * Los modelos envuelven la salida en fences de markdown a menudo, y los mas
 * pequenos mas todavia. El prompt pide que no lo hagan, pero pedirlo no basta:
 * hay que tolerarlo al leer.
 */

/** Quita fences ```lang ... ``` y espacios sobrantes. */
export function stripFences(raw: string): string {
  const t = raw.trim();
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(t);
  return (fenced ? fenced[1] : t).trim();
}

/** Recorta al primer objeto JSON del texto, saltandose fences o prosa. */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/** Parsea JSON tolerando fences y texto alrededor. `null` si no hay nada valido. */
export function parseJsonLoose<T>(raw: string): T | null {
  const attempts = [raw.trim(), stripFences(raw), extractJsonObject(raw)];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // siguiente intento
    }
  }
  return null;
}
