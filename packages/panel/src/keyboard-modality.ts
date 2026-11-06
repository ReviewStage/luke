import { useEffect } from "react";

export function useKeyboardModality(): void {
  useEffect(() => {
    const root = document.documentElement;
    const keyboardMoved = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) root.dataset.keyboard = "true";
    };
    const pointerUsed = () => {
      delete root.dataset.keyboard;
    };
    window.addEventListener("keydown", keyboardMoved, true);
    window.addEventListener("pointerdown", pointerUsed, true);
    return () => {
      window.removeEventListener("keydown", keyboardMoved, true);
      window.removeEventListener("pointerdown", pointerUsed, true);
    };
  }, []);
}
