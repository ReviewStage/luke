/**
 * device-discard.ts -- an archived local agent let go of on its device: a discard line, which stops its runner and removes its folder.
 *
 * Every archive lets a local agent go here once the archive stands: by hand
 * or by an operator's Reset (`session-sandboxes.ts`'s `stoppedInBackground`),
 * by an automation's sweep of its finished runs, and by an agent's
 * `update_agent`. The line is queued under the agent's runner lease, as
 * every line of its is (`device-agent-store.ts`'s header), and only while the
 * agent still stands archived, read under that lease: an agent unarchived
 * and messaged since queued its launch first, and the discard is left out
 * rather than queued after it. The store queues it only where the agent's
 * device registered `discard` (`DEVICE_AGENT_LINE_CAPABILITY`), since a
 * follower from before the kind fails its whole held read on one; an agent
 * in a sandbox is asked nothing. An agent unarchived after its discard
 * launches again on a fresh worktree of the shared clone, so what it never
 * pushed is gone with its folder.
 */

import { type CodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { queueDeviceAgentLine } from "@luke/database/models/device-agent-store";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@luke/features/device-agent-wire";
import { Effect, Option } from "effect";
import { holdingRunner } from "./coder-host/runner-lease.js";

/** The archived agent's discard line queued to its device, where it runs on one that takes it and still stands archived under its runner lease. */
const discardedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<CodingAgent, "id" | "userId">,
) {
  const read = yield* readCodingAgent(agent.userId, agent.id);
  if (Option.isNone(read) || read.value.machine !== CODING_AGENT_MACHINE.DEVICE) return;
  yield* holdingRunner(
    agent.id,
    Effect.gen(function* () {
      const current = yield* readCodingAgent(agent.userId, agent.id);
      if (Option.isNone(current) || current.value.archivedAt === null) return;
      yield* queueDeviceAgentLine(agent.userId, {
        agentId: agent.id,
        kind: DEVICE_AGENT_LINE_KIND.DISCARD,
        payload: {},
      });
    }),
  );
});

/**
 * As `discardedWhileArchived`, a failure logged by its kind alone and never
 * answered, so an archive never fails on its device: whether nothing failed,
 * so a caller that can ask again later knows to.
 */
export const discardedOrLogged = (agent: Pick<CodingAgent, "id" | "userId">) =>
  discardedWhileArchived(agent).pipe(
    Effect.as(true),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`an archived agent was not discarded from its device: ${failure._tag}`),
        false,
      ),
    ),
  );
