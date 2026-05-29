export function evaluatePath(path: string, data: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("$")) return null;

  // tokenize: $.a.b[0].c[*] → ["a", "b", "0", "c", "*"]
  const segments = path
    .slice(1)
    .split(/\.|\[|\]/)
    .filter(s => s !== "");

  let current: unknown = data;

  for (const seg of segments) {
    if (current === null || current === undefined) return null;

    if (seg === "*") {
      if (!Array.isArray(current)) return null;
      return (current as unknown[])
        .map(item => item === null || item === undefined ? "" : typeof item === "object" ? JSON.stringify(item) : String(item))
        .join(", ");
    }

    const idx = Number(seg);
    if (!isNaN(idx) && Array.isArray(current)) {
      current = (current as unknown[])[idx];
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }

  if (current === null || current === undefined) return null;
  if (typeof current === "object") return JSON.stringify(current);
  return String(current);
}
