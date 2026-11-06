import { ADMIN_METRICS_WINDOW_DEFAULT, type AdminMetricsWindow } from "@repo/features/admin-wire";
import { useState } from "react";
import { AppAdminDoors } from "./app-admin-doors.js";
import { ADMINS_HIDDEN } from "./prefs.js";
import { ADMIN_PAGE, ADMIN_TAB, type AdminView } from "./routing.js";
import { AccountScreen } from "./screens/account.js";
import { CostScreen } from "./screens/cost.js";
import { DashboardScreen } from "./screens/dashboard.js";
import { DayScreen } from "./screens/day.js";
import { ReliabilityScreen } from "./screens/reliability.js";
import { UsersScreen } from "./screens/users.js";
import { WorkspaceScreen } from "./screens/workspace.js";
import { WorkspacesScreen } from "./screens/workspaces.js";

const unframed = (content: React.JSX.Element) => content;

const noSignOut = async () => undefined;

export interface AdminPlaceProps {
  readonly view: AdminView;
  readonly onOpen: (view: AdminView) => void;
}

export function AdminPlace(props: AdminPlaceProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col ph-no-capture">
      <AppAdminDoors>
        <AdminViews {...props} />
      </AppAdminDoors>
    </div>
  );
}

function AdminViews({ view, onOpen }: AdminPlaceProps): React.JSX.Element {
  const [hideAdmins, setHideAdmins] = useState(ADMINS_HIDDEN.read);
  const changeHideAdmins = (hide: boolean) => {
    ADMINS_HIDDEN.write(hide);
    setHideAdmins(hide);
  };
  const [windowDays, setWindowDays] = useState<AdminMetricsWindow>(ADMIN_METRICS_WINDOW_DEFAULT);
  const openAccount = (id: string) => onOpen({ kind: ADMIN_PAGE.ACCOUNT, id });
  const openWorkspace = (id: string) => onOpen({ kind: ADMIN_PAGE.WORKSPACE, id });
  const openDay = (day: string) => onOpen({ kind: ADMIN_PAGE.DAY, day });
  const shared = { account: undefined, onSignOut: noSignOut, frame: unframed };

  switch (view.kind) {
    case ADMIN_PAGE.ACCOUNT:
      return (
        <AccountScreen
          {...shared}
          id={view.id}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          onBack={() => onOpen({ kind: ADMIN_TAB.USERS })}
          onOpenWorkspace={openWorkspace}
        />
      );
    case ADMIN_PAGE.WORKSPACE:
      return (
        <WorkspaceScreen
          {...shared}
          id={view.id}
          onBack={() => onOpen({ kind: ADMIN_TAB.WORKSPACES })}
          onOpenAccount={openAccount}
        />
      );
    case ADMIN_PAGE.DAY:
      return (
        <DayScreen
          {...shared}
          day={view.day}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          onBack={() => onOpen({ kind: ADMIN_TAB.DASHBOARD })}
          onOpenAccount={openAccount}
        />
      );
    case ADMIN_TAB.COST:
      return (
        <CostScreen
          {...shared}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          onOpenAccount={openAccount}
        />
      );
    case ADMIN_TAB.RELIABILITY:
      return (
        <ReliabilityScreen
          {...shared}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          onOpenAccount={openAccount}
        />
      );
    case ADMIN_TAB.WORKSPACES:
      return (
        <WorkspacesScreen
          {...shared}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          onOpenAccount={openAccount}
          onOpenWorkspace={openWorkspace}
        />
      );
    case ADMIN_TAB.USERS:
      return (
        <UsersScreen
          {...shared}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          onOpenAccount={openAccount}
        />
      );
    default:
      return (
        <DashboardScreen
          {...shared}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          onOpenAccount={openAccount}
          onOpenDay={openDay}
        />
      );
  }
}
