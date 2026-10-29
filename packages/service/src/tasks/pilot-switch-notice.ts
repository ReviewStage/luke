/**
 * pilot-switch-notice.ts -- tells a pilot task's pilot that a member switched its merge policy or its running switch, in words its instructions recognize.
 *
 * A pilot task's top task carries two switches for its whole tree: one merge
 * policy (`MERGE_POLICY`), merge on green or hold every pull request for a
 * go, and whether its agents may work (`running`). A member switches either
 * from the task's head, and the pilot is told as a member's words reach it,
 * through `steerAgentWritten`, so it wakes and acts. On hold it has its
 * coding agents cancel any auto-merge they armed, and on merge on green it
 * gives the held pull requests their go; the words open with
 * `MERGE_POLICY_NOTICE_LEAD`, which the pilot's instructions key on. A
 * running switch is told in one line, `RUNNING_NOTICE`'s, which the pilot's
 * instructions and the tree's stop key on word for word.
 *
 * A switch is written before the pilot is told, and the words name the value
 * the task holds as the notice is sent, read again then, so of two switches
 * racing, the notice sent last names the value that stands. A pilot that
 * cannot be told (none standing, eve unreachable, or a member it takes no
 * words from) leaves the switch written and is logged, since the switch's
 * answer is the value the task now holds, which the pilot reads again on its
 * next turn.
 */

import { randomUUID } from "node:crypto";
import { type Agent, listAgents } from "@luke/database/models/agent-store";
import { readTaskHeader, type TaskHeader } from "@luke/database/models/task-store";
import type { StoreWriter } from "@luke/database/models/writer";
import { AGENT_KIND, MESSAGE_SENDER } from "@luke/features/agent-wire";
import { MERGE_POLICY, type MergePolicy } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import { steerAgentWritten } from "../agents/coder-host/steer.js";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";

/** The words every merge-policy notice opens with, which the pilot's instructions recognize. */
export const MERGE_POLICY_NOTICE_LEAD = "Merge policy is now";

/** What the pilot is told for each policy it is switched to. */
export const MERGE_POLICY_NOTICE = {
  [MERGE_POLICY.HOLD]:
    `${MERGE_POLICY_NOTICE_LEAD} hold every PR. Tell your coding agents to cancel any auto-merge ` +
    "they have armed (`gh pr merge --disable-auto`). From now on, each pull request waits for " +
    "the developer's go in a thread once its checks pass.",
  [MERGE_POLICY.MERGE_ON_GREEN]:
    `${MERGE_POLICY_NOTICE_LEAD} merge on green. Give the pull requests held for a go their go ` +
    "now. From now on, pull requests merge on green, except what /orchestrate still holds: " +
    "irreversible changes, open product questions, and UI changes the plan didn't spell out.",
} as const satisfies Record<MergePolicy, string>;

/** What the pilot is told for each side its tree's running switch is switched to, word for word. */
const RUNNING_NOTICE = {
  ON: "Running is now on.",
  OFF: "Running is now off.",
} as const;

/** A top task's pilot: its newest standing pilot; none where it has none. */
function pilotOf(agents: readonly Agent[]): Agent | undefined {
  return agents.findLast((agent) => agent.archivedAt === null && agent.kind === AGENT_KIND.PILOT);
}

/**
 * Tells the pilot of the top task `taskId` the words `noticeOf` makes of the
 * task as it now stands, as the member `userId` said them; logs and answers
 * nothing where it could not be told.
 */
const tellPilot = /* @__PURE__ */ Effect.fnUntraced(
  function* (
    reach: EveReach,
    request: Request,
    writer: Effect.Effect<StoreWriter>,
    userId: string,
    taskId: string,
    noticeOf: (task: TaskHeader) => string,
  ) {
    const pilot = pilotOf(yield* listAgents(userId, taskId));
    const task = yield* readTaskHeader(userId, taskId);
    if (pilot === undefined || Option.isNone(task)) return;
    const eve = yield* eveFor<EveTypedTurn>(reach, request, userId);
    yield* steerAgentWritten(eve, writer, userId, pilot, {
      text: noticeOf(task.value),
      clientKey: randomUUID(),
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  },
  // The failure's kind alone: nothing of the task or its member rides the log.
  Effect.catch((failure) =>
    Effect.logWarning("pilot switch: the pilot was not told", {
      failure: "error" in failure ? failure.error : failure._tag,
    }),
  ),
);

/** Tells the pilot of the top task `taskId` the merge policy the task now holds, as the member `userId` said it. */
export function tellPilotOfMergePolicy(
  reach: EveReach,
  request: Request,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  taskId: string,
) {
  return tellPilot(
    reach,
    request,
    writer,
    userId,
    taskId,
    (task) => MERGE_POLICY_NOTICE[task.mergePolicy],
  );
}

/** Tells the pilot of the top task `taskId` whether its tree now runs, as the member `userId` said it. */
export function tellPilotOfRunning(
  reach: EveReach,
  request: Request,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  taskId: string,
) {
  return tellPilot(reach, request, writer, userId, taskId, (task) =>
    task.running ? RUNNING_NOTICE.ON : RUNNING_NOTICE.OFF,
  );
}
