import { APP_COMMAND } from "@repo/settings/shortcuts";
import { AdminPlace } from "../admin/admin-place.js";
import { AdminPlaceFrameProvider } from "../admin/chrome/page-header.js";
import { ADMIN_PAGE, type AdminView } from "../admin/routing.js";
import { useAppCommand } from "../app-commands.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import type { ShellRoom } from "../shell-room.js";
import { adminFrame } from "./admin-frame.js";

function adminViewKey(view: AdminView): string {
  if (view.kind === ADMIN_PAGE.ACCOUNT) return `account:${view.id}`;
  if (view.kind === ADMIN_PAGE.WORKSPACE) return `workspace:${view.id}`;
  if (view.kind === ADMIN_PAGE.DAY) return `day:${view.day}`;
  return view.kind;
}

export interface DesktopAdminProps {
  readonly room: ShellRoom;
  readonly view: AdminView;
  readonly shown: boolean;
  readonly onOpen: (view: AdminView) => void;
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
      <PageFind page={FIND_PAGE.ADMIN} at={adminViewKey(view)} active={shown}>
        <AdminPlace view={view} onOpen={onOpen} />
      </PageFind>
    </AdminPlaceFrameProvider>
  );
}
