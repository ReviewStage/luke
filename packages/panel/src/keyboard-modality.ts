/**
 * keyboard-modality.ts -- whether focus last moved by the keyboard, tracked outright rather than guessed.
 */

import { useEffect } from "react";

/**
 * `:focus-visible` is a heuristic about how focus arrived, and in a window
 * Luke focuses programmatically it guesses wrong: the engine can read the
 * window taking focus as keyboard modality and ring a control after a plain
 * press, most reliably the first time the window is ever focused. Modality
 * is tracked outright instead, on the root as `data-keyboard`, so a ring or
 * a keyboard-only hint is drawn only once someone has actually moved focus
 * with the keyboard. Each window's root mounts it once.
 */
export function useKeyboardModality(): void {
  useEffect(() => {
    const root = document.documentElement;
    const keyboardMoved = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) root.dataset.keyboard = "true";
    };
    const pointerUsed = () => {
      delete root.dataset.keyboard;
    };
    // Capture: the flag has to be right before anything reacts to the event.
    window.addEventListener("keydown", keyboardMoved, true);
    window.addEventListener("pointerdown", pointerUsed, true);
    return () => {
      window.removeEventListener("keydown", keyboardMoved, true);
      window.removeEventListener("pointerdown", pointerUsed, true);
    };
  }, []);
}
