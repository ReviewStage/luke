/**
 * admin-frame.tsx -- the Admin place's frame, which the place and what stands while its chunk loads both draw: the bar of its sections and its Open in browser.
 *
 * Admin stands in the task's place beside the sidebar, as Automations does
 * (`desktop-admin.tsx`), so its toolbar is the place's, titled Admin, and its
 * sections are a bar under it as Automations' tabs are, rather than a list
 * of their own where the sidebar stood. The frame is handed to the admin
 * screens (`AdminPlaceFrameProvider`), which head each section with it. It
 * stands outside the place's chunk (`pages-on-demand.ts`), so what the window
 * draws while that chunk loads draws through the same bar.
 */

import { CHOICE_BAR_LOOK, ChoiceBar, IconButton, IconButtonLink, Tooltip } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { AdminPlaceFrame } from "../admin/chrome/page-header.js";
import { ADMIN_PLACES } from "../admin/chrome/places.js";
import {
  ADMIN_TAB,
  type AdminTab,
  type AdminView,
  adminSectionOf,
  adminSectionView,
} from "../admin/routing.js";
import { appPlatform } from "../app-platform.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";

/** The place's name, which its sidebar row, its toolbar and the window's title all say. */
export const ADMIN_TITLE = "Admin";

/** What Open in browser says, as its hint and to a reader. */
const OPEN_IN_BROWSER = "Open in browser";

/** The sections the app offers: every section but the face's reference, which only the web page draws. */
const APP_SECTIONS = ADMIN_PLACES.filter((place) => place.tab !== ADMIN_TAB.ANIMATIONS).map(
  (place) => ({ value: place.tab, label: place.label }),
);

/** Open in browser: a link to the web page in a browser tab, a press the shell answers in the Mac app. */
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

/** The frame the place hands its screens: its name, its sections with the one `view` stands under chosen, and its acts. */
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
