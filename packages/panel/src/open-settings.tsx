import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import type { SettingsLink, SettingsView } from "@repo/settings/settings-views";
import { TEXT_BUTTON_TONE, TextButton } from "@repo/ui";
import { createContext, useContext } from "react";
import { useLinkWorkspace } from "./copy-link-item.js";
import { settingsPageOf } from "./settings/pages.js";

export const OPEN_SETTINGS_LABEL = "Open Settings";

const OpenSettingsContext = createContext<(link: SettingsLink) => void>(() => undefined);

export const OpenSettingsProvider = OpenSettingsContext.Provider;

export function useOpenSettings(): (link: SettingsLink) => void {
  return useContext(OpenSettingsContext);
}

export function SettingsPageLink({
  page,
  onLeave,
}: {
  page: SettingsView;
  onLeave?: (() => void) | undefined;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const workspace = useLinkWorkspace();
  const href =
    workspace === undefined ? undefined : linkOf({ kind: LINK_PLACE.SETTINGS, page }, workspace);
  return (
    <TextButton
      tone={TEXT_BUTTON_TONE.ACCENT}
      linkHref={href}
      onClick={() => {
        onLeave?.();
        openSettings({ page });
      }}
    >
      {settingsPageOf(page).title}
    </TextButton>
  );
}
