import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function methodColor(method: string): string {
  const m = method.toUpperCase();
  if (m === "GET") return "text-[var(--color-method-get)]";
  if (m === "POST") return "text-[var(--color-method-post)]";
  if (m === "PUT") return "text-[var(--color-method-put)]";
  if (m === "PATCH") return "text-[var(--color-method-patch)]";
  if (m === "DELETE") return "text-[var(--color-method-delete)]";
  return "text-[var(--color-muted-foreground)]";
}

export function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-[var(--color-method-get)]";
  if (status >= 300 && status < 400) return "text-[var(--color-method-put)]";
  if (status >= 400 && status < 500) return "text-[var(--color-method-delete)]";
  if (status >= 500) return "text-[var(--color-destructive)]";
  return "text-[var(--color-muted-foreground)]";
}
