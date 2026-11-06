/**
 * shell-router.ts -- the window's shell in a test, drawn under a router with the props the test hands it; `panel-router.test.ts` holds the production route tree, which this is not.
 *
 * The shell draws what stands past its gates through the router's `Outlet`
 * (`desktop-shell.tsx`), so a test of it stands it under a router too: a
 * root drawing the shell under test, the places beside the sidebar
 * (`ShellPlaces`) with what the window's state says in their slot
 * (`StatePlace`), and the routed places, Settings, Admin, the Board, and a
 * person's page, as their own
 * lazy modules and frames draw them. It is built from TanStack Router's own
 * routes over the same components `panel-router.tsx` mounts, rather than
 * the window's router, whose root is `App`, so the test's props are what
 * the shell draws from. It holds the shell, the places layout, and the
 * moved routes alone, so it is no second tree to drift from the window's.
 * The history is a memory one at `at`.
 */

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
  BoardRouteLoading,
  PersonRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
} from "../desktop/desktop-shell.js";
import { LAZY_ROUTE } from "../panel-router.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { routeAccessNow } from "../route-gates.js";

/** Where a shell under test stands: a place its state says, Settings's list or a page of it, Admin, the Board, or a person's page. */
export const SHELL_AT = {
  PLACES: "/app",
  SETTINGS: "/app/settings",
  ADMIN: "/acme/admin",
  BOARD: "/acme/tasks",
} as const;

/** A person's page in the shell under test, under the same workspace as its Board. */
function personAt(userId: string): string {
  return `/acme/person/${encodeURIComponent(userId)}`;
}

/** The shell a test draws, handed to the router's root as it is drawn, so a shell drawn again with new props holds. */
const ShellElement = createContext<ReactElement | null>(null);

function ShellRoot(): ReactElement | null {
  return useContext(ShellElement);
}

/** A router to draw a shell under, and the ways to draw it there: standing at `at`, or where `standing` or the shell's own props say. */
export interface ShellRouter {
  readonly draw: (shell: ReactElement, at?: string) => ReactElement;
  readonly under: (shell: ReactElement, standing?: string) => ReactElement;
  readonly router: AnyRouter;
  /** Moves the router to `to`, as the window's own doors move it. */
  readonly go: (to: string) => void;
  /** Answers once the router's latest move has drawn where it went, its route's chunk read. */
  readonly settled: () => Promise<void>;
}

/** What a shell's props say of where it stands. */
interface StandingProps {
  readonly tab?: unknown;
  readonly tasks?: {
    readonly adminView?: { readonly open?: boolean };
    readonly boardView?: { readonly open?: boolean };
    readonly personView?: { readonly userId?: string | undefined };
  };
}

/** Where a shell stands by its props: Settings where its tab is, Admin, the Board, or a person's page where one stands, else the places. */
function standingOf(shell: ReactElement): string {
  const props: StandingProps =
    typeof shell.props === "object" && shell.props !== null ? shell.props : {};
  if (props.tab === PANEL_TAB.SETTINGS) return SHELL_AT.SETTINGS;
  if (props.tasks?.adminView?.open === true) return SHELL_AT.ADMIN;
  if (props.tasks?.boardView?.open === true) return SHELL_AT.BOARD;
  const person = props.tasks?.personView?.userId;
  return person === undefined ? SHELL_AT.PLACES : personAt(person);
}

/** A router over the shell, the places, and the routed places, standing at `at`. */
export function shellRouter(at: string = SHELL_AT.PLACES): ShellRouter {
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
      places.addChildren([stateRoute, admin, board, person]),
      settings.addChildren([settingsPage]),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { queryClient: new QueryClient(), access: routeAccessNow() },
  });
  // The router's latest move, which a test awaits rather than guessing how many turns its chunk takes to read.
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

/** A shell router made and read before each test, so the places stand from the test's first draw; answers the one standing. */
export function shellRouterEachTest(): () => ShellRouter {
  let routed = shellRouter();
  beforeEach(async () => {
    routed = shellRouter();
    await routed.router.load();
  });
  return () => routed;
}
