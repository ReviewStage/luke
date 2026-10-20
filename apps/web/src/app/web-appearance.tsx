/**
 * web-appearance.tsx -- the tab drawn in the account's Theme setting, as the desktop's windows are: its root wearing the theme the setting resolves to, following the machine under System, and the browser's chrome in the same ground.
 *
 * The setting is the desktop's own (`APP_SETTING_SCHEMA.theme`), kept, as
 * it is on a Mac, in this device's settings store rather than the account's,
 * which in a tab is the browser's storage (`local-storage-file-system.ts`).
 * It arrives on the panel's state, so a change made in Settings, or in
 * another tab of this origin, is worn as it lands. The site's palette keeps
 * a theme for dark and one for light and none that follows the machine
 * (`@luke/ui`'s `palettes.css`), so the root wears System resolved, and wears
 * it again each time the machine's appearance flips.
 *
 * The choice is also written where `public/app-theme.js` reads it as the page
 * loads, before the stylesheet paints anything, so a reload in the dark is
 * dark from its first frame rather than light until the state is read.
 */

import { useAppState } from "@luke/panel/use-app-state";
import { appSettingsView } from "@luke/settings/wire";
import type { Theme } from "@luke/ui";
import { wearTheme } from "@luke/ui/appearance";
import { useLayoutEffect } from "react";
import { THEME_KEY, tintChrome } from "../theme-chrome";

/** Keeps the choice for the next load; a storage the browser refuses keeps none, and that load starts as the page's default. */
function keepChoice(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Note that a refused write costs the next load its first frame and nothing else.
  }
}

/**
 * Wears `theme` on the document's root, the chrome tinted to match each time
 * it is worn, and keeps it for the next load; answers what stops following
 * the machine under System.
 */
function wearAccountTheme(theme: Theme, root = document.documentElement): () => void {
  keepChoice(theme);
  return wearTheme(root, theme, () => tintChrome(root));
}

/** Draws nothing: wears the account's Theme setting on the tab's root for as long as the app is drawn. */
export function WebAppearance(): null {
  const settings = useAppState()?.settings;
  const theme = settings === undefined ? undefined : appSettingsView(settings).theme;
  useLayoutEffect(() => (theme === undefined ? undefined : wearAccountTheme(theme)), [theme]);
  return null;
}
