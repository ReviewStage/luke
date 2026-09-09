import { useCallback, useEffect, useState } from "react";
import type { AdminMetricsWindow } from "../server/admin/http";
import { authClient } from "./admin/auth-client";
import { ForbiddenCard, SignInCard } from "./admin/chrome/cards";
import type { ViewerAccount } from "./admin/chrome/page-header";
import { AdminSidebar } from "./admin/chrome/sidebar";
import { ADMINS_HIDDEN, SIDEBAR_COLLAPSED, SIGN_IN_CHOSEN } from "./admin/prefs";
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
import { DashboardScreen, useMetricsRead } from "./admin/screens/dashboard";
import { DayScreen } from "./admin/screens/day";
import { UsersScreen } from "./admin/screens/users";

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
    if (tab === "users") setView({ kind: "users" });
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

  const [sidebarFolded, setSidebarFolded] = useState(SIDEBAR_COLLAPSED.read);
  const toggleSidebar = () => {
    setSidebarFolded((current) => {
      SIDEBAR_COLLAPSED.write(!current);
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

  const viewer: ViewerAccount | undefined = account
    ? { name: account.name, email: account.email, image: account.image ?? undefined }
    : undefined;

  // The gate's cards — sign-in and the non-admin refusal — stand alone on
  // every view: navigation drawn beside a consent card would pose as
  // somewhere to go. Everything past the gate wears the sidebar, which is why
  // the screens below take the shell as a frame to apply themselves, only
  // around the answers that earn it. The content region is a div because the
  // `main` landmark belongs to whatever stands inside it — a page's own root
  // or a centered card's — and each render path stands exactly one.
  const shell = (tab: AdminTab, content: React.JSX.Element) => (
    <div className="flex min-h-screen flex-col min-[720px]:flex-row">
      <AdminSidebar
        active={tab}
        collapsed={sidebarFolded}
        onToggle={toggleSidebar}
        onNavigate={navigate}
      />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );

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
    return shell(
      "animations",
      <AnimationsScreen account={viewer} onSignOut={() => void signOut()} />,
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
