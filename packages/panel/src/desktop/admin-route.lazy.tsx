/**
 * admin-route.lazy.tsx -- Admin as its route draws it once its chunk lands, split off the bundle every window parses since it carries the screens' charts, which an account that is no admin never reads.
 *
 * While the account's access is still read, as a reloaded Admin address's
 * is, the place's own frame stands, as it does while the chunk loads
 * (`AdminRouteLoading`).
 */

import { createLazyRoute } from "@tanstack/react-router";
import { DesktopAdmin } from "./desktop-admin.js";
import { AdminRouteLoading, useShellPlaces } from "./desktop-shell.js";

/** The admin screens in the task's place beside the sidebar. */
function AdminRoutePlace(): React.JSX.Element {
  const { tasks, room, adminAccess } = useShellPlaces();
  if (!adminAccess) return <AdminRouteLoading />;
  return (
    <DesktopAdmin
      room={room}
      view={tasks.adminView.view}
      shown={tasks.shown}
      onOpen={tasks.adminView.onOpen}
      onExit={tasks.adminView.onClose}
    />
  );
}

export const adminLazyRoute = createLazyRoute("/places/$workspace/admin")({
  component: AdminRoutePlace,
});
