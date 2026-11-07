/**
 * admin-place.tsx -- the app's Admin place: the admin screens standing in the task's place, for an admin alone, under the app's own sidebar and history.
 *
 * The screens are the ones the web's standalone `/admin` page mounts
 * (`apps/web/src/AdminDashboard.tsx`); here they read through the window's
 * host (`app-admin-doors.tsx`) and stand in the window's work column beside
 * its sidebar (`desktop/desktop-admin.tsx`), under a bar of the sections,
 * the window's history holding which one stands. The window and whether admins are counted
 * are the page's own choices, kept across sections, the latter across
 * launches as the web page keeps it. The service's gate decides every read:
 * the sidebar's row is only how an admin gets here.
 */

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

/** No shell of their own: the app's work column is the screens' frame. */
const unframed = (content: React.JSX.Element) => content;

/** Signing out is the app's own, which no screen here offers. */
const noSignOut = async () => undefined;

export interface AdminPlaceProps {
  readonly view: AdminView;
  /** Opens another view of the place: a section in place, an account's, a workspace's, or a day's page as a step of the window's history. */
  readonly onOpen: (view: AdminView) => void;
}

/**
 * The Admin place's views under the app's doors: what stands in the
 * window's work column (`desktop/desktop-admin.tsx`). Every view
 * names other accounts, so the views are blocked from the screen recording
 * whole (`ph-no-capture`, `session-replay.ts`), past the masking of their
 * words, as the Inbox is.
 */
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
