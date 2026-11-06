import { QueryClient } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, createElement, type ReactElement, useContext } from "react";
import { beforeEach } from "vitest";
import {
  AdminRouteLoading,
  AutomationsRouteLoading,
  BoardRouteLoading,
  PersonRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
} from "../desktop/desktop-shell.js";
import { LAZY_ROUTE } from "../panel-router.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { routeAccessNow } from "../route-gates.js";

export const SHELL_AT = {
  PLACES: "/app",
  SETTINGS: "/app/settings",
  ADMIN: "/acme/admin",
  BOARD: "/acme/tasks",
  AUTOMATIONS: "/acme/automations",
} as const;

function personAt(userId: string): string {
  return `/acme/person/${encodeURIComponent(userId)}`;
}

const ShellElement = createContext<ReactElement | null>(null);

function ShellRoot(): ReactElement | null {
  return useContext(ShellElement);
}

export interface ShellRouter {
  readonly draw: (shell: ReactElement, at?: string) => ReactElement;
  readonly under: (shell: ReactElement, standing?: string) => ReactElement;
  readonly router: AnyRouter;
  readonly go: (to: string) => void;
  readonly settled: () => Promise<void>;
}

interface StandingProps {
  readonly tab?: unknown;
  readonly tasks?: {
    readonly adminView?: { readonly open?: boolean };
    readonly boardView?: { readonly open?: boolean };
    readonly personView?: { readonly userId?: string | undefined };
    readonly automationsView?: { readonly open?: boolean };
  };
}

function standingOf(shell: ReactElement): string {
  const props: StandingProps =
    typeof shell.props === "object" && shell.props !== null ? shell.props : {};
  if (props.tab === PANEL_TAB.SETTINGS) return SHELL_AT.SETTINGS;
  if (props.tasks?.adminView?.open === true) return SHELL_AT.ADMIN;
  if (props.tasks?.boardView?.open === true) return SHELL_AT.BOARD;
  if (props.tasks?.automationsView?.open === true) return SHELL_AT.AUTOMATIONS;
  const person = props.tasks?.personView?.userId;
  return person === undefined ? SHELL_AT.PLACES : personAt(person);
}

function shellRouter(at: string = SHELL_AT.PLACES): ShellRouter {
  const root = createRootRoute({ component: ShellRoot });
  const places = createRoute({ getParentRoute: () => root, id: "places", component: ShellPlaces });
  const stateRoute = createRoute({
    getParentRoute: () => places,
    path: SHELL_AT.PLACES,
    component: StatePlace,
  });
  const admin = createRoute({
    getParentRoute: () => places,
    path: "/$workspace/admin",
    pendingComponent: AdminRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() => import("../desktop/admin-route.lazy.js").then((loaded) => loaded.adminLazyRoute));
  const board = createRoute({
    getParentRoute: () => places,
    path: "/$workspace/tasks",
    pendingComponent: BoardRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() => import("../desktop/board-route.lazy.js").then((loaded) => loaded.boardLazyRoute));
  const person = createRoute({
    getParentRoute: () => places,
    path: "/$workspace/person/$userId",
    pendingComponent: PersonRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() => import("../desktop/person-route.lazy.js").then((loaded) => loaded.personLazyRoute));
  const workspace = createRoute({ getParentRoute: () => places, path: "/$workspace" });
  const automationPages = createRoute({
    getParentRoute: () => workspace,
    id: "automation-pages",
    pendingComponent: AutomationsRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() =>
    import("../desktop/automations-route.lazy.js").then((loaded) => loaded.automationsLazyRoute),
  );
  const automations = createRoute({
    getParentRoute: () => automationPages,
    path: "automations",
  });
  const automation = createRoute({
    getParentRoute: () => automationPages,
    path: "automation/$automationId",
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: SHELL_AT.SETTINGS,
    pendingComponent: SettingsRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() =>
    import("../desktop/settings-route.lazy.js").then((loaded) => loaded.appSettingsLazyRoute),
  );
  const settingsPage = createRoute({ getParentRoute: () => settings, path: "$page" });
  const router = createRouter({
    routeTree: root.addChildren([
      places.addChildren([
        stateRoute,
        admin,
        board,
        person,
        workspace.addChildren([automationPages.addChildren([automations, automation])]),
      ]),
      settings.addChildren([settingsPage]),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { queryClient: new QueryClient(), access: routeAccessNow() },
  });
  let moving: Promise<void> = Promise.resolve();
  const go = (to: string) => {
    if (router.history.location.href !== to) moving = router.navigate({ href: to });
  };
  const draw = (shell: ReactElement, to?: string) => {
    if (to !== undefined) go(to);
    return createElement(ShellElement, { value: shell }, createElement(RouterProvider, { router }));
  };
  return {
    router,
    draw,
    under: (shell, standing) => draw(shell, standing ?? standingOf(shell)),
    go,
    settled: () => moving,
  };
}

export function shellRouterEachTest(): () => ShellRouter {
  let routed = shellRouter();
  beforeEach(async () => {
    routed = shellRouter();
    await routed.router.load();
  });
  return () => routed;
}
