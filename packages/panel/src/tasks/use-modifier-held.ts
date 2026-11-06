import { useEffect, useState } from "react";

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
