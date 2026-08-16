import type { HttpMethod } from "@/lib/tauri";

// Single list of selectable methods — the pickers all read from here.
// QUERY is RFC 10008: safe and cacheable like GET, but carries a body.
export const HTTP_METHODS: HttpMethod[] = [
  "GET", "POST", "QUERY", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
];

export const METHOD_COLOR: Record<string, string> = {
  GET:     "#3B82F6",
  POST:    "#22C55E",
  QUERY:   "#06B6D4",
  PUT:     "#F59E0B",
  PATCH:   "#F59E0B",
  DELETE:  "#EF4444",
  HEAD:    "#71717A",
  OPTIONS: "#71717A",
  GRPC:    "#A855F7",
};

export function methodColor(m: string) {
  return METHOD_COLOR[m.toUpperCase()] ?? "#71717A";
}

export function methodBg(m: string) {
  return `${methodColor(m)}20`;
}
