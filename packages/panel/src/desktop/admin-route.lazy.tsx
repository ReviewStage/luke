import { createLazyRoute } from "@tanstack/react-router";
import { DesktopAdmin } from "./desktop-admin.js";
import { AdminRouteLoading, useShellPlaces } from "./desktop-shell.js";

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
