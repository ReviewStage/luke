import { CHOICE_BAR_LOOK, ChoiceBar, IconButton, IconButtonLink, Tooltip } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { AdminPlaceFrame } from "../admin/chrome/page-header.js";
import { ADMIN_PLACES } from "../admin/chrome/places.js";
import {
  type AdminTab,
  type AdminView,
  adminSectionOf,
  adminSectionView,
} from "../admin/routing.js";
import { appPlatform } from "../app-platform.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";

export const ADMIN_TITLE = "Admin";

const OPEN_IN_BROWSER = "Open in browser";

const APP_SECTIONS = ADMIN_PLACES.map((place) => ({ value: place.tab, label: place.label }));

function OpenInBrowser(): React.JSX.Element {
  const way = appPlatform().adminDashboard();
  return (
    <Tooltip label={OPEN_IN_BROWSER}>
      {"href" in way ? (
        <IconButtonLink
          href={way.href}
          icon={<GLYPH.OPEN_EXTERNALLY />}
          label={OPEN_IN_BROWSER}
          newTab
        />
      ) : (
        <IconButton icon={<GLYPH.OPEN_EXTERNALLY />} label={OPEN_IN_BROWSER} onClick={way.open} />
      )}
    </Tooltip>
  );
}

export function adminFrame(
  room: ShellRoom,
  view: AdminView,
  onOpen: (view: AdminView) => void,
): AdminPlaceFrame {
  return {
    title: ADMIN_TITLE,
    sections: (
      <ChoiceBar<AdminTab>
        label="Admin sections"
        items={APP_SECTIONS}
        value={adminSectionOf(view)}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        onChange={(tab) => onOpen(adminSectionView(tab))}
      />
    ),
    acts: <OpenInBrowser />,
    phone: room === SHELL_ROOM.NARROW,
  };
}
