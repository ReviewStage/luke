import { useEffect, useState } from "react";

/**
 * use-modifier-held.ts -- whether ⌘ (Ctrl elsewhere) is held down while `watching`, which an agent's Send reads to say what Enter will do with it held.
 *
 * Heard at the window, so a press anywhere counts, and let go as the
 * window loses focus, since a key released elsewhere is never heard.
 */
export function useModifierHeld(watching: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!watching) return undefined;
    const heard = (event: KeyboardEvent) => setHeld(event.metaKey || event.ctrlKey);
    const lost = () => setHeld(false);
    window.addEventListener("keydown", heard);
    window.addEventListener("keyup", heard);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keydown", heard);
      window.removeEventListener("keyup", heard);
      window.removeEventListener("blur", lost);
      setHeld(false);
    };
  }, [watching]);
  return watching && held;
}
