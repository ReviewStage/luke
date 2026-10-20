import type { AdminMetricsWindow } from "@luke/service/admin/http";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "./admin/auth-client";
import { ForbiddenCard, SignInCard } from "./admin/chrome/cards";
import type { ViewerAccount } from "./admin/chrome/page-header";
import { AdminShell } from "./admin/chrome/sidebar";
import { ADMINS_HIDDEN, SIDEBAR_HIDDEN, SIGN_IN_CHOSEN } from "./admin/prefs";
import {
  type AdminTab,
  type AdminView,
  accountHref,
  dayHref,
  tabHref,
  viewFromLocation,
  windowFromLocation,
  windowHref,
} from "./admin/routing";
import { AccountScreen } from "./admin/screens/account";
import { AnimationsScreen } from "./admin/screens/animations";
import { CostScreen } from "./admin/screens/cost";
import { DashboardScreen, useMetricsRead } from "./admin/screens/dashboard";
import { DayScreen } from "./admin/screens/day";
import { ReliabilityScreen } from "./admin/screens/reliability";
import { UsersScreen } from "./admin/screens/users";
import { WorkspacesScreen } from "./admin/screens/workspaces";

export function AdminDashboard(): React.JSX.Element {
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
    setView({ kind: "account", id });
  }, []);
  const openDay = useCallback((day: string) => {
    window.history.pushState(null, "", dayHref(day));
    setView({ kind: "day", day });
  }, []);
  const navigate = useCallback((tab: AdminTab) => {
    window.history.pushState(null, "", tabHref(tab));
    if (tab === "cost") setView({ kind: "cost" });
    else if (tab === "reliability") setView({ kind: "reliability" });
    else if (tab === "workspaces") setView({ kind: "workspaces" });
    else if (tab === "users") setView({ kind: "users" });
    else if (tab === "animations") setView({ kind: "animations" });
    else setView({ kind: "dashboard" });
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
  const metrics = useMetricsRead(hideAdmins, windowDays, view.kind === "dashboard");
  const withdrawSession = metrics.withdraw;
  const signOut = useCallback(
    () =>
      withdrawSession(async () => {
        await authClient.signOut();
        SIGN_IN_CHOSEN.write(false);
      }),
    [withdrawSession],
  );

  // Log out in the sidebar's foot leaves whichever view stood for the sign-in
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

  if (view.kind === "account") {
    return (
      <AccountScreen
        id={view.id}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate("users")}
        frame={(content) => shell("users", content)}
      />
    );
  }

  if (view.kind === "day") {
    return (
      <DayScreen
        day={view.day}
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate("dashboard")}
        onOpenAccount={openAccount}
        frame={(content) => shell("dashboard", content)}
      />
    );
  }

  if (view.kind === "animations") {
    // The reference page fetches nothing, so it cannot learn the gate's
    // answers the way the data views do; it honors the refusals the overview's
    // read already holds and otherwise stands on the local sign-in press
    // alone, which the artwork — committed in the repository, observed from
    // nobody — is content with.
    if (metrics.state.status === "signed-out") return <SignInCard />;
    if (metrics.state.status === "forbidden") {
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    }
    return shell("animations", <AnimationsScreen />);
  }

  if (view.kind === "cost") {
    return (
      <CostScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell("cost", content)}
      />
    );
  }

  if (view.kind === "reliability") {
    return (
      <ReliabilityScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell("reliability", content)}
      />
    );
  }

  if (view.kind === "workspaces") {
    return (
      <WorkspacesScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell("workspaces", content)}
      />
    );
  }

  if (view.kind === "users") {
    return (
      <UsersScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell("users", content)}
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
      frame={(content) => shell("dashboard", content)}
    />
  );
}
