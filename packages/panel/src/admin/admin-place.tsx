/**
 * admin-place.tsx -- the app's Admin place: the admin screens standing in the task's place, for an admin alone, under the app's own sidebar and history.
 *
 * The screens are the ones the web's standalone `/admin` page mounts
 * (`apps/web/src/AdminDashboard.tsx`); here they read through the window's
 * host (`app-admin-doors.tsx`) and stand in the page's column of the
 * window's own Admin layout (`desktop/desktop-admin.tsx`), whose list holds
 * the sections and whose history holds which one stands. The window and whether admins are counted
 * are the page's own choices, kept across sections, the latter across
 * launches as the web page keeps it. The service's gate decides every read:
 * the sidebar's row is only how an admin gets here.
 */

import { ADMIN_METRICS_WINDOW_DEFAULT, type AdminMetricsWindow } from "@luke/features/admin-wire";
import { useState } from "react";
import { AppAdminDoors } from "./app-admin-doors.js";
import { ADMINS_HIDDEN } from "./prefs.js";
import { ADMIN_PAGE, ADMIN_TAB, type AdminTab, type AdminView } from "./routing.js";
import { AccountScreen } from "./screens/account.js";
import { CostScreen } from "./screens/cost.js";
import { DashboardScreen, useMetricsRead } from "./screens/dashboard.js";
import { DayScreen } from "./screens/day.js";
import { ReliabilityScreen } from "./screens/reliability.js";
import { UsersScreen } from "./screens/users.js";
import { WorkspacesScreen } from "./screens/workspaces.js";

/** The view a section opens on; Animations is the web page's alone, so here it opens the Overview. */
export function adminSectionView(tab: AdminTab): AdminView {
  return { kind: tab === ADMIN_TAB.ANIMATIONS ? ADMIN_TAB.DASHBOARD : tab };
}

/** The section a view stands under: an account's page under Users, a day's under the Overview. */
export function adminSectionOf(view: AdminView): AdminTab {
  if (view.kind === ADMIN_PAGE.ACCOUNT) return ADMIN_TAB.USERS;
  if (view.kind === ADMIN_PAGE.DAY) return ADMIN_TAB.DASHBOARD;
  if (view.kind === ADMIN_TAB.ANIMATIONS) return ADMIN_TAB.DASHBOARD;
  return view.kind;
}

/** No shell of their own: the app's work column is the screens' frame. */
const unframed = (content: React.JSX.Element) => content;

/** Signing out is the app's own, which no screen here offers. */
const noSignOut = async () => undefined;

export interface AdminPlaceProps {
  readonly view: AdminView;
  /** Opens another view of the place: a section in place, an account's or a day's page as a step of the window's history. */
  readonly onOpen: (view: AdminView) => void;
}

/**
 * The Admin place's views under the app's doors: what stands in the page's
 * column beside the section list (`desktop/desktop-admin.tsx`). Every view
 * names other accounts, so the views are blocked from the screen recording
 * whole (`ph-no-capture`, `session-replay.ts`), past the masking of their
 * words, as the Inbox and Chat are.
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
  const openDay = (day: string) => onOpen({ kind: ADMIN_PAGE.DAY, day });
  // The overview's read waits while another view stands, as the web page's does.
  const metrics = useMetricsRead(hideAdmins, windowDays, view.kind === ADMIN_TAB.DASHBOARD);
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
          read={metrics}
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
