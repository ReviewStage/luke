/**
 * desktop-admin.tsx -- the Admin place as the app lays it out: the admin screens standing in the task's place beside the sidebar, as Automations does.
 *
 * Its sidebar row is marked while it stands, and it draws no way back of its
 * own: the sidebar and the window's history are how it is left, and Escape
 * closes it as it closes Automations. Its toolbar is the place's, titled
 * Admin, its sections a bar under it (`admin-frame.tsx`), and a page under a
 * section (an account's, a day's) is led back to its section by the toolbar's
 * crumb. On a phone the toolbar is a phone's header and the places bar stands
 * under a section, as under Automations' list. ⌘F finds in the view standing
 * (`PageFind`). The views themselves are `admin/admin-place.tsx`'s.
 */

import { APP_COMMAND } from "@luke/settings/shortcuts";
import { AdminPlace } from "../admin/admin-place.js";
import { AdminPlaceFrameProvider } from "../admin/chrome/page-header.js";
import { ADMIN_PAGE, type AdminView } from "../admin/routing.js";
import { useAppCommand } from "../app-commands.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import type { ShellRoom } from "../shell-room.js";
import { adminFrame } from "./admin-frame.js";

/** A view by the words a find's scope is keyed by, so moving to another view closes the bar. */
function adminViewKey(view: AdminView): string {
  if (view.kind === ADMIN_PAGE.ACCOUNT) return `account:${view.id}`;
  if (view.kind === ADMIN_PAGE.DAY) return `day:${view.day}`;
  return view.kind;
}

export interface DesktopAdminProps {
  readonly room: ShellRoom;
  readonly view: AdminView;
  /** Whether the window is on screen, which a find waits on. */
  readonly shown: boolean;
  readonly onOpen: (view: AdminView) => void;
  /** Leaves the place, giving the task's place back. */
  readonly onExit: () => void;
}

export function DesktopAdmin({
  room,
  view,
  shown,
  onOpen,
  onExit,
}: DesktopAdminProps): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ADMIN, onExit);
  return (
    <AdminPlaceFrameProvider value={adminFrame(room, view, onOpen)}>
      {/* Each view is found in as one scope, its bar under the view's toolbar; another view closes it. */}
      <PageFind page={FIND_PAGE.ADMIN} at={adminViewKey(view)} active={shown}>
        <AdminPlace view={view} onOpen={onOpen} />
      </PageFind>
    </AdminPlaceFrameProvider>
  );
}
