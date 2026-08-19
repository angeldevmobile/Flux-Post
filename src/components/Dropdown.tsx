import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

interface Props {
  /** Lo que se ve en el botón cerrado. */
  label: ReactNode;
  width?: number;
  buttonStyle?: CSSProperties;
  /** Recibe `close` para que cada opción pueda cerrar el menú al elegirse. */
  children: (close: () => void) => ReactNode;
}

/**
 * Menú desplegable que se renderiza en un portal.
 *
 * Las tarjetas de Settings llevan `overflow-hidden` para redondear las esquinas,
 * y eso recortaba cualquier menú posicionado dentro de ellas. Abrirlo hacia
 * arriba solo movía el problema a las filas de arriba del todo.
 */
export function Dropdown({ label, width = 180, buttonStyle, children }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const btn = btnRef.current?.getBoundingClientRect();
      if (!btn) return;
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = btn.bottom + 4;
      // Si no cabe debajo, se coloca encima del botón.
      const top = below + height > window.innerHeight - 8 ? btn.top - height - 4 : below;
      setPos({ top: Math.max(8, top), left: btn.right - width });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 rounded-md"
        style={{
          height: 32, minWidth: width,
          background: "var(--color-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-fg)",
          ...buttonStyle,
        }}>
        <span className="flex-1 text-left text-[12px]">{label}</span>
        <ChevronDown size={13} style={{ color: "var(--color-fg-3)" }} className="shrink-0" />
      </button>

      {open && createPortal(
        <div ref={menuRef}
          className="fixed z-[200] rounded-lg overflow-hidden"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width,
            visibility: pos ? "visible" : "hidden",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 24px #00000060",
          }}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}
