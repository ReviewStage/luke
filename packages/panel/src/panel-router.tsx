/**
 * panel-router.tsx -- the panel's route tree: one typed route per address a link of ours names, under a root that draws `App`.
 *
 * Every path is the one `linkOf` (`@repo/features/link-grammar`) writes
 * under its workspace, `/<workspace>/task/<id>` and the rest, a pairing's
 * `/connect/<code>`, and the bare `/app`, the address of a place with no
 * link (`navigation-history.ts`'s `NO_LINK_ADDRESS`), so a link written
 * before the router stood reads the same through it; Settings stands at
 * `/app/settings` too, while the window lists no workspace, and the
 * Automations pages hold the places no link names, their Runs tab, a new
 * automation's page, and an automation's runs alone, as a version history
 * holds its own: its list, a version's sections, and one of them. A place's leaf
 * is an index route under the path it shares with the places beneath it,
 * so `/task/<id>` and `/task/<id>/agent/<id>` are both a route of their own.
 *
 * The root draws `App`, whose shell draws the route standing through its
 * `Outlet` (`desktop-shell.tsx`). Every place but Settings and a version history stands beside the
 * sidebar, under the pathless `places` layout, which stays drawn as the
 * window moves between them, and a task's version history takes the whole
 * window as Settings does. Settings, Admin, a workspace's Board, a
 * person's page, an agent's own page, the Automations pages, a task's version history, the Inbox, and a workspace's address naming none of the reader's, not found, are routed places: the router alone says the window stands
 * on them, their routes draw them, as lazy routes but for an agent's page, drawn at once, and the Inbox, kept drawn beside them all, and each gate is a
 * `beforeLoad` over a predicate the window's Back and Forward ask too
 * (`route-gates.ts`), but for an agent's page, which stands at any address
 * as it always has. Every other place
 * is still the window's state's, which its routes draw through one
 * component (`StatePlace`), so moving a place onto the router swaps its
 * route's component and deletes its place kind from `navigation-history.ts`.
 */

import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { ReloadState } from "@repo/ui/error-boundary";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  notFound,
  type RouterHistory,
  RouterProvider,
  redirect,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect, useRef } from "react";
import { App } from "./app.js";
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
  UnknownWorkspacePlace,
  VersionHistoryRouteLoading,
} from "./desktop/desktop-shell.js";
import {
  adminRouteStands,
  pathUnder,
  type RouteAccess,
  settingsPageRouteStands,
  UNREAD_ROUTE_ACCESS,
  useRouteAccess,
  versionHistoryRouteStands,
  workspaceRouteStands,
} from "./route-gates.js";

/** A task's link naming one of its comment threads, `?comment=<threadId>`; every other key the address carries is left as it stands. */
const taskSearchSchema = Schema.toStandardSchemaV1(
  Schema.StructWithRest(Schema.Struct({ comment: Schema.optionalKey(Schema.String) }), [
    Schema.Record(Schema.String, Schema.String),
  ]),
);

/** Note that a query is read as `URLSearchParams` reads it, every value the string it is, because the router's default reading makes an all-digit id a number and JSON-quotes what it writes back. */
function readSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

/** A query written as `linkOf` writes one, through `URLSearchParams`, with its `?` where it holds anything. */
function writeSearch(search: Record<string, unknown>): string {
  const written = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, String(value)]],
    ),
  ).toString();
  return written === "" ? "" : `?${written}`;
}

/** What every route reads from the router's `context`: the window's one TanStack Query client (`query-client.tsx`), and the access its gates read (`route-gates.ts`), which `PanelRouterProvider` hands it as it moves. */
interface PanelRouterContext {
  readonly queryClient: QueryClient;
  readonly access: RouteAccess;
}

/** The window's own reload: its document read again from the start, every chunk among it. */
function reloadDocument(): void {
  location.reload();
}

/**
 * What a lazy route stands where it failed: `ReloadState`, whose Reload
 * reloads the window where the route's chunk failed to load, because
 * Chromium keeps a module whose fetch failed in the document's module map
 * and answers every later import of it with the same failure, and
 * otherwise, a route that landed and threw while drawing, draws it again in
 * place, as `lazy-route.ts` does.
 */
function RouteFailed({ reset }: ErrorComponentProps): React.JSX.Element {
  const router = useRouter();
  const loadFailed = useMatch({ strict: false, select: (match) => match.status === "error" });
  const reload = () => {
    if (loadFailed) {
      reloadDocument();
      return;
    }
    reset();
    void router.invalidate();
  };
  return <ReloadState onReload={reload} />;
}

/** A lazy route's options: its own frame stands at once while its chunk loads, as the `Suspense` it replaces did, and `RouteFailed` where it fails. */
export const LAZY_ROUTE = {
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: RouteFailed,
} as const;

const rootRoute = createRootRouteWithContext<PanelRouterContext>()({ component: App });

/**
 * The window's places beside the sidebar, every one but Settings, which
 * takes the whole window: a pathless layout, so the shell they share stays
 * drawn as the window moves between them, its content slot the `Outlet`
 * the place standing draws in.
 */
const placesRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "places",
  component: ShellPlaces,
});

const appRoute = createRoute({
  getParentRoute: () => placesRoute,
  path: "/app",
  component: StatePlace,
});

const connectRoute = createRoute({
  getParentRoute: () => placesRoute,
  path: "/connect/$code",
  component: StatePlace,
});

const workspaceRoute = createRoute({ getParentRoute: () => placesRoute, path: "/$workspace" });

/**
 * A workspace's Home, the place the window's state says, of one of the
 * reader's workspaces (`workspaceRouteStands`): an address naming none of
 * theirs is not found, its page saying the workspace is not there for them
 * and drawing nothing of it, at its own address
 * (`ROUTED_PLACE.UNKNOWN_WORKSPACE`).
 */
const homeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: ({ context, params }) => {
    if (workspaceRouteStands(params.workspace, context.access)) return;
    throw notFound();
  },
  component: StatePlace,
  notFoundComponent: UnknownWorkspacePlace,
});

/**
 * A workspace's Board, the Tasks page, of one of the reader's workspaces
 * (`workspaceRouteStands`): an address naming none of theirs gives way to
 * that address's Home, which is not found. Its
 * page is a chunk of its own, read ahead as the pointer comes to its row,
 * and once the signed-in window is idle; what stands while it loads is the
 * page's own frame.
 */
const boardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "tasks",
  beforeLoad: ({ context, params }) => {
    if (workspaceRouteStands(params.workspace, context.access)) return;
    throw redirect({ to: "/$workspace", params: { workspace: params.workspace }, replace: true });
  },
  pendingComponent: BoardRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() => import("./desktop/board-route.lazy.js").then((loaded) => loaded.boardLazyRoute));

const taskRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "task/$taskId",
  component: StatePlace,
});

const taskIndexRoute = createRoute({
  getParentRoute: () => taskRoute,
  path: "/",
  validateSearch: taskSearchSchema,
});

const taskPageRoute = createRoute({ getParentRoute: () => taskRoute, path: "page/$pageId" });

const taskInboxItemRoute = createRoute({ getParentRoute: () => taskRoute, path: "inbox/$itemId" });

const taskAgentRoute = createRoute({ getParentRoute: () => taskRoute, path: "agent/$agentId" });

const taskAgentIndexRoute = createRoute({ getParentRoute: () => taskAgentRoute, path: "/" });

const taskAgentWorkerRoute = createRoute({
  getParentRoute: () => taskAgentRoute,
  path: "worker/$callId",
});

const taskAgentChangesRoute = createRoute({
  getParentRoute: () => taskAgentRoute,
  path: "changes",
});

const taskAgentChangesIndexRoute = createRoute({
  getParentRoute: () => taskAgentChangesRoute,
  path: "/",
});

const taskAgentThreadRoute = createRoute({
  getParentRoute: () => taskAgentChangesRoute,
  path: "$view/thread/$threadId",
});

const taskAgentMessageRoute = createRoute({
  getParentRoute: () => taskAgentRoute,
  path: "message/$messageId",
});

/**
 * An agent's own page, the page of an agent on no task or of an archived
 * one opened on its own, under the workspace its address names, at its own
 * address (`AgentPlace`). The places under it, a worker, its Changes, a
 * message, a page, or an Inbox item of it, are what a link to them names,
 * and what a step on a task's tab is written at, so they draw the place the
 * window's state says, as every route not yet moved does.
 */
const agentRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agent/$agentId",
  component: AgentPlace,
});

const agentIndexRoute = createRoute({ getParentRoute: () => agentRoute, path: "/" });

const agentWorkerRoute = createRoute({ getParentRoute: () => agentRoute, path: "worker/$callId" });

const agentChangesRoute = createRoute({ getParentRoute: () => agentRoute, path: "changes" });

const agentChangesIndexRoute = createRoute({ getParentRoute: () => agentChangesRoute, path: "/" });

const agentThreadRoute = createRoute({
  getParentRoute: () => agentChangesRoute,
  path: "$view/thread/$threadId",
});

const agentMessageRoute = createRoute({
  getParentRoute: () => agentRoute,
  path: "message/$messageId",
});

const agentPageRoute = createRoute({ getParentRoute: () => agentRoute, path: "page/$pageId" });

const agentInboxItemRoute = createRoute({
  getParentRoute: () => agentRoute,
  path: "inbox/$itemId",
});

/**
 * The Inbox of one of the reader's workspaces: its list, `/inbox`, the list
 * narrowed to one task's items, `/inbox/task/<taskId>`, and an item chosen
 * in it, `/inbox/<itemId>`, whose `?task=<taskId>` keeps the task the list
 * it was chosen in was narrowed to. An address naming none of the reader's
 * workspaces opens the same place under the workspace listed, as a link to
 * it does. The Inbox itself is kept drawn beside every place's route
 * (`ShellPlaces`), so its rows, scroll, and search stand as they were left;
 * its route draws nothing of its own (`InboxPlace`).
 */
const inboxRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "inbox",
  beforeLoad: ({ context, params, location }) => {
    const { listed } = context.access;
    if (workspaceRouteStands(params.workspace, context.access) || listed === undefined) return;
    throw redirect({
      href: `${pathUnder(location.pathname, listed)}${location.searchStr}`,
      replace: true,
    });
  },
  component: InboxPlace,
});

const inboxIndexRoute = createRoute({ getParentRoute: () => inboxRoute, path: "/" });

const inboxTaskRoute = createRoute({ getParentRoute: () => inboxRoute, path: "task/$taskId" });

/** An Inbox item's address: `?task=<taskId>`, the task the list it was chosen in was narrowed to; every other key the address carries is left as it stands. */
const inboxItemSearchSchema = Schema.toStandardSchemaV1(
  Schema.StructWithRest(Schema.Struct({ task: Schema.optionalKey(Schema.String) }), [
    Schema.Record(Schema.String, Schema.String),
  ]),
);

const inboxItemRoute = createRoute({
  getParentRoute: () => inboxRoute,
  path: "$itemId",
  validateSearch: inboxItemSearchSchema,
});

/**
 * The Automations pages of one of the reader's workspaces: the list, its
 * Runs tab, a new automation's page, and an automation's, its runs alone
 * where a narrow room stands them apart, or one of its runs. One layout
 * draws them all, so the new page's editor stands on as the automation it
 * made takes its step, and moving between them draws no new page. An
 * address naming none of the reader's workspaces opens the same page under
 * the workspace listed, as a link to it does. Its pages are a chunk of
 * their own, opened seldom, whose list's frame stands while it loads.
 */
const automationPagesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  id: "automation-pages",
  beforeLoad: ({ context, params, location }) => {
    const { listed } = context.access;
    if (workspaceRouteStands(params.workspace, context.access) || listed === undefined) return;
    throw redirect({ href: pathUnder(location.pathname, listed), replace: true });
  },
  pendingComponent: AutomationsRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() =>
  import("./desktop/automations-route.lazy.js").then((loaded) => loaded.automationsLazyRoute),
);

const automationsRoute = createRoute({
  getParentRoute: () => automationPagesRoute,
  path: "automations",
});

const automationsIndexRoute = createRoute({ getParentRoute: () => automationsRoute, path: "/" });

const automationsRunsRoute = createRoute({ getParentRoute: () => automationsRoute, path: "runs" });

const automationsNewRoute = createRoute({ getParentRoute: () => automationsRoute, path: "new" });

const automationRoute = createRoute({
  getParentRoute: () => automationPagesRoute,
  path: "automation/$automationId",
});

const automationIndexRoute = createRoute({ getParentRoute: () => automationRoute, path: "/" });

const automationRunsRoute = createRoute({ getParentRoute: () => automationRoute, path: "runs" });

const automationRunRoute = createRoute({
  getParentRoute: () => automationRoute,
  path: "run/$runId",
});

/**
 * A person's page in one of the reader's workspaces: an address naming none
 * of theirs opens the same person under the workspace listed, as a link to
 * them does. Its page is a chunk of its own, read ahead as the pointer comes
 * to a person's name, its frame standing while it loads.
 */
const personRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "person/$userId",
  beforeLoad: ({ context, params }) => {
    const { listed } = context.access;
    if (workspaceRouteStands(params.workspace, context.access) || listed === undefined) return;
    throw redirect({
      to: "/$workspace/person/$userId",
      params: { workspace: listed, userId: params.userId },
      replace: true,
    });
  },
  pendingComponent: PersonRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() => import("./desktop/person-route.lazy.js").then((loaded) => loaded.personLazyRoute));

/**
 * Admin, an admin's alone (`adminRouteStands`): an address of it loaded or
 * landed on by any other account gives way to the workspace's Home. Its
 * screens are a chunk of their own, which carries its charts, so an account
 * that is no admin never reads it; what stands while it loads is the
 * place's own frame.
 */
const adminRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "admin",
  beforeLoad: ({ context, params }) => {
    if (adminRouteStands(context.access)) return;
    throw redirect({ to: "/$workspace", params: { workspace: params.workspace }, replace: true });
  },
  pendingComponent: AdminRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() => import("./desktop/admin-route.lazy.js").then((loaded) => loaded.adminLazyRoute));

const adminIndexRoute = createRoute({ getParentRoute: () => adminRoute, path: "/" });

const adminSectionRoute = createRoute({ getParentRoute: () => adminRoute, path: "$section" });

const adminUserRoute = createRoute({ getParentRoute: () => adminRoute, path: "user/$userId" });

const adminWorkspaceRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "workspace/$workspaceId",
});

const adminDayRoute = createRoute({ getParentRoute: () => adminRoute, path: "day/$day" });

/**
 * Settings, over the whole window rather than beside the sidebar, under the
 * workspace whose Workspace page it shows, or under `/app` while the window
 * lists none. Its list is the index, which a narrow room stands alone, and
 * each page a `$page`. A page an experiment holds stands only while the
 * account has it on (`settingsPageRouteStands`), and gives way to Profile
 * otherwise. Its pages are a chunk of their own, opened seldom, whose frame
 * stands while it loads.
 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$workspace/settings",
  pendingComponent: SettingsRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() =>
  import("./desktop/settings-route.lazy.js").then((loaded) => loaded.settingsLazyRoute),
);

const settingsIndexRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/" });

const settingsPageRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "$page",
  beforeLoad: ({ context, params }) => {
    if (settingsPageRouteStands(params.page, context.access)) return;
    throw redirect({
      to: "/$workspace/settings/$page",
      params: { workspace: params.workspace, page: SETTINGS_VIEW.ACCOUNT },
      replace: true,
    });
  },
});

/**
 * A task's version history, over the whole window as Settings is, its
 * versions listed where the sidebar stood: following the newest at
 * `/<workspace>/task/<id>/versions`, which a narrow room stands as the list
 * alone, a version chosen at `/version/<revision>`, its sections listed at
 * `/version/<revision>/sections`, and one of them at
 * `/version/<revision>/section/<heading>`. It is the description's, so it
 * stands only while the account has Descriptions on
 * (`versionHistoryRouteStands`), and gives way to the task otherwise. One
 * layout draws every page of it, so moving between them draws no new
 * history; its chunk is its own, opened seldom, whose frame stands while it
 * loads.
 */
const versionHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "version-history",
  pendingComponent: VersionHistoryRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() =>
  import("./desktop/version-history-route.lazy.js").then(
    (loaded) => loaded.versionHistoryLazyRoute,
  ),
);

const taskVersionsRoute = createRoute({
  getParentRoute: () => versionHistoryRoute,
  path: "/$workspace/task/$taskId/versions",
  // A version history gives way to the task it is of while the account has Descriptions off.
  beforeLoad: ({ context, params }) => {
    if (versionHistoryRouteStands(context.access)) return;
    throw redirect({ to: "/$workspace/task/$taskId", params, replace: true });
  },
});

const taskVersionRoute = createRoute({
  getParentRoute: () => versionHistoryRoute,
  path: "/$workspace/task/$taskId/version/$revision",
  beforeLoad: ({ context, params }) => {
    if (versionHistoryRouteStands(context.access)) return;
    throw redirect({
      to: "/$workspace/task/$taskId",
      params: { workspace: params.workspace, taskId: params.taskId },
      replace: true,
    });
  },
});

const taskVersionIndexRoute = createRoute({ getParentRoute: () => taskVersionRoute, path: "/" });

const taskVersionSectionsRoute = createRoute({
  getParentRoute: () => taskVersionRoute,
  path: "sections",
});

const taskVersionSectionRoute = createRoute({
  getParentRoute: () => taskVersionRoute,
  path: "section/$heading",
});

/** Settings while the window lists no workspace, as the desktop's does with no account. */
const appSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/settings",
  pendingComponent: SettingsRouteLoading,
  ...LAZY_ROUTE,
}).lazy(() =>
  import("./desktop/settings-route.lazy.js").then((loaded) => loaded.appSettingsLazyRoute),
);

const appSettingsIndexRoute = createRoute({ getParentRoute: () => appSettingsRoute, path: "/" });

const appSettingsPageRoute = createRoute({
  getParentRoute: () => appSettingsRoute,
  path: "$page",
  beforeLoad: ({ context, params }) => {
    if (settingsPageRouteStands(params.page, context.access)) return;
    throw redirect({
      to: "/app/settings/$page",
      params: { page: SETTINGS_VIEW.ACCOUNT },
      replace: true,
    });
  },
});

const routeTree = rootRoute.addChildren([
  placesRoute.addChildren([
    appRoute,
    connectRoute,
    workspaceRoute.addChildren([
      homeRoute,
      boardRoute,
      taskRoute.addChildren([
        taskIndexRoute,
        taskPageRoute,
        taskInboxItemRoute,
        taskAgentRoute.addChildren([
          taskAgentIndexRoute,
          taskAgentWorkerRoute,
          taskAgentChangesRoute.addChildren([taskAgentChangesIndexRoute, taskAgentThreadRoute]),
          taskAgentMessageRoute,
        ]),
      ]),
      agentRoute.addChildren([
        agentIndexRoute,
        agentWorkerRoute,
        agentChangesRoute.addChildren([agentChangesIndexRoute, agentThreadRoute]),
        agentMessageRoute,
        agentPageRoute,
        agentInboxItemRoute,
      ]),
      inboxRoute.addChildren([inboxIndexRoute, inboxTaskRoute, inboxItemRoute]),
      automationPagesRoute.addChildren([
        automationsRoute.addChildren([
          automationsIndexRoute,
          automationsRunsRoute,
          automationsNewRoute,
        ]),
        automationRoute.addChildren([
          automationIndexRoute,
          automationRunsRoute,
          automationRunRoute,
        ]),
      ]),
      personRoute,
      adminRoute.addChildren([
        adminIndexRoute,
        adminSectionRoute,
        adminUserRoute,
        adminWorkspaceRoute,
        adminDayRoute,
      ]),
    ]),
  ]),
  versionHistoryRoute.addChildren([
    taskVersionsRoute,
    taskVersionRoute.addChildren([
      taskVersionIndexRoute,
      taskVersionSectionsRoute,
      taskVersionSectionRoute,
    ]),
  ]),
  settingsRoute.addChildren([settingsIndexRoute, settingsPageRoute]),
  appSettingsRoute.addChildren([appSettingsIndexRoute, appSettingsPageRoute]),
]);

/**
 * The panel's router over `history`, a window's own, which its root makes, one per window, its routes handed the window's `queryClient`.
 * Note that it starts on the unread access and reads no state, because the desktop's entry makes it as the module loads, before
 * its root installs the bridge, and a read then would keep the bridge's absence as the window's first read; `PanelRouterProvider`
 * hands it the window's access as it draws, before the router first loads.
 */
export function createPanelRouter(history: RouterHistory, queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient, access: UNREAD_ROUTE_ACCESS },
    parseSearch: readSearch,
    stringifySearch: writeSearch,
    // Every scroller stands where it stood as the window comes back to a step, as TanStack Router's docs set it up.
    scrollRestoration: true,
  });
}

/** The router the panel's hooks and links are typed against. */
export type PanelRouter = ReturnType<typeof createPanelRouter>;

/**
 * The window's router, drawn as its root mounts it, handed the account's
 * access as it moves, so a gate (`route-gates.ts`) reads what the window
 * draws by; the routes standing are asked again as it moves, so a place a
 * gate no longer lets stand gives way.
 */
export function PanelRouterProvider({ router }: { router: PanelRouter }): React.JSX.Element {
  const access = useRouteAccess();
  const asked = useRef(access);
  useEffect(() => {
    if (asked.current === access) return;
    asked.current = access;
    void router.invalidate();
  }, [router, access]);
  return <RouterProvider router={router} context={{ access }} />;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: PanelRouter;
  }
}
