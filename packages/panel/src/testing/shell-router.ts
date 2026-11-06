/**
 * shell-router.ts -- the window's shell in a test, drawn under a router with the props the test hands it; `panel-router.test.ts` holds the production route tree, which this is not.
 *
 * The shell draws what stands past its gates through the router's `Outlet`
 * (`desktop-shell.tsx`), so a test of it stands it under a router too: a
 * root drawing the shell under test, the places beside the sidebar
 * (`ShellPlaces`) with what the window's state says in their slot
 * (`StatePlace`), and the routed places, Settings, Admin, the Board, a
 * person's page, the Automations pages, and a version history, as their own
 * lazy modules and frames draw them, an agent's own page, and the Inbox, kept beside them all,
 * whose route draws nothing of its own (`InboxPlace`). It is built from TanStack Router's own
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
  AgentPlace,
  AutomationsRouteLoading,
  BoardRouteLoading,
  InboxPlace,
  PersonRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
  VersionHistoryRouteLoading,
} from "../desktop/desktop-shell.js";
import { LAZY_ROUTE } from "../panel-router.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { routeAccessNow } from "../route-gates.js";
import { testQueryClientNow } from "./copy-feedback.js";

/** Where a shell under test stands: a place its state says, Settings's list or a page of it, Admin, the Board, the Automations list, a version history's list, the Inbox, or a person's page. */
export const SHELL_AT = {
  PLACES: "/app",
  INBOX: "/acme/inbox",
  SETTINGS: "/app/settings",
  ADMIN: "/acme/admin",
  BOARD: "/acme/tasks",
  AUTOMATIONS: "/acme/automations",
  VERSION_HISTORY: "/acme/task/1/versions",
} as const;

/** An agent's own page in the shell under test, under the same workspace as its Board. */
export function agentAt(agentId: string): string {
  return `/acme/agent/${encodeURIComponent(agentId)}`;
}

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
    readonly agentView?: { readonly agentId?: string | undefined };
    readonly automationsView?: { readonly open?: boolean };
    readonly history?: { readonly open?: boolean };
    readonly inboxView?: { readonly open?: boolean };
  };
}

/** Where a shell stands by its props: Settings where its tab is, Admin, the Board, the Automations pages, a version history, the Inbox, an agent's or a person's page where one stands, else the places. */
function standingOf(shell: ReactElement): string {
  const props: StandingProps =
    typeof shell.props === "object" && shell.props !== null ? shell.props : {};
  if (props.tab === PANEL_TAB.SETTINGS) return SHELL_AT.SETTINGS;
  if (props.tasks?.adminView?.open === true) return SHELL_AT.ADMIN;
  if (props.tasks?.boardView?.open === true) return SHELL_AT.BOARD;
  if (props.tasks?.automationsView?.open === true) return SHELL_AT.AUTOMATIONS;
  if (props.tasks?.history?.open === true) return SHELL_AT.VERSION_HISTORY;
  if (props.tasks?.inboxView?.open === true) return SHELL_AT.INBOX;
  const agent = props.tasks?.agentView?.agentId;
  if (agent !== undefined) return agentAt(agent);
  const person = props.tasks?.personView?.userId;
  return person === undefined ? SHELL_AT.PLACES : personAt(person);
}

/** A router over the shell, the places, and the routed places, standing at `at`. */
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
  // Note that the pages' layout stands under a workspace's step, as in the window's tree, so their lazy module's id is theirs here too.
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
  const inbox = createRoute({
    getParentRoute: () => workspace,
    path: "inbox",
    component: InboxPlace,
  });
  const inboxItem = createRoute({ getParentRoute: () => inbox, path: "$itemId" });
  const agent = createRoute({
    getParentRoute: () => workspace,
    path: "agent/$agentId",
    component: AgentPlace,
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
  // Note that the history's layout is pathless under the root, as in the window's tree, so its lazy module's id is its own here too.
  const versionHistory = createRoute({
    getParentRoute: () => root,
    id: "version-history",
    pendingComponent: VersionHistoryRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() =>
    import("../desktop/version-history-route.lazy.js").then(
      (loaded) => loaded.versionHistoryLazyRoute,
    ),
  );
  const versions = createRoute({
    getParentRoute: () => versionHistory,
    path: "/$workspace/task/$taskId/versions",
  });
  const version = createRoute({
    getParentRoute: () => versionHistory,
    path: "/$workspace/task/$taskId/version/$revision",
  });
  const router = createRouter({
    routeTree: root.addChildren([
      places.addChildren([
        stateRoute,
        admin,
        board,
        person,
        workspace.addChildren([
          automationPages.addChildren([automations, automation]),
          inbox.addChildren([inboxItem]),
          agent,
        ]),
      ]),
      settings.addChildren([settingsPage]),
      versionHistory.addChildren([versions, version]),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { queryClient: new QueryClient(), access: routeAccessNow(testQueryClientNow()) },
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
