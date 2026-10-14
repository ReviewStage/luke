import { createContext, useContext } from "react";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "./settings-views";

/**
 * open-settings.tsx -- Open Settings from anywhere in the window: the way the window opens Settings at a place, and the button that does.
 *
 * The window's one opener (`App`'s, over `settings-link.ts`) is handed down
 * on a context, so a note deep in a plan's page opens Settings at the place
 * that mends it without every surface between threading it on. Outside the
 * window, as in a test of one surface, the opener does nothing.
 */

/** Where a note about the account's own GitHub not being connected leads: the account's connected accounts. */
export const CONNECTED_ACCOUNTS_LINK: SettingsLink = {
  page: SETTINGS_VIEW.ROOT,
  section: SETTINGS_SECTION.CONNECTED_ACCOUNTS,
};

/** The words of every button that opens Settings at a place. */
export const OPEN_SETTINGS_LABEL = "Open Settings";

const OpenSettingsContext = createContext<(link: SettingsLink) => void>(() => undefined);

/** Hands the window's opener to everything under it. */
export const OpenSettingsProvider = OpenSettingsContext.Provider;

/** The window's way to open Settings at a place. */
export function useOpenSettings(): (link: SettingsLink) => void {
  return useContext(OpenSettingsContext);
}

/** A note's Open Settings: Settings at the place the link names. */
export function OpenSettingsButton({
  link,
  className = "toolbar-button bordered-button",
}: {
  link: SettingsLink;
  className?: string;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  return (
    <button type="button" className={className} onClick={() => openSettings(link)}>
      {OPEN_SETTINGS_LABEL}
    </button>
  );
}
