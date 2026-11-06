import { THEME, type Theme } from "@repo/ui";
import { wearTheme } from "@repo/ui/appearance";
import { THEME_KEY, tintChrome } from "../theme-chrome";

function storedTheme(): Theme {
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(THEME_KEY);
  } catch {}
  return kept === THEME.LIGHT || kept === THEME.DARK ? kept : THEME.SYSTEM;
}

export function followAppTheme(root: HTMLElement = document.documentElement): () => void {
  let stopWearing = wearTheme(root, storedTheme(), () => tintChrome(root));
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== THEME_KEY) return;
    stopWearing();
    stopWearing = wearTheme(root, storedTheme(), () => tintChrome(root));
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    stopWearing();
  };
}
