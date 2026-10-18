/**
 * use-window-focused.ts -- whether this Luke window has the keyboard, which decides whether it draws the call card.
 */

import { useEffect, useState } from "react";

/**
 * Whether the window is the one the developer is using. While it is not
 * (another app in front, or Luke minimised or hidden) the floating window
 * draws the call instead, so the two never show the call at once.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return focused;
}
