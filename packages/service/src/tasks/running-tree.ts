/**
 * running-tree.ts -- a pilot tree's Running switched off stops every agent of the tree, its top pilot among them, and switched on resumes the ones it stopped.
 *
 * A pilot task's top task carries the tree's running switch (`task.running`),
 * which a member switches from the task's head (`tasks-procedures.ts`). Off,
 * every agent standing on a task of the tree, at any depth, has its turn
 * under way stopped as a member's Stop stops it (`stoppedTurn`), under the
 * switching member's authority, the top task's own pilot among them, which
 * is told nothing of it: a note would only wake it again. Each Stop eve took is
 * written on its turn as the switch's (`turns.cancel_requested_for_running`), so no
 * starter is told of it (`starter-notices.ts`): the whole tree stopped at
 * once, and a pilot woken per agent would only start its tree again. On,
 * every agent whose newest turn the switch stopped is told to carry on by
 * Luke, once, under the key of the turn it resumes from, but the top task's
 * pilot, which the switch's own notice wakes (`pilot-switch-notice.ts`), so
 * it is woken once rather than twice; an agent the switch
 * found idle, one whose turn ended before eve took the Stop, or one stopped
 * some other way, is left as it stands.
 *
 * Both run once the switch is written, and an agent that could not be stopped
 * or told is logged and left, never failing the switch, whose answer is the
 * value the task now holds.
 */

import { type Agent, listAgentsOfTree } from "@luke/database/models/agent-store";
import { LUKE_LINE_METADATA, type StoreWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/features/agent-wire";
import { Effect } from "effect";
import { steerAgentWritten } from "../agents/coder-host/steer.js";
import {
  type EveReach,
  eveActingFor,
  standingsOf,
  stoppedTurn,
} from "../agents/coder-host/stop.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";
import { pilotOf } from "./pilot-switch-notice.js";

/** What an agent the switch stopped is told when Running is switched on again. */
const RUNNING_RESUME_MESSAGE =
  "Running is on again. Carry on where you stopped, and first re-read your pull request's " +
  "reviews, comments, and checks, since nothing woke you while stopped.";

/** How many agents the switch stops or tells at once: under the web pool's five connections, as a task's archive stops its agents. */
const RUNNING_TREE_CONCURRENCY = 3;

/** The failure's kind alone, logged under `what`: nothing of the task, the agent, or its member rides the log. */
const logged =
  (what: string) => (failure: { readonly error: string } | { readonly _tag: string }) =>
    Effect.logWarning(`running switch: ${what}`, {
      failure: "error" in failure ? failure.error : failure._tag,
    });

/** The agents of the top task `taskId`'s tree: every one standing on it or under it. */
const treeAgents = (userId: string, taskId: string) =>
  hostedStoreOrUnavailable(listAgentsOfTree(userId, taskId));

/** Every agent of the top task `taskId`'s tree stopped, its pilot among them, as the member `userId`'s Stop stops each, a few at once. */
export function stopRunningTree(
  reach: EveReach,
  request: Request,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  taskId: string,
) {
  return treeAgents(userId, taskId).pipe(
    Effect.flatMap((agents) =>
      Effect.forEach(
        agents,
        (agent) =>
          stoppedTurn(reach, writer, request, userId, agent, { forRunning: true }).pipe(
            Effect.catch(logged("an agent was not stopped")),
          ),
        { concurrency: RUNNING_TREE_CONCURRENCY, discard: true },
      ),
    ),
    Effect.catch(logged("the tree's agents were not read")),
  );
}

/**
 * The agent told to carry on, as Luke tells it, under the key of the turn
 * the switch stopped. Note that the line goes as the deployment acting for
 * the agent's starter, as a starter notice goes, never as the member who
 * switched: an agent on its starter's own GitHub token or Mac takes words
 * from its starter alone (`controlsAgent`), and a teammate's switch must
 * resume it all the same.
 */
const resumed = (
  writer: Effect.Effect<StoreWriter>,
  reach: EveReach,
  agent: Agent,
  stoppedTurnId: string,
) =>
  Effect.gen(function* () {
    const eve = yield* eveActingFor<EveTypedTurn>(reach, agent.userId);
    yield* steerAgentWritten(eve, writer, agent.userId, agent, {
      text: RUNNING_RESUME_MESSAGE,
      clientKey: stoppedTurnId,
      sender: { kind: MESSAGE_SENDER.LUKE },
      metadata: LUKE_LINE_METADATA,
    });
  }).pipe(Effect.catch(logged("an agent was not resumed")));

/** Every agent of the top task `taskId`'s tree but its pilot, as the member `userId` reads it, whose newest turn the switch stopped told to carry on, a few at once. */
export function resumeRunningTree(
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  taskId: string,
) {
  return Effect.gen(function* () {
    const tree = yield* treeAgents(userId, taskId);
    // The pilot is woken by the switch's own notice, so it hears no resume beside it.
    const pilot = pilotOf(tree.filter((agent) => agent.taskId === taskId));
    const agents = tree.filter((agent) => agent.id !== pilot?.id);
    const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
    yield* Effect.forEach(
      agents,
      (agent) => {
        const turn = standing(agent.conversationId).turn;
        return turn?.cancelRequestedForRunning === true
          ? resumed(writer, reach, agent, turn.id)
          : Effect.void;
      },
      { concurrency: RUNNING_TREE_CONCURRENCY, discard: true },
    );
  }).pipe(Effect.catch(logged("the tree's agents were not read")));
}
