/**
 * turn-counts.ts -- how many chat posts and plan notes a native agent's turn under way has taken, read from the store, so eve's per-turn caps hold over MCP too.
 *
 * Eve keeps each count in its session's state, keyed by the turn's id
 * (`apps/dev/session-prompt.ts`), and hands it to the door, which refuses a
 * call past the cap (`../coder-host/chat.ts`'s `postAsAgent`,
 * `../coder-host/plan-edit.ts`'s `recordPlanEdit`). The MCP server keeps no
 * session, so each call reads what the turn under way has already taken:
 * the turn is the one the native projection holds open, from the moment it
 * opened (`../native-events/native-projection.ts`), and its takings are the
 * messages the agent's member posted since then, and the notes its saves
 * since then journaled on the plan. A turn the projection holds no opening
 * of, or a read that failed, counts nothing, so a passing store failure
 * costs a cap, never a post or a note.
 *
 * Note that two calls of one step run at once each read the count before
 * either lands, as eve's reservation would not let them, so a step's last
 * parallel calls may pass the cap by their own number.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { agentPostsSince } from "@luke/database/models/chat-store";
import { readCodingAgentHeaderOfConversation } from "@luke/database/models/coding-agent-store";
import { readNativeProjection } from "@luke/database/models/native-projection-store";
import { readTask } from "@luke/database/models/task-store";
import type { PlanAgentEdit } from "@luke/features/plan-template";
import { causeKind } from "@luke/runtime/effect";
import { Effect, Option } from "effect";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import { heldProjection } from "../native-events/native-projection.js";

/** What the counts read: the turn's opening and the agent behind the conversation, each none where it is not to be had. */
function turnAndAgent(admitted: AdmittedConversation) {
  const { userId, conversationId } = admitted.target;
  return Effect.gen(function* () {
    const saved = yield* readNativeProjection(admitted.target);
    const opened = Option.flatMapNullishOr(saved, (held) => heldProjection(held).turn?.openedAt);
    if (Option.isNone(opened)) return Option.none();
    const agent = yield* readCodingAgentHeaderOfConversation(userId, conversationId);
    return Option.map(agent, (header) => ({ openedAt: opened.value, agent: header }));
  });
}

/** A count read for a call, or nothing where it could not be read, which is logged by its kind alone. */
function countedOrNone<E, R>(what: string, read: Effect.Effect<number, E, R>) {
  return Effect.catchCause(read, (cause) =>
    Effect.as(
      Effect.logWarning(`a native turn's ${what} were not counted: ${causeKind(cause)}`),
      0,
    ),
  );
}

/** How many notes the agent's saves journaled on the plan from the moment given, each picture one, as eve counts them. */
export function notesSince(
  journal: readonly PlanAgentEdit[],
  agentId: string,
  since: number,
): number {
  return journal
    .filter((edit) => edit.agentId === agentId && edit.at >= since)
    .reduce((taken, edit) => taken + edit.notes.length, 0);
}

/** How many chat messages the agent has posted in the native turn under way. */
export function postsInTurn(
  admitted: AdmittedConversation,
): Effect.Effect<number, never, DatabaseServices> {
  return countedOrNone(
    "chat posts",
    Effect.flatMap(
      turnAndAgent(admitted),
      Option.match({
        onNone: () => Effect.succeed(0),
        onSome: ({ openedAt, agent }) => agentPostsSince(agent.id, new Date(openedAt)),
      }),
    ),
  );
}

/** How many plan notes the agent has taken in the native turn under way, read from the plan's journal as the member whose turn this is. */
export function notesInTurn(
  admitted: AdmittedConversation,
): Effect.Effect<number, never, DatabaseServices> {
  return countedOrNone(
    "plan notes",
    Effect.flatMap(
      turnAndAgent(admitted),
      Option.match({
        onNone: () => Effect.succeed(0),
        onSome: ({ openedAt, agent }) => {
          const { id, taskId } = agent;
          if (taskId === null) return Effect.succeed(0);
          return Effect.map(readTask(admitted.caller, taskId), (task) =>
            Option.match(task, {
              onNone: () => 0,
              onSome: (stored) => notesSince(stored.agentEdits, id, openedAt),
            }),
          );
        },
      }),
    ),
  );
}
