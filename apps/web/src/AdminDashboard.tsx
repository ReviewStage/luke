import type { AdminMetricsWindow } from "@repo/features/admin-wire";
import { useAdminSignOut } from "@repo/panel/admin/admin-queries";
import type { ViewerAccount } from "@repo/panel/admin/chrome/page-header";
import { ADMINS_HIDDEN, SIDEBAR_HIDDEN, SIGN_IN_CHOSEN } from "@repo/panel/admin/prefs";
import {
  ADMIN_PAGE,
  ADMIN_TAB,
  type AdminTab,
  type AdminView,
  accountHref,
  dayHref,
  tabHref,
  viewFromLocation,
  windowFromLocation,
  windowHref,
  workspaceHref,
} from "@repo/panel/admin/routing";
import { AccountScreen } from "@repo/panel/admin/screens/account";
import { CostScreen } from "@repo/panel/admin/screens/cost";
import { DashboardScreen } from "@repo/panel/admin/screens/dashboard";
import { DayScreen } from "@repo/panel/admin/screens/day";
import { ReliabilityScreen } from "@repo/panel/admin/screens/reliability";
import { UsersScreen } from "@repo/panel/admin/screens/users";
import { WorkspaceScreen } from "@repo/panel/admin/screens/workspace";
import { WorkspacesScreen } from "@repo/panel/admin/screens/workspaces";
import { useCallback, useEffect, useState } from "react";
import { SignInCard } from "./admin/chrome/gate-cards";
import { AdminShell } from "./admin/chrome/sidebar";
import { WebAdminDoors } from "./admin/web-admin-doors";
import { authClient } from "./auth-client";

/** The standalone page: the dashboard under this page's own doors (`web-admin-doors.tsx`). */
export function AdminDashboard(): React.JSX.Element {
  return (
    <WebAdminDoors>
      <AdminDashboardPage />
    </WebAdminDoors>
  );
}

function AdminDashboardPage(): React.JSX.Element {
  // Admin accounts are the maintainers' own; their traffic reads as noise in
  // every count, so admins start hidden and the toggle is the explicit ask to
  // include them, remembered across visits. The scope is the server's filter —
  // aggregates cannot be unpicked client-side — so flipping it refetches.
  const [hideAdmins, setHideAdmins] = useState(ADMINS_HIDDEN.read);
  const changeHideAdmins = (hide: boolean) => {
    ADMINS_HIDDEN.write(hide);
    setHideAdmins(hide);
  };
  const session = authClient.useSession();
  const account = session.data?.user;

  // The address bar owns which view is open — and which window it covers — so
  // a tab, an account or workspace page, or a 90-day view can be reloaded, shared, and left
  // with the browser's own back button.
  const [view, setView] = useState<AdminView>(viewFromLocation);
  const [windowDays, setWindowDays] = useState<AdminMetricsWindow>(windowFromLocation);
  useEffect(() => {
    const onPopState = () => {
      setView(viewFromLocation());
      setWindowDays(windowFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const openAccount = useCallback((id: string) => {
    window.history.pushState(null, "", accountHref(id));
    setView({ kind: ADMIN_PAGE.ACCOUNT, id });
  }, []);
  const openWorkspace = useCallback((id: string) => {
    window.history.pushState(null, "", workspaceHref(id));
    setView({ kind: ADMIN_PAGE.WORKSPACE, id });
  }, []);
  const openDay = useCallback((day: string) => {
    window.history.pushState(null, "", dayHref(day));
    setView({ kind: ADMIN_PAGE.DAY, day });
  }, []);
  const navigate = useCallback((tab: AdminTab) => {
    window.history.pushState(null, "", tabHref(tab));
    setView({ kind: tab });
  }, []);
  const changeWindow = useCallback((next: AdminMetricsWindow) => {
    setWindowDays((current) => {
      if (next === current) return current;
      window.history.pushState(null, "", windowHref(next));
      return next;
    });
  }, []);

  const [sidebarHidden, setSidebarHidden] = useState(SIDEBAR_HIDDEN.read);
  const toggleSidebar = () => {
    setSidebarHidden((current) => {
      SIDEBAR_HIDDEN.write(!current);
      return !current;
    });
  };

  // Note that Better Auth answers a refused sign-out as a result rather than a
  // throw, so the refusal is thrown here: the session still stands, and
  // nothing past this may say it is gone. Each screen withdraws its reads
  // around it (`useAdminSignOut`).
  const signOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (error) throw new Error("The sign-out was refused.");
    SIGN_IN_CHOSEN.write(false);
  }, []);
  const withdraw = useAdminSignOut(signOut);

  // Sign out in the sidebar's foot leaves whichever view stood for the sign-in
  // card. Note that the view is unmounted rather than told, because that drops
  // its read with it: an answer that left carrying the old cookie cannot then
  // put the page back up behind the sign-out.
  const [loggedOut, setLoggedOut] = useState(false);
  const withdrawSession = withdraw.mutateAsync;
  const signOutAndLeave = useCallback(async () => {
    await withdrawSession();
    setLoggedOut(true);
  }, [withdrawSession]);

  const viewer: ViewerAccount | undefined = account
    ? { name: account.name, email: account.email, image: account.image ?? undefined }
    : undefined;

  // The gate's cards — sign-in and the non-admin refusal — stand alone on
  // every view: navigation drawn beside a consent card would pose as
  // somewhere to go. Everything past the gate wears the sidebar, which is why
  // the screens below take the shell as a frame to apply themselves, only
  // around the answers that earn it.
  const shell = (tab: AdminTab, content: React.JSX.Element) => (
    <AdminShell
      active={tab}
      hidden={sidebarHidden}
      account={viewer}
      onToggleHidden={toggleSidebar}
      onNavigate={navigate}
      onSignOut={signOutAndLeave}
    >
      {content}
    </AdminShell>
  );

  if (loggedOut) return <SignInCard />;

  if (view.kind === ADMIN_PAGE.ACCOUNT) {
    return (
      <AccountScreen
        id={view.id}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate(ADMIN_TAB.USERS)}
        onOpenWorkspace={openWorkspace}
        frame={(content) => shell(ADMIN_TAB.USERS, content)}
      />
    );
  }

  if (view.kind === ADMIN_PAGE.WORKSPACE) {
    return (
      <WorkspaceScreen
        id={view.id}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate(ADMIN_TAB.WORKSPACES)}
        onOpenAccount={openAccount}
        frame={(content) => shell(ADMIN_TAB.WORKSPACES, content)}
      />
    );
  }

  if (view.kind === ADMIN_PAGE.DAY) {
    return (
      <DayScreen
        day={view.day}
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate(ADMIN_TAB.DASHBOARD)}
        onOpenAccount={openAccount}
        frame={(content) => shell(ADMIN_TAB.DASHBOARD, content)}
      />
    );
  }

  if (view.kind === ADMIN_TAB.COST) {
    return (
      <CostScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell(ADMIN_TAB.COST, content)}
      />
    );
  }

  if (view.kind === ADMIN_TAB.RELIABILITY) {
    return (
      <ReliabilityScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell(ADMIN_TAB.RELIABILITY, content)}
      />
    );
  }

  if (view.kind === ADMIN_TAB.WORKSPACES) {
    return (
      <WorkspacesScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        onOpenWorkspace={openWorkspace}
        frame={(content) => shell(ADMIN_TAB.WORKSPACES, content)}
      />
    );
  }

  if (view.kind === ADMIN_TAB.USERS) {
    return (
      <UsersScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell(ADMIN_TAB.USERS, content)}
      />
    );
  }

  return (
    <DashboardScreen
      hideAdmins={hideAdmins}
      onHideAdminsChange={changeHideAdmins}
      windowDays={windowDays}
      onWindowDaysChange={changeWindow}
      account={viewer}
      onSignOut={signOut}
      onOpenAccount={openAccount}
      onOpenDay={openDay}
      frame={(content) => shell(ADMIN_TAB.DASHBOARD, content)}
    />
  );
}
