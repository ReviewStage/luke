import type { MessageStreamEvent } from "eve/client";
import {
  REPOSITORY_SHELL_STATUS,
  RUN_IN_REPOSITORY_TOOL,
} from "../../server/hosted/repository-shell";
import { stampedEveEvent } from "./eve-events";

/**
 * Whole turns as eve emits them, for the tests that drive one through the
 * relay into the store: a spoken ask's turn that reads the repository and
 * answers in two sentences. Synthetic throughout; one spelling shared by
 * every suite that plays a turn rather than a copy per file.
 */

/** eve's id for a session's first turn. */
export const FIRST_EVE_TURN = "turn_0";

/** The command the turn runs in the repository. */
const REPOSITORY_COMMAND = "git log --oneline -5";

/** One spoken ask's turn: a repository read, which is a slow step, then a two-sentence answer. */
export function spokenTurn(
  turnId: string,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const sequence = 0;
  return [
    stampedEveEvent({ type: "turn.started", data: { turnId, sequence } }, now, deliveryIds),
    stamped({ type: "message.received", data: { turnId, sequence, message: "what changed?" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: RUN_IN_REPOSITORY_TOOL.name,
            input: { command: REPOSITORY_COMMAND },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          output: { status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason: "No sandbox." },
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "One agent finished. Another is waiting on you.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}
