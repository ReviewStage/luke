/**
 * desktop-admin.tsx -- the Admin place as the app lays it out: the sidebar turns into the list of the admin's sections, with the way back at its head, and the section chosen stands beside it, as Settings and a plan's version history take the window.
 *
 * The list is the Settings list's column (`desktop.css`): the window's drag
 * strip, Back and Forward at the right of its title-bar row, Back at its head
 * (which Escape presses too, as the back button would), the place's name, and
 * a row for each section with its glyph; after them, a row that opens the web
 * page, which keeps a shareable address for every view. The call card docks
 * at its foot, as at the plans' sidebar's. It is as wide as the plans'
 * sidebar and resizes it from its own edge, but never folds, since the
 * place has no other way to its sections.
 *
 * A narrow room shows the list or the view, one at a time
 * (`hiddenColumns`): the place opens on its list, a section chosen there
 * stands alone the whole width, its toolbar led by a way back to the list.
 * A view's toolbar stands in the title bar's row, as a page's does beside
 * the plans' sidebar, rather than under a drag strip of its own, and ⌘F
 * finds in the view standing (`PageFind`). The views themselves are
 * `admin/admin-place.tsx`'s.
 */

import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BackIcon,
  commandKeyshortcuts,
  Fill,
  FoldingButton,
  GAP,
  LAYOUT_ELEMENT,
  NAV_CURRENT,
  NavItem,
  NavItemLink,
  ResizeEdge,
  SCROLL_FADE,
  ScrollArea,
  Shortcut,
  Stack,
} from "@luke/ui";
import { ExternalLinkIcon } from "lucide-react";
import { AdminPlace, adminSectionOf, adminSectionView } from "../admin/admin-place.js";
import { AdminToolbarLead } from "../admin/chrome/page-header.js";
import { ADMIN_PLACES } from "../admin/chrome/places.js";
import { ADMIN_PAGE, ADMIN_TAB, type AdminView } from "../admin/routing.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { ColumnFoot } from "../call/call-card.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import type { NavigationHistory } from "../navigation-history.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { HistoryButtons, useSidebarEdge } from "./desktop-sidebar.js";
import { useNarrowFocus } from "./narrow-focus.js";
import type { SidebarCollapse } from "./sidebar-collapse.js";

/** The place's name, at the list's head and on the way back to it in a narrow room. */
const ADMIN_TITLE = "Admin";

/** What the row that opens the web page says. */
const OPEN_IN_BROWSER = "Open in browser";

/** The sections the app lists: every section but the face's reference, which only the web page draws. */
const APP_SECTIONS = ADMIN_PLACES.filter((place) => place.tab !== ADMIN_TAB.ANIMATIONS);

/** The row that opens the web page: a link to it in a browser tab, a press the shell answers in the Mac app. */
function OpenInBrowserRow(): React.JSX.Element {
  const way = appPlatform().adminDashboard();
  return "href" in way ? (
    <NavItemLink href={way.href} icon={<ExternalLinkIcon />} newTab>
      {OPEN_IN_BROWSER}
    </NavItemLink>
  ) : (
    <NavItem icon={<ExternalLinkIcon />} onClick={way.open}>
      {OPEN_IN_BROWSER}
    </NavItem>
  );
}

/** A view by the words a find's scope is keyed by, so moving to another view closes the bar. */
function adminViewKey(view: AdminView): string {
  if (view.kind === ADMIN_PAGE.ACCOUNT) return `account:${view.id}`;
  if (view.kind === ADMIN_PAGE.DAY) return `day:${view.day}`;
  return view.kind;
}

export interface DesktopAdminProps {
  readonly sidebar: SidebarCollapse;
  readonly room: ShellRoom;
  readonly history: NavigationHistory;
  readonly view: AdminView;
  /** Whether the list stands rather than the view, which only a narrow room draws apart. */
  readonly listed: boolean;
  readonly onOpen: (view: AdminView) => void;
  /** Stands the list, from a view standing alone in a narrow room. */
  readonly onList: () => void;
  /** Leaves the place for wherever it was opened from. */
  readonly onExit: () => void;
}

export function DesktopAdmin({
  sidebar,
  room,
  history,
  view,
  listed,
  onOpen,
  onList,
  onExit,
}: DesktopAdminProps): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ADMIN, onExit);
  const edge = useSidebarEdge(sidebar);
  const hidden = hiddenColumns(room, listed);
  const screen = useNarrowFocus(room, listed);
  const current = adminSectionOf(view);
  return (
    <div ref={screen} className="desktop-admin">
      <nav className="admin-sections" aria-label="Admin sections" hidden={hidden.list}>
        <div className="desktop-drag-strip" />
        <HistoryButtons history={history} room={room} />
        <NavItem
          icon={<BackIcon />}
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.EXIT_ADMIN)}
          shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.EXIT_ADMIN].chord} />}
          onClick={onExit}
        >
          Back
        </NavItem>
        <h1 className="admin-sections-title">{ADMIN_TITLE}</h1>
        <Fill className="sidebar-section">
          <ScrollArea fade={SCROLL_FADE.BOTH}>
            <div className="sidebar-section-body">
              <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW}>
                {APP_SECTIONS.map((place) => (
                  <li key={place.tab}>
                    <NavItem
                      icon={place.icon}
                      current={place.tab === current ? NAV_CURRENT.PAGE : undefined}
                      onClick={() => onOpen(adminSectionView(place.tab))}
                    >
                      {place.label}
                    </NavItem>
                  </li>
                ))}
              </Stack>
              <hr className="sidebar-rule" />
              <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW}>
                <li>
                  <OpenInBrowserRow />
                </li>
              </Stack>
            </div>
          </ScrollArea>
        </Fill>
        <ColumnFoot />
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        {room === SHELL_ROOM.WIDE ? <ResizeEdge edge={edge} /> : null}
      </nav>
      <section className="admin-page" aria-label={ADMIN_TITLE} hidden={hidden.item}>
        {/* The view's own toolbar stands in the title bar's row, as a page's
            does beside the plans' sidebar, so no drag strip stands over it;
            a narrow room leads it with the way back to the list. */}
        <AdminToolbarLead
          value={
            room === SHELL_ROOM.NARROW ? (
              <FoldingButton label={ADMIN_TITLE} icon={<BackIcon />} onClick={onList} />
            ) : undefined
          }
        >
          {/* Each view is found in as one scope, its bar under the view's toolbar; another view closes it. */}
          <PageFind page={FIND_PAGE.ADMIN} at={adminViewKey(view)} active={!hidden.item}>
            <AdminPlace view={view} onOpen={onOpen} />
          </PageFind>
        </AdminToolbarLead>
      </section>
    </div>
  );
}
