import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const DARK_VARS: Record<string, string> = {
  "--color-bg":       "#0A0A0A",
  "--color-topbar":   "#111111",
  "--color-sidebar":  "#0F0F0F",
  "--color-card":     "#1A1A1A",
  "--color-border":   "#27272A",
  "--color-input":    "#141414",
  "--color-elevated": "#0D0D0D",
  "--color-fg":       "#FFFFFF",
  "--color-fg-2":     "#A1A1AA",
  "--color-fg-3":     "#71717A",
  "--color-fg-4":     "#52525B",
};

const LIGHT_VARS: Record<string, string> = {
  "--color-bg":       "#F5F5F5",
  "--color-topbar":   "#FFFFFF",
  "--color-sidebar":  "#EBEBEB",
  "--color-card":     "#E0E0E0",
  "--color-border":   "#D1D1D6",
  "--color-input":    "#F9F9F9",
  "--color-elevated": "#FAFAFA",
  "--color-fg":       "#09090B",
  "--color-fg-2":     "#3F3F46",
  "--color-fg-3":     "#71717A",
  "--color-fg-4":     "#A1A1AA",
};

export function useAppearance() {
  const { theme, accentColor, uiFontSize, compactMode, animations } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    const { r, g, b } = hexToRgb(accentColor);
    root.style.setProperty("--color-accent", accentColor);
    root.style.setProperty("--color-accent-10", `rgba(${r},${g},${b},0.06)`);
    root.style.setProperty("--color-accent-20", `rgba(${r},${g},${b},0.13)`);
    root.style.setProperty("--color-accent-50", `rgba(${r},${g},${b},0.5)`);
  }, [accentColor]);

  // El estilo inline gana sobre `html.compact body`, así que el tamaño se
  // resuelve aquí en vez de en CSS: si no, el modo compacto no hacía nada.
  useEffect(() => {
    document.body.style.fontSize = `${compactMode ? 12 : uiFontSize}px`;
  }, [uiFontSize, compactMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("compact", compactMode);
  }, [compactMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-animations", !animations);
  }, [animations]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function apply() {
      const root = document.documentElement;
      const resolved = theme === "system"
        ? (media.matches ? "dark" : "light")
        : theme;

      const vars = resolved === "light" ? LIGHT_VARS : DARK_VARS;
      for (const [key, val] of Object.entries(vars)) {
        root.style.setProperty(key, val);
      }
      root.setAttribute("data-theme", resolved);
      document.body.style.background = vars["--color-bg"];
      document.body.style.color = vars["--color-fg"];
    }

    apply();
    // Con el tema en "system", seguir al sistema operativo en vivo en vez de
    // quedarse con lo que hubiera al arrancar.
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
