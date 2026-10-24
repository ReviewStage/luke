import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import type { SettingsLink, SettingsView } from "@luke/settings/settings-views";
import { TEXT_BUTTON_TONE, TextButton } from "@luke/ui";
import { createContext, useContext } from "react";
import { useLinkWorkspace } from "./copy-link-item.js";
import { settingsPageOf } from "./settings/pages.js";

/**
 * open-settings.tsx -- Open Settings from anywhere in the window: the way the window opens Settings at a place, what its press is called, and a page of it named in words as a link.
 *
 * The window's one opener (`App`'s, over `settings-link.ts`) is handed down
 * on a context, so a note deep in a task's page opens Settings at the place
 * that mends it without every surface between threading it on. Outside the
 * window, as in a test of one surface, the opener does nothing.
 *
 * Words that send the reader to a page of Settings name it by a link
 * (`SettingsPageLink`) rather than spelling a path to it, since a path
 * written out goes stale the day the page is renamed: the link says the
 * page's name as the sidebar says it now (`settings/pages.tsx`).
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

/**
 * A page of Settings named in a line of words, by the name the sidebar gives
 * it, which opens the page when pressed. Note that it is an act in the
 * window, so it is drawn in the accent rather than underlined (`TextButton`),
 * and that a right-click offers the page's own link where the surface hands
 * down the workspace its links are written under.
 */
export function SettingsPageLink({ page }: { page: SettingsView }): React.JSX.Element {
  const openSettings = useOpenSettings();
  const workspace = useLinkWorkspace();
  const href =
    workspace === undefined ? undefined : linkOf({ kind: LINK_PLACE.SETTINGS, page }, workspace);
  return (
    <TextButton
      tone={TEXT_BUTTON_TONE.ACCENT}
      linkHref={href}
      onClick={() => openSettings({ page })}
    >
      {settingsPageOf(page).title}
    </TextButton>
  );
}
