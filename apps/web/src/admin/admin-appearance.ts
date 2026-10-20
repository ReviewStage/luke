/**
 * admin-appearance.ts -- the admin dashboard drawn in the theme the app keeps, as the app's tab is: the choice the account made in the app's Theme setting, read from the same key (`luke.theme`, which the two share an origin to read), worn on the root and the browser's chrome, and followed as it changes.
 *
 * The admin runs no panel state, so it has no setting to read; the app writes
 * the choice to this browser's storage as it wears it (`app/web-appearance.tsx`),
 * and a change made in another tab of this origin arrives here as a `storage`
 * event. Under System, or with no choice kept, the machine's appearance is
 * worn, and worn again each time it flips (`@luke/ui/appearance`'s `wearTheme`).
 * `public/app-theme.js` does the same before the first frame.
 */

import { THEME, type Theme } from "@luke/ui";
import { wearTheme } from "@luke/ui/appearance";
import { THEME_KEY, tintChrome } from "../theme-chrome";

/** The theme the browser keeps for the app, a missing, refused, or unknown one following the machine. */
function storedTheme(): Theme {
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(THEME_KEY);
  } catch {
    // A storage the browser refuses keeps no choice, so the machine's stands.
  }
  return kept === THEME.LIGHT || kept === THEME.DARK ? kept : THEME.SYSTEM;
}

/**
 * Wears the app's theme on the document's root and keeps wearing it as the
 * choice or the machine changes; answers what stops it.
 */
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
