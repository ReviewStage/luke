import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { ReloadState } from "@repo/ui/error-boundary";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type ErrorComponentProps,
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
  AutomationsRouteLoading,
  BoardRouteLoading,
  PersonRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
} from "./desktop/desktop-shell.js";
import {
  adminRouteStands,
  type RouteAccess,
  settingsPageRouteStands,
  UNREAD_ROUTE_ACCESS,
  useRouteAccess,
  workspaceRouteStands,
} from "./route-gates.js";
import { pathUnder } from "./routed-location.js";

const taskSearchSchema = Schema.toStandardSchemaV1(
  Schema.StructWithRest(Schema.Struct({ comment: Schema.optionalKey(Schema.String) }), [
    Schema.Record(Schema.String, Schema.String),
  ]),
);

function readSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

function writeSearch(search: Record<string, unknown>): string {
  const written = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, String(value)]],
    ),
  ).toString();
  return written === "" ? "" : `?${written}`;
}

interface PanelRouterContext {
  readonly queryClient: QueryClient;
  readonly access: RouteAccess;
}

function reloadDocument(): void {
  location.reload();
}

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

export const LAZY_ROUTE = {
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: RouteFailed,
} as const;

const rootRoute = createRootRouteWithContext<PanelRouterContext>()({ component: App });

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
  settingsRoute.addChildren([settingsIndexRoute, settingsPageRoute]),
  appSettingsRoute.addChildren([appSettingsIndexRoute, appSettingsPageRoute]),
]);

export function createPanelRouter(history: RouterHistory, queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient, access: UNREAD_ROUTE_ACCESS },
    parseSearch: readSearch,
    stringifySearch: writeSearch,
    scrollRestoration: true,
  });
}

export type PanelRouter = ReturnType<typeof createPanelRouter>;

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
