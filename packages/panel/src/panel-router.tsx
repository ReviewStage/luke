/**
 * panel-router.tsx -- the panel's route tree: one typed route per address a link of ours names, under a root that draws `App`.
 *
 * Every path is the one `linkOf` (`@repo/features/link-grammar`) writes
 * under its workspace, `/<workspace>/task/<id>` and the rest, a pairing's
 * `/connect/<code>`, and the bare `/app`, the address of a place with no
 * link (`navigation-history.ts`'s `NO_LINK_ADDRESS`), so a link written
 * before the router stood reads the same through it. The routes draw
 * nothing of their own and nothing navigates through them yet: the root
 * draws `App`, whose back and forward write each step into the router's
 * history (`navigation-history.ts`). A place's leaf is an index route under the
 * path it shares with the places beneath it, so `/task/<id>` and
 * `/task/<id>/version/<n>` are both a route of their own.
 */

import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Schema } from "effect";
import { App } from "./app.js";

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

/** What every route reads from the router's `context`: the window's one TanStack Query client (`query-client.tsx`). */
interface PanelRouterContext {
  readonly queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<PanelRouterContext>()({ component: App });

const appRoute = createRoute({ getParentRoute: () => rootRoute, path: "/app" });

const connectRoute = createRoute({ getParentRoute: () => rootRoute, path: "/connect/$code" });

const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, path: "/$workspace" });

const homeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/" });

const boardRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "tasks" });

const taskRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "task/$taskId" });

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

const agentRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "agent/$agentId" });

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

const inboxRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "inbox" });

const inboxIndexRoute = createRoute({ getParentRoute: () => inboxRoute, path: "/" });

const inboxTaskRoute = createRoute({ getParentRoute: () => inboxRoute, path: "task/$taskId" });

const inboxItemRoute = createRoute({ getParentRoute: () => inboxRoute, path: "$itemId" });

const automationsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "automations",
});

const automationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "automation/$automationId",
});

const automationIndexRoute = createRoute({ getParentRoute: () => automationRoute, path: "/" });

const automationRunRoute = createRoute({
  getParentRoute: () => automationRoute,
  path: "run/$runId",
});

const personRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "person/$userId" });

const settingsRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "settings" });

const settingsIndexRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/" });

const settingsPageRoute = createRoute({ getParentRoute: () => settingsRoute, path: "$page" });

const adminRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "admin" });

const adminIndexRoute = createRoute({ getParentRoute: () => adminRoute, path: "/" });

const adminSectionRoute = createRoute({ getParentRoute: () => adminRoute, path: "$section" });

const adminUserRoute = createRoute({ getParentRoute: () => adminRoute, path: "user/$userId" });

const adminWorkspaceRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "workspace/$workspaceId",
});

const adminDayRoute = createRoute({ getParentRoute: () => adminRoute, path: "day/$day" });

const routeTree = rootRoute.addChildren([
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
    settingsRoute.addChildren([settingsIndexRoute, settingsPageRoute]),
    adminRoute.addChildren([
      adminIndexRoute,
      adminSectionRoute,
      adminUserRoute,
      adminWorkspaceRoute,
      adminDayRoute,
    ]),
  ]),
]);

/** The panel's router over `history`, a window's own, which its root makes, one per window, its routes handed the window's `queryClient`. */
export function createPanelRouter(history: RouterHistory, queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    parseSearch: readSearch,
    stringifySearch: writeSearch,
  });
}

/** The router the panel's hooks and links are typed against. */
export type PanelRouter = ReturnType<typeof createPanelRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: PanelRouter;
  }
}
