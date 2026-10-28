/**
 * agent-browser-tabs-procedures.ts -- the Browser tabs open in coding agents' browsers, for a member's window: list one agent's or a task's, open one in an agent's browser, and take one over and hand it back.
 *
 * `GET /api/agents/{id}/browser-tabs` lists one agent's tabs, on a task or
 * on none, and `GET /api/plans/{id}/browser-tabs` a task's, every one of
 * its agents' together, each with the coding agent whose browser holds it,
 * and the member driving it while their takeover stands. `POST
 * /api/plans/{id}/browser-tabs/{tab}/driver` takes the tab over for
 * `BROWSER_TAKEOVER_HOLD_MS`, or moves the member's own takeover on by as
 * much, so a window that went away leaves the tab to its agent once that
 * passes; `DELETE` hands it back. Each answers the tab as it then stands,
 * so a tab another member drives answers them as its driver.
 *
 * `POST /api/agents/{id}/browser-tabs` opens a page at an http or https
 * address in the agent's browser, and `POST /api/plans/{id}/browser-tabs`
 * in the browser of a coding agent on the task, as a member does to
 * sign in somewhere for it: the agent's sandbox is held through the
 * terminal's lease first, as the live view holds it, so a sandbox the open
 * resumes is not stopped under the sign-in; the browser is reached through
 * `connectRestoring`, which resumes a stopped sandbox and reopens its kept
 * tabs; and the tab is kept with the member as its opener and taken over
 * for them at once, so the agent does not act on it until they hand it
 * back. An agent that has opened no sandbox yet is refused as not ready,
 * and a browser that could not be reached as the upstream's refusal; the
 * address is never logged, a failure only by its kind.
 *
 * Who reaches a tab is the rule every agent route keeps: a member who sees
 * the coding agent whose browser holds it
 * (`@luke/database/models/agent-browser-tabs`), whether the path names the
 * agent or the task it is on; any other reads as not found. A desktop built
 * before the agent's paths still names the task, which answers as it did. Driving a tab acts in the agent's browser, so it is held to who
 * controls the agent (`controlsAgent`): its starter alone for one on the
 * starter's own GitHub token. The agents' own writes go through the store
 * from inside the service and have no route here.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  handBackBrowserTab,
  listBrowserTabs,
  type ReachedBrowserTab,
  readBrowserTab,
  recordMemberOpenedBrowserTab,
  takeOverBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import {
  type AgentBrowserTab,
  agentBrowserTabOf,
  type BrowserTabsPlace,
} from "@luke/features/agent-browser-tab-wire";
import { isBrowserAddress } from "@luke/features/browser-acts";
import { DateTime, Duration, Effect, type Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import { BROWSER_LIVE_BOUNDS } from "../browser-live/bounds.js";
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

/** How long a takeover stands past the member's last take or renewal: long enough for a window's renewals to miss one, short enough that a closed one hands the tab back soon. */
export const BROWSER_TAKEOVER_HOLD_MS = 60_000;

/**
 * How long an open holds the agent's sandbox: the live view's idle bound and
 * the minute until its next write (`browser-live/bounds.ts`), since the
 * member's window opens the tab's live view at once, whose own lease takes
 * over within seconds; one that never attaches is stopped by the lease
 * sweep once this lapses.
 */
const OPEN_HOLD = Duration.sum(BROWSER_LIVE_BOUNDS.IDLE, BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY);

export interface AgentBrowserTabsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The agents' browsers as an open reaches them: Vercel's sandboxes in production, a script's in a test. */
  readonly agentBrowser: Layer.Layer<AgentBrowser, never, HttpClient.HttpClient>;
}

/** A reached tab as the wire carries it, its driver only while their takeover stands at `now`, its cursor once its agent pointed at it. */
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

/** The tab of the place named, where the member reaches it; not found otherwise. */
const reachedTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
): Effect.fn.Return<ReachedBrowserTab, HostedRefusal, DatabaseServices> {
  const reached = yield* hostedStoreOrUnavailable(readBrowserTab(userId, place, tabId));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return reached.value;
});

/** The task and the tab a driver's path names, read as ids; not found for one that is no UUID. */
const tabPath = /* @__PURE__ */ Effect.fnUntraced(function* (params: {
  readonly id: string;
  readonly tab: string;
}) {
  return { place: { taskId: yield* pathUuid(params.id) }, tabId: yield* pathUuid(params.tab) };
});

/** The tab as it stands after a write, read again under the member's reach; not found where it closed meanwhile. */
const tabAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
) {
  const reached = yield* reachedTab(userId, place, tabId);
  return { tab: browserTabOf(reached, yield* DateTime.nowAsDate) };
});

/** The place's tabs, the oldest first, as the wire carries them; not found where the member reaches no such agent or task. */
const listedTabs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
) {
  const listed = yield* hostedStoreOrUnavailable(listBrowserTabs(userId, place));
  if (Option.isNone(listed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const now = yield* DateTime.nowAsDate;
  return { tabs: listed.value.map((reached) => browserTabOf(reached, now)) };
});

/**
 * The coding agent an open names, where the member reaches it and controls
 * it, and where a task is named, it is on that task, with the eve session
 * its sandbox is tagged with; not found for an agent of another task, and
 * not ready for one that has run no sandbox yet.
 */
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
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  if (session === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  return { conversationId: agent.conversationId, sessionId: session.sessionId };
});

/**
 * Opens the page in the agent's browser, reached through `connectRestoring`
 * for this call alone, and answers its target. A browser whose agent has
 * opened no sandbox is not ready; one that could not be reached, or that
 * would not open the page, is the upstream's refusal, logged by its kind.
 */
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

/**
 * The member's open: the agent reached, on the task named where one is, and
 * its sandbox held, the page opened, kept with the member as its opener,
 * and taken over for them, then answered as it stands under their reach.
 */
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
  // Note that the page is kept at the address asked, its title too, until the agent's next look at it
  // reads the page's own, and the member stands as its opener though the agent's `list` wrote it first.
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
  return yield* tabAnswer(userId, { agentId: open.agentId }, tab.id);
});

/** The Browser tabs resource: an agent's or a task's tabs, an open, a takeover, and a hand-back, each to a signed-in member who reaches them. */
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
      // Note that a tab another member drives is answered as it stands, their takeover named, rather than refused.
      yield* hostedStoreOrUnavailable(takeOverBrowserTab(tab.id, context.userId, heldUntil, now));
      return yield* tabAnswer(context.userId, place, tabId);
    }),
    handBack: member.handBack.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input);
      const { tab } = yield* reachedTab(context.userId, place, tabId);
      yield* hostedStoreOrUnavailable(handBackBrowserTab(tab.id, context.userId));
      return yield* tabAnswer(context.userId, place, tabId);
    }),
  };
}
