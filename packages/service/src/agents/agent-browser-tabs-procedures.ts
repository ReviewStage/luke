import type { DatabaseServices } from "@repo/database/core/query";
import {
  handBackBrowserTab,
  listBrowserTabs,
  type ReachedBrowserTab,
  readBrowserTab,
  recordMemberOpenedBrowserTab,
  takeOverBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { readVisibleAgentWorkspace } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import {
  type AgentBrowserTab,
  agentBrowserTabOf,
  type BrowserTabsPlace,
} from "@repo/features/agent-browser-tab-wire";
import { isBrowserAddress } from "@repo/features/browser-acts";
import { DateTime, Duration, Effect, type Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import { BROWSER_LIVE_BOUNDS } from "../browser-live/bounds.js";
import {
  recordServerEventIn,
  SERVER_AGENT_TOOL,
  SERVER_EVENT,
  type ServerAgentTool,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { controlsAgent, reachedAgentById } from "./agent-reach.js";
import { type AgentBrowser, BROWSER_UNREACHABLE } from "./browser/agent-browser.js";
import { connectRestoring } from "./browser/restore-tabs.js";

export const BROWSER_TAKEOVER_HOLD_MS = 60_000;

const OPEN_HOLD = Duration.sum(BROWSER_LIVE_BOUNDS.IDLE, BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY);

export interface AgentBrowserTabsProcedureSeams {
  resolveUserId: UserIdResolver;
  readonly agentBrowser: Layer.Layer<AgentBrowser, never, HttpClient.HttpClient>;
}

function browserTabOf({ tab, agent }: ReachedBrowserTab, now: Date): AgentBrowserTab {
  return agentBrowserTabOf(
    {
      id: tab.id,
      agentId: agent.id,
      address: tab.address,
      title: tab.title,
      openedBy: tab.openedBy,
      openedByUserId: tab.openedByUserId,
      driverUserId: tab.driverUserId,
      heldUntil: tab.heldUntil?.getTime() ?? null,
      createdAt: tab.createdAt.getTime(),
      lastActedAt: tab.lastActedAt.getTime(),
      cursorX: tab.cursorX,
      cursorY: tab.cursorY,
      cursorKind: tab.cursorKind,
      cursorViewportW: tab.cursorViewportW,
      cursorViewportH: tab.cursorViewportH,
      cursorAt: tab.cursorAt?.getTime() ?? null,
    },
    now.getTime(),
  );
}

const reachedTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
): Effect.fn.Return<ReachedBrowserTab, HostedRefusal, DatabaseServices> {
  const reached = yield* hostedStoreOrUnavailable(readBrowserTab(userId, place, tabId));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return reached.value;
});

const tabPath = /* @__PURE__ */ Effect.fnUntraced(function* (params: {
  readonly id: string;
  readonly tab: string;
}) {
  return { place: { taskId: yield* pathUuid(params.id) }, tabId: yield* pathUuid(params.tab) };
});

const tabAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
) {
  const reached = yield* reachedTab(userId, place, tabId);
  return { tab: browserTabOf(reached, yield* DateTime.nowAsDate) };
});

const listedTabs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
) {
  const listed = yield* hostedStoreOrUnavailable(listBrowserTabs(userId, place));
  if (Option.isNone(listed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const now = yield* DateTime.nowAsDate;
  return { tabs: listed.value.map((reached) => browserTabOf(reached, now)) };
});

const openedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  taskId: string | undefined,
): Effect.fn.Return<
  { readonly conversationId: string; readonly sessionId: string },
  HostedRefusal,
  DatabaseServices
> {
  const { agent } = yield* reachedAgentById(userId, agentId);
  if (taskId !== undefined && agent.taskId !== taskId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const visible = yield* hostedStoreOrUnavailable(readVisibleAgentWorkspace(userId, agent.id));
  if (Option.isNone(visible)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  if (session === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  return { conversationId: agent.conversationId, sessionId: session.sessionId };
});

function openedPage(sessionId: string, conversationId: string, address: string) {
  return Effect.scoped(
    Effect.flatMap(connectRestoring(sessionId, conversationId), (cdp) => cdp.openPage(address)),
  ).pipe(
    Effect.catchTags({
      BrowserUnreachable: (unreachable) =>
        unreachable.reason === BROWSER_UNREACHABLE.NOT_OPENED
          ? Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY)
          : Effect.andThen(
              Effect.logWarning(`a member's Browser tab did not open: ${unreachable.reason}`),
              Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
            ),
      CdpFailure: (failure) =>
        Effect.andThen(
          Effect.logWarning(`a member's Browser tab did not open: ${failure.kind}`),
          Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
        ),
    }),
  );
}

function browserActed(userId: string, agentId: string, tool: ServerAgentTool) {
  return recordServerEventIn(
    SERVER_EVENT.AGENT_TOOL_OPEN,
    userId,
    readVisibleAgentWorkspace(userId, agentId),
    { tool },
  );
}

const openTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  open: { readonly agentId: string; readonly taskId?: string; readonly address: string },
) {
  if (!isBrowserAddress(open.address)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { conversationId, sessionId } = yield* openedAgent(userId, open.agentId, open.taskId);
  const held = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    holdSandbox(conversationId, new Date(held.getTime() + Duration.toMillis(OPEN_HOLD))),
  );
  const targetId = yield* openedPage(sessionId, conversationId, open.address);
  const tab = yield* hostedStoreOrUnavailable(
    recordMemberOpenedBrowserTab({
      conversationId,
      targetId,
      address: open.address,
      title: open.address,
      userId,
    }),
  );
  const now = yield* DateTime.nowAsDate;
  const heldUntil = new Date(now.getTime() + BROWSER_TAKEOVER_HOLD_MS);
  yield* hostedStoreOrUnavailable(takeOverBrowserTab(tab.id, userId, heldUntil, now));
  yield* browserActed(userId, open.agentId, SERVER_AGENT_TOOL.BROWSER);
  return yield* tabAnswer(userId, { agentId: open.agentId }, tab.id);
});

export function agentBrowserTabsProcedures(seams: AgentBrowserTabsProcedureSeams) {
  const member = hosted.agentBrowserTabs.use(accountMiddleware(seams.resolveUserId));
  return {
    agentList: member.agentList.effect(function* ({ input, context }) {
      return yield* listedTabs(context.userId, { agentId: yield* pathUuid(input.id) });
    }),
    list: member.list.effect(function* ({ input, context }) {
      return yield* listedTabs(context.userId, { taskId: yield* pathUuid(input.id) });
    }),
    agentOpen: member.agentOpen.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.params.id);
      return yield* Effect.provide(
        openTab(context.userId, { agentId, address: input.body.address }),
        seams.agentBrowser,
      );
    }),
    open: member.open.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      return yield* Effect.provide(
        openTab(context.userId, { ...input.body, taskId }),
        seams.agentBrowser,
      );
    }),
    takeOver: member.takeOver.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input);
      const { tab, agent } = yield* reachedTab(context.userId, place, tabId);
      if (!controlsAgent(context.userId, agent)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      const now = yield* DateTime.nowAsDate;
      const heldUntil = new Date(now.getTime() + BROWSER_TAKEOVER_HOLD_MS);
      const taken = yield* hostedStoreOrUnavailable(
        takeOverBrowserTab(tab.id, context.userId, heldUntil, now),
      );
      if (taken) yield* browserActed(context.userId, agent.id, SERVER_AGENT_TOOL.BROWSER_TAKEOVER);
      return yield* tabAnswer(context.userId, place, tabId);
    }),
    handBack: member.handBack.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input);
      const { tab, agent } = yield* reachedTab(context.userId, place, tabId);
      const released = yield* hostedStoreOrUnavailable(handBackBrowserTab(tab.id, context.userId));
      if (released) {
        yield* browserActed(context.userId, agent.id, SERVER_AGENT_TOOL.BROWSER_HANDBACK);
      }
      return yield* tabAnswer(context.userId, place, tabId);
    }),
  };
}
