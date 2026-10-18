import type { SettingsLink } from "@luke/settings/settings-views";
import { createContext, useContext } from "react";

/**
 * open-settings.tsx -- Open Settings from anywhere in the window: the way the window opens Settings at a place, and what its press is called.
 *
 * The window's one opener (`App`'s, over `settings-link.ts`) is handed down
 * on a context, so a note deep in a task's page opens Settings at the place
 * that mends it without every surface between threading it on. Outside the
 * window, as in a test of one surface, the opener does nothing.
 */

/** The words of every button that opens Settings at a place. */
export const OPEN_SETTINGS_LABEL = "Open Settings";

const OpenSettingsContext = createContext<(link: SettingsLink) => void>(() => undefined);

/** Hands the window's opener to everything under it. */
export const OpenSettingsProvider = OpenSettingsContext.Provider;

/** The window's way to open Settings at a place. */
export function useOpenSettings(): (link: SettingsLink) => void {
  return useContext(OpenSettingsContext);
}
