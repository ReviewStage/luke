import type { AdminMetricsWindow } from "@luke/features/admin-wire";
import type { ViewerAccount } from "@luke/panel/admin/chrome/page-header";
import { ADMINS_HIDDEN, SIDEBAR_HIDDEN, SIGN_IN_CHOSEN } from "@luke/panel/admin/prefs";
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
} from "@luke/panel/admin/routing";
import { AccountScreen } from "@luke/panel/admin/screens/account";
import { CostScreen } from "@luke/panel/admin/screens/cost";
import { DashboardScreen, useMetricsRead } from "@luke/panel/admin/screens/dashboard";
import { DayScreen } from "@luke/panel/admin/screens/day";
import { ReliabilityScreen } from "@luke/panel/admin/screens/reliability";
import { UsersScreen } from "@luke/panel/admin/screens/users";
import { WorkspacesScreen } from "@luke/panel/admin/screens/workspaces";
import { ADMIN_READ_STATUS } from "@luke/panel/admin/use-admin-read";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "./admin/auth-client";
import { ForbiddenCard, SignInCard } from "./admin/chrome/gate-cards";
import { AdminShell } from "./admin/chrome/sidebar";
import { AnimationsScreen } from "./admin/screens/animations";
import { WebAdminDoors } from "./admin/web-admin-doors";

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
  // a tab, an account page, or a 90-day view can be reloaded, shared, and left
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

  // The dashboard's read waits while another view is open; coming back re-runs
  // it, which refreshes the numbers while the last answer stands dimmed the
  // way any refetch does.
  const metrics = useMetricsRead(hideAdmins, windowDays, view.kind === ADMIN_TAB.DASHBOARD);
  const withdrawSession = metrics.withdraw;
  // Note that Better Auth answers a refused sign-out as a result rather than a
  // throw, so the refusal is thrown here: the session still stands, and
  // nothing past this may say it is gone.
  const signOut = useCallback(
    () =>
      withdrawSession(async () => {
        const { error } = await authClient.signOut();
        if (error) throw new Error("The sign-out was refused.");
        SIGN_IN_CHOSEN.write(false);
      }),
    [withdrawSession],
  );

  // Sign out in the sidebar's foot leaves whichever view stood for the sign-in
  // card. Note that the view is unmounted rather than told, because that drops
  // its read with it: an answer that left carrying the old cookie cannot then
  // put the page back up behind the sign-out.
  const [loggedOut, setLoggedOut] = useState(false);
  const logOut = useCallback(async () => {
    await signOut();
    setLoggedOut(true);
  }, [signOut]);

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
      onLogOut={logOut}
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
        frame={(content) => shell(ADMIN_TAB.USERS, content)}
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

  if (view.kind === ADMIN_TAB.ANIMATIONS) {
    // The reference page fetches nothing, so it cannot learn the gate's
    // answers the way the data views do; it honors the refusals the overview's
    // read already holds and otherwise stands on the local sign-in press
    // alone, which the artwork — committed in the repository, observed from
    // nobody — is content with.
    if (metrics.state.status === ADMIN_READ_STATUS.SIGNED_OUT) return <SignInCard />;
    if (metrics.state.status === ADMIN_READ_STATUS.FORBIDDEN) {
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    }
    return shell(ADMIN_TAB.ANIMATIONS, <AnimationsScreen />);
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
      read={metrics}
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
