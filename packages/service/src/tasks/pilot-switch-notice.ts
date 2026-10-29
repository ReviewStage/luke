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
 * `MERGE_POLICY_NOTICE_LEAD`, which the pilot's instructions key on. Running
 * switched on is told in one line, `RUNNING_ON_NOTICE`, which the pilot's
 * instructions key on word for word; switched off is told nothing, since the
 * switch stops the pilot with its tree (`running-tree.ts`) and a note would
 * only wake it again.
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
import { LUKE_LINE_METADATA, type StoreWriter } from "@luke/database/models/writer";
import { AGENT_KIND, MESSAGE_SENDER } from "@luke/features/agent-wire";
import { MERGE_POLICY, type MergePolicy } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import { steerAgentWritten } from "../agents/coder-host/steer.js";
import { type EveReach, eveActingFor, eveFor } from "../agents/coder-host/stop.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";

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

/** What the pilot is told when its tree's running switch is switched on, word for word. */
const RUNNING_ON_NOTICE = "Running is now on.";

/** A top task's pilot, of the agents standing on it: its newest standing pilot; none where it has none. */
export function pilotOf(agents: readonly Agent[]): Agent | undefined {
  return agents.findLast((agent) => agent.archivedAt === null && agent.kind === AGENT_KIND.PILOT);
}

/**
 * Tells the pilot of the top task `taskId` the words `noticeOf` makes of the
 * task as it now stands, as the member `userId` said them, and nothing where
 * it makes none; logs and answers nothing where it could not be told. Where
 * `lukeWhereRefused` asks, a pilot that takes no words from the member (one
 * on its starter's own Mac or token, or its starter's plan) is told by Luke
 * instead, as the deployment acting for its starter, as a resume is
 * (`running-tree.ts`).
 */
const tellPilot = /* @__PURE__ */ Effect.fnUntraced(
  function* (
    reach: EveReach,
    request: Request,
    writer: Effect.Effect<StoreWriter>,
    userId: string,
    taskId: string,
    noticeOf: (task: TaskHeader) => string | undefined,
    lukeWhereRefused: boolean,
  ) {
    const pilot = pilotOf(yield* listAgents(userId, taskId));
    const task = yield* readTaskHeader(userId, taskId);
    if (pilot === undefined || Option.isNone(task)) return;
    const text = noticeOf(task.value);
    if (text === undefined) return;
    const clientKey = randomUUID();
    const asMember = Effect.flatMap(eveFor<EveTypedTurn>(reach, request, userId), (eve) =>
      steerAgentWritten(eve, writer, userId, pilot, {
        text,
        clientKey,
        sender: { kind: MESSAGE_SENDER.MEMBER, userId },
      }),
    );
    const asLuke = Effect.flatMap(eveActingFor<EveTypedTurn>(reach, pilot.userId), (eve) =>
      steerAgentWritten(eve, writer, pilot.userId, pilot, {
        text,
        clientKey,
        sender: { kind: MESSAGE_SENDER.LUKE },
        metadata: LUKE_LINE_METADATA,
      }),
    );
    // A refusal of the member writes nothing, so the same key goes again as Luke's.
    yield* asMember.pipe(
      Effect.catch((failure) =>
        lukeWhereRefused &&
        "error" in failure &&
        failure.error === HOSTED_REFUSAL.NOT_PERMITTED.error
          ? asLuke
          : Effect.fail(failure),
      ),
    );
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
    false,
  );
}

/**
 * Tells the pilot of the top task `taskId` that its tree now runs, as the
 * member `userId` said it, or as Luke where the pilot takes no words from
 * them, since this is the one wake a pilot the switch stopped has. Note that
 * the task is read again as the notice goes, so a switch back off
 * meanwhile, which stopped the pilot, wakes it with nothing.
 */
export function tellPilotOfRunning(
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
    (task) => (task.running ? RUNNING_ON_NOTICE : undefined),
    true,
  );
}
