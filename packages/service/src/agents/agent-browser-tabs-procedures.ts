/**
 * agent-browser-tabs-procedures.ts -- the Browser tabs open in a task's agents' browsers, for a member's window: list them, and take one over and hand it back.
 *
 * `GET /api/plans/{id}/browser-tabs` lists the task's tabs, each with the
 * coding agent whose browser holds it, and the member driving it while their takeover stands. `POST
 * /api/plans/{id}/browser-tabs/{tab}/driver` takes the tab over for
 * `BROWSER_TAKEOVER_HOLD_MS`, or moves the member's own takeover on by as
 * much, so a window that went away leaves the tab to its agent once that
 * passes; `DELETE` hands it back. Each answers the tab as it then stands,
 * so a tab another member drives answers them as its driver.
 *
 * Who reaches a tab is the rule every agent route keeps: a member who
 * reaches the task, and for a coding agent's tab one who sees that agent
 * (`@luke/database/models/agent-browser-tabs`); any other reads as not
 * found. Driving a tab acts in the agent's browser, so it is held to who
 * controls the agent (`controlsAgent`): its starter alone for one on the
 * starter's own GitHub token. The agents' own writes go through the store
 * from inside the service and have no route here.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  handBackBrowserTab,
  listTaskBrowserTabs,
  type ReachedBrowserTab,
  readTaskBrowserTab,
  takeOverBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { type AgentBrowserTab, agentBrowserTabOf } from "@luke/features/agent-browser-tab-wire";
import { DateTime, Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { controlsAgent, pathUuid } from "./agent-reach.js";

/** How long a takeover stands past the member's last take or renewal: long enough for a window's renewals to miss one, short enough that a closed one hands the tab back soon. */
export const BROWSER_TAKEOVER_HOLD_MS = 60_000;

export interface AgentBrowserTabsProcedureSeams {
  resolveUserId: UserIdResolver;
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

/** The tab the path names, where the member reaches it; not found otherwise. */
const reachedTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  params: { readonly id: string; readonly tab: string },
): Effect.fn.Return<ReachedBrowserTab, HostedRefusal, DatabaseServices> {
  const taskId = yield* pathUuid(params.id);
  const tabId = yield* pathUuid(params.tab);
  const reached = yield* hostedStoreOrUnavailable(readTaskBrowserTab(userId, taskId, tabId));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return reached.value;
});

/** The tab as it stands after a write, read again under the member's reach; not found where it closed meanwhile. */
const tabAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  params: { readonly id: string; readonly tab: string },
) {
  const reached = yield* reachedTab(userId, params);
  return { tab: browserTabOf(reached, yield* DateTime.nowAsDate) };
});

/** The Browser tabs resource: a task's tabs, a takeover, and a hand-back, each to a signed-in member who reaches them. */
export function agentBrowserTabsProcedures(seams: AgentBrowserTabsProcedureSeams) {
  const member = hosted.agentBrowserTabs.use(accountMiddleware(seams.resolveUserId));
  return {
    list: member.list.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const listed = yield* hostedStoreOrUnavailable(listTaskBrowserTabs(context.userId, taskId));
      if (Option.isNone(listed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const now = yield* DateTime.nowAsDate;
      return { tabs: listed.value.map((reached) => browserTabOf(reached, now)) };
    }),
    takeOver: member.takeOver.effect(function* ({ input, context }) {
      const { tab, agent } = yield* reachedTab(context.userId, input);
      if (!controlsAgent(context.userId, agent)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      const now = yield* DateTime.nowAsDate;
      const heldUntil = new Date(now.getTime() + BROWSER_TAKEOVER_HOLD_MS);
      // Note that a tab another member drives is answered as it stands, their takeover named, rather than refused.
      yield* hostedStoreOrUnavailable(takeOverBrowserTab(tab.id, context.userId, heldUntil, now));
      return yield* tabAnswer(context.userId, input);
    }),
    handBack: member.handBack.effect(function* ({ input, context }) {
      const { tab } = yield* reachedTab(context.userId, input);
      yield* hostedStoreOrUnavailable(handBackBrowserTab(tab.id, context.userId));
      return yield* tabAnswer(context.userId, input);
    }),
  };
}
