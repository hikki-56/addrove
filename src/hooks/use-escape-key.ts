import { useEffect } from "react";

/**
 * Close modals / drawers with the Escape key.
 * WCAG 2.1.1 (A) — Keyboard
 *
 * @param active  Whether the modal/drawer is currently open
 * @param onClose Callback to close it
 */
export function useEscapeKey(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
