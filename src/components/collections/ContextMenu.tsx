import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Menu de clic derecho de la barra lateral.
 *
 * Se posiciona en el cursor y se recoloca si no cabe, para que un elemento
 * cerca del borde inferior no deje el menu fuera de la ventana.
 */

export interface MenuItem {
  label: string;
  onClick: () => void;
  /** Rojo y separado del resto. */
  danger?: boolean;
  /** Linea de separacion encima. */
  separated?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const WIDTH = 190;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - h - 4)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // `capture` para cerrarlo antes de que el clic llegue a lo que hay debajo.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("contextmenu", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("contextmenu", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] rounded-lg py-1 flex flex-col"
      style={{
        left: pos.left,
        top: pos.top,
        minWidth: WIDTH,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 8px 24px #00000060",
      }}
    >
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onClick();
          }}
          className="flex items-center px-3 py-1.5 text-[11px] text-left w-full transition-colors disabled:opacity-40"
          style={{
            color: item.danger ? "#EF4444" : "var(--color-fg-2)",
            borderTop: item.separated ? "1px solid var(--color-border)" : undefined,
            marginTop: item.separated ? 4 : undefined,
            paddingTop: item.separated ? 8 : undefined,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = "var(--color-border)";
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
