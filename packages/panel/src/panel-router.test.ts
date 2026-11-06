import { hostConnectPath } from "@repo/features/host-wire";
import {
  ADMIN_LINK_SECTION,
  LINK_PLACE,
  type LinkPlace,
  linkOf,
  PULL_REQUEST_THREAD_VIEW,
} from "@repo/features/link-grammar";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, type RouteIds } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createPanelRouter, type PanelRouter } from "./panel-router.js";

type PanelRouteId = RouteIds<PanelRouter["routeTree"]>;

/** Where an address must land: the route it names, the ids that route reads from it, and its search where it has one. */
interface Landing {
  readonly routeId: PanelRouteId;
  readonly params: Record<string, string>;
  readonly search?: Record<string, string>;
}

const W = "stage";

/** Every address `linkOf` writes, one row per spelling of each place kind, beside the route a hand reading of its path names. */
const LINKS: readonly (readonly [LinkPlace, Landing])[] = [
  [{ kind: LINK_PLACE.HOME }, { routeId: "/places/$workspace/", params: { workspace: W } }],
  [{ kind: LINK_PLACE.BOARD }, { routeId: "/places/$workspace/tasks", params: { workspace: W } }],
  [
    { kind: LINK_PLACE.TASK, planId: "42" },
    { routeId: "/places/$workspace/task/$taskId/", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_PLACE.SECTION, planId: "42", anchor: "rollout" },
    { routeId: "/places/$workspace/task/$taskId/", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_PLACE.COMMENT, planId: "42", threadId: "1234" },
    {
      routeId: "/places/$workspace/task/$taskId/",
      params: { workspace: W, taskId: "42" },
      search: { comment: "1234" },
    },
  ],
  [
    { kind: LINK_PLACE.VERSION, planId: "42", revision: 3 },
    {
      routeId: "/places/$workspace/task/$taskId/version/$revision",
      params: { workspace: W, taskId: "42", revision: "3" },
    },
  ],
  [
    { kind: LINK_PLACE.PAGE, planId: "42", pageId: "p1" },
    {
      routeId: "/places/$workspace/task/$taskId/page/$pageId",
      params: { workspace: W, taskId: "42", pageId: "p1" },
    },
  ],
  [
    { kind: LINK_PLACE.PAGE, agentId: "a1", pageId: "p1" },
    {
      routeId: "/places/$workspace/agent/$agentId/page/$pageId",
      params: { workspace: W, agentId: "a1", pageId: "p1" },
    },
  ],
  [
    { kind: LINK_PLACE.AGENT, agentId: "a1" },
    { routeId: "/places/$workspace/agent/$agentId/", params: { workspace: W, agentId: "a1" } },
  ],
  [
    { kind: LINK_PLACE.AGENT, planId: "42", agentId: "a1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/",
      params: { workspace: W, taskId: "42", agentId: "a1" },
    },
  ],
  [
    { kind: LINK_PLACE.WORKER, agentId: "a1", callId: "c1" },
    {
      routeId: "/places/$workspace/agent/$agentId/worker/$callId",
      params: { workspace: W, agentId: "a1", callId: "c1" },
    },
  ],
  [
    { kind: LINK_PLACE.WORKER, planId: "42", agentId: "a1", callId: "c1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/worker/$callId",
      params: { workspace: W, taskId: "42", agentId: "a1", callId: "c1" },
    },
  ],
  [
    { kind: LINK_PLACE.CHANGES, agentId: "a1" },
    {
      routeId: "/places/$workspace/agent/$agentId/changes/",
      params: { workspace: W, agentId: "a1" },
    },
  ],
  [
    { kind: LINK_PLACE.CHANGES, planId: "42", agentId: "a1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/changes/",
      params: { workspace: W, taskId: "42", agentId: "a1" },
    },
  ],
  [
    {
      kind: LINK_PLACE.PULL_REQUEST_THREAD,
      agentId: "a1",
      threadId: "PRRT_kw1",
      view: PULL_REQUEST_THREAD_VIEW.FILES,
    },
    {
      routeId: "/places/$workspace/agent/$agentId/changes/$view/thread/$threadId",
      params: { workspace: W, agentId: "a1", view: "files", threadId: "PRRT_kw1" },
    },
  ],
  [
    {
      kind: LINK_PLACE.PULL_REQUEST_THREAD,
      planId: "42",
      agentId: "a1",
      threadId: "PRRT_kw1",
      view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
    },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/changes/$view/thread/$threadId",
      params: {
        workspace: W,
        taskId: "42",
        agentId: "a1",
        view: "conversation",
        threadId: "PRRT_kw1",
      },
    },
  ],
  [
    { kind: LINK_PLACE.MESSAGE, agentId: "a1", messageId: "m1" },
    {
      routeId: "/places/$workspace/agent/$agentId/message/$messageId",
      params: { workspace: W, agentId: "a1", messageId: "m1" },
    },
  ],
  [
    { kind: LINK_PLACE.MESSAGE, planId: "42", agentId: "a1", messageId: "m1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/message/$messageId",
      params: { workspace: W, taskId: "42", agentId: "a1", messageId: "m1" },
    },
  ],
  [{ kind: LINK_PLACE.INBOX }, { routeId: "/places/$workspace/inbox/", params: { workspace: W } }],
  [
    { kind: LINK_PLACE.INBOX, planId: "42" },
    { routeId: "/places/$workspace/inbox/task/$taskId", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_PLACE.INBOX_ITEM, itemId: "i1" },
    { routeId: "/places/$workspace/inbox/$itemId", params: { workspace: W, itemId: "i1" } },
  ],
  [
    { kind: LINK_PLACE.INBOX_ITEM, planId: "42", itemId: "i1" },
    {
      routeId: "/places/$workspace/task/$taskId/inbox/$itemId",
      params: { workspace: W, taskId: "42", itemId: "i1" },
    },
  ],
  [
    { kind: LINK_PLACE.INBOX_ITEM, agentId: "a1", itemId: "i1" },
    {
      routeId: "/places/$workspace/agent/$agentId/inbox/$itemId",
      params: { workspace: W, agentId: "a1", itemId: "i1" },
    },
  ],
  [
    { kind: LINK_PLACE.AUTOMATIONS },
    { routeId: "/places/$workspace/automations", params: { workspace: W } },
  ],
  [
    { kind: LINK_PLACE.AUTOMATION, automationId: "au1" },
    {
      routeId: "/places/$workspace/automation/$automationId/",
      params: { workspace: W, automationId: "au1" },
    },
  ],
  [
    { kind: LINK_PLACE.AUTOMATION_RUN, automationId: "au1", runId: "r1" },
    {
      routeId: "/places/$workspace/automation/$automationId/run/$runId",
      params: { workspace: W, automationId: "au1", runId: "r1" },
    },
  ],
  [
    { kind: LINK_PLACE.PERSON, userId: "u1" },
    { routeId: "/places/$workspace/person/$userId", params: { workspace: W, userId: "u1" } },
  ],
  [{ kind: LINK_PLACE.SETTINGS }, { routeId: "/$workspace/settings/", params: { workspace: W } }],
  [
    { kind: LINK_PLACE.SETTINGS, page: "keyboard-shortcuts" },
    {
      routeId: "/$workspace/settings/$page",
      params: { workspace: W, page: "keyboard-shortcuts" },
    },
  ],
  [{ kind: LINK_PLACE.ADMIN }, { routeId: "/places/$workspace/admin/", params: { workspace: W } }],
  [
    { kind: LINK_PLACE.ADMIN, section: ADMIN_LINK_SECTION.COST },
    { routeId: "/places/$workspace/admin/$section", params: { workspace: W, section: "cost" } },
  ],
  [
    { kind: LINK_PLACE.ADMIN, userId: "u1" },
    { routeId: "/places/$workspace/admin/user/$userId", params: { workspace: W, userId: "u1" } },
  ],
  [
    { kind: LINK_PLACE.ADMIN, workspaceId: "ws1" },
    {
      routeId: "/places/$workspace/admin/workspace/$workspaceId",
      params: { workspace: W, workspaceId: "ws1" },
    },
  ],
  [
    { kind: LINK_PLACE.ADMIN, day: "2026-11-05" },
    { routeId: "/places/$workspace/admin/day/$day", params: { workspace: W, day: "2026-11-05" } },
  ],
];

/** The deepest route the router matches `address` to, read as a window's router reads the address it opens at. */
function landingOf(address: string): Landing {
  const router = createPanelRouter(
    createMemoryHistory({ initialEntries: [address] }),
    new QueryClient(),
  );
  const { pathname, search } = router.latestLocation;
  const leaf = router.matchRoutes(pathname, search).at(-1);
  if (leaf === undefined) throw new Error(`No route matched ${address}`);
  return { routeId: leaf.routeId, params: leaf.params, search: leaf.search };
}

/** A link's address as a window holds it: its path, query, and fragment. */
function addressOf(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}${url.hash}`;
}

describe("the panel's route tree", () => {
  it.each(LINKS)("names the address linkOf writes for %o", (place, landing) => {
    expect(landingOf(addressOf(linkOf(place, W)))).toEqual({ search: {}, ...landing });
  });

  it("names a pairing's address and the panel's own", () => {
    expect(landingOf(hostConnectPath("ABCDEFGH"))).toEqual({
      routeId: "/places/connect/$code",
      params: { code: "ABCD-EFGH" },
      search: {},
    });
    expect(landingOf("/app")).toEqual({ routeId: "/places/app", params: {}, search: {} });
  });

  it("names Settings under the panel's own address, as it stands while the window lists no workspace", () => {
    expect(landingOf("/app/settings")).toEqual({
      routeId: "/app/settings/",
      params: {},
      search: {},
    });
    expect(landingOf("/app/settings/appearance")).toEqual({
      routeId: "/app/settings/$page",
      params: { page: "appearance" },
      search: {},
    });
  });

  it("covers every place kind", () => {
    const kinds = new Set(LINKS.map(([place]) => place.kind));
    expect([...kinds].sort()).toEqual(Object.values(LINK_PLACE).sort());
  });
});
