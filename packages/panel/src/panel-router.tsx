/**
 * panel-router.tsx -- the panel's route tree: one typed route per address a link of ours names, under a root that draws `App`.
 *
 * Every path is the one `linkOf` (`@repo/features/link-grammar`) writes
 * under its workspace, `/<workspace>/task/<id>` and the rest, a pairing's
 * `/connect/<code>`, and the bare `/app`, the address of a place with no
 * link (`navigation-history.ts`'s `NO_LINK_ADDRESS`), so a link written
 * before the router stood reads the same through it; Settings stands at
 * `/app/settings` too, while the window lists no workspace. A place's leaf
 * is an index route under the path it shares with the places beneath it,
 * so `/task/<id>` and `/task/<id>/version/<n>` are both a route of their own.
 *
 * The root draws `App`, whose shell draws the route standing through its
 * `Outlet` (`desktop-shell.tsx`). Every place but Settings stands beside the
 * sidebar, under the pathless `places` layout, which stays drawn as the
 * window moves between them. Settings and Admin are routed places: the
 * router alone says the window stands on them, their routes draw them as
 * lazy routes, and each gate is a `beforeLoad` over a predicate the
 * window's Back and Forward ask too (`route-gates.ts`). Every other place
 * is still the window's state's, which its routes draw through one
 * component (`StatePlace`), so moving a place onto the router swaps its
 * route's component and deletes its place kind from `navigation-history.ts`.
 */

import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  RouterProvider,
  redirect,
} from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect, useMemo, useRef } from "react";
import { App } from "./app.js";
import {
  AdminRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
} from "./desktop/desktop-shell.js";
import {
  adminRouteStands,
  type RouteAccess,
  routeAccessNow,
  settingsPageRouteStands,
} from "./route-gates.js";
import { useAdminAccess, useAdminAccessPending, useExperimentChoices } from "./use-app-state.js";

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

/** How long a lazy route's own frame waits before it stands in for the chunk: not at all, as the `Suspense` it replaces did not. */
export const LAZY_FRAME_AT_ONCE = { pendingMs: 0, pendingMinMs: 0 } as const;

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

const homeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  component: StatePlace,
});

const boardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "tasks",
  component: StatePlace,
});

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

const taskVersionRoute = createRoute({
  getParentRoute: () => taskRoute,
  path: "version/$revision",
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

const agentRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agent/$agentId",
  component: StatePlace,
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

const inboxRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "inbox",
  component: StatePlace,
});

const inboxIndexRoute = createRoute({ getParentRoute: () => inboxRoute, path: "/" });

const inboxTaskRoute = createRoute({ getParentRoute: () => inboxRoute, path: "task/$taskId" });

const inboxItemRoute = createRoute({ getParentRoute: () => inboxRoute, path: "$itemId" });

const automationsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "automations",
  component: StatePlace,
});

const automationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "automation/$automationId",
  component: StatePlace,
});

const automationIndexRoute = createRoute({ getParentRoute: () => automationRoute, path: "/" });

const automationRunRoute = createRoute({
  getParentRoute: () => automationRoute,
  path: "run/$runId",
});

const personRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "person/$userId",
  component: StatePlace,
});

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
  ...LAZY_FRAME_AT_ONCE,
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
  ...LAZY_FRAME_AT_ONCE,
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

/** Settings while the window lists no workspace, as the desktop's does with no account. */
const appSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/settings",
  pendingComponent: SettingsRouteLoading,
  ...LAZY_FRAME_AT_ONCE,
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
        taskVersionRoute,
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
      automationsRoute,
      automationRoute.addChildren([automationIndexRoute, automationRunRoute]),
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
  settingsRoute.addChildren([settingsIndexRoute, settingsPageRoute]),
  appSettingsRoute.addChildren([appSettingsIndexRoute, appSettingsPageRoute]),
]);

/** The panel's router over `history`, a window's own, which its root makes, one per window, its routes handed the window's `queryClient`. */
export function createPanelRouter(history: RouterHistory, queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient, access: routeAccessNow() },
    parseSearch: readSearch,
    stringifySearch: writeSearch,
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
  const admin = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const experiments = useExperimentChoices();
  const access = useMemo(
    (): RouteAccess => ({ admin: admin || adminPending, experiments }),
    [admin, adminPending, experiments],
  );
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
