function formatLeaf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function walk(segments: string[], data: unknown): string | null {
  let current: unknown = data;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (current === null || current === undefined) return null;

    if (seg === "*") {
      if (!Array.isArray(current)) return null;
      // Whatever follows the wildcard is projected over each element, so
      // `$.items[*].id` yields "1, 2" rather than the raw objects.
      const rest = segments.slice(i + 1);
      return (current as unknown[])
        .map(item => (rest.length === 0 ? formatLeaf(item) : walk(rest, item)) ?? "")
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

  return formatLeaf(current);
}

export function evaluatePath(path: string, data: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("$")) return null;

  // tokenize: $.a.b[0].c[*] → ["a", "b", "0", "c", "*"]
  const segments = path
    .slice(1)
    .split(/\.|\[|\]/)
    .filter(s => s !== "");

  return walk(segments, data);
}
