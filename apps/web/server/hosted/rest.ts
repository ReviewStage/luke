import { describeWire } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  TURN_REST_REASON,
  type TurnRestReason,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";

/**
 * rest.ts -- the planning model's `rest` tool: nothing worth doing remains until the developer speaks again.
 *
 * Between the developer's words the voice service keeps the planning model
 * working, one turn after another, and this is how the model says to stop.
 * eve ends the turn on the call (`endsTurn`), and the call does nothing when
 * it runs: as with `end_call`, the store journals its input before it runs,
 * so the voice's follow reads the reason off the journal
 * (`projectTurnEvents`) and the service sets the backend working again only
 * once the developer next speaks.
 */

const REST_INPUT = Schema.Struct({
  reason: describeWire(
    Schema.Literals(Object.values(TURN_REST_REASON)),
    `Why you are resting: "${TURN_REST_REASON.PLAN_COMPLETE}" once the plan is complete, ` +
      `"${TURN_REST_REASON.WAITING_ON_DEVELOPER}" when what is left turns on the developer's ` +
      `answers, or "${TURN_REST_REASON.NOTHING_NEW}" when more work would turn up nothing new.`,
  ),
});

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readRest = Schema.decodeUnknownResult(REST_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const REST_TOOL = {
  name: "rest",
  description:
    "Stop working until the developer speaks again. Call it alone, and only when nothing " +
    "worth doing remains: the plan is complete, what is left turns on answers Luke is " +
    "waiting for, or more reading and research would turn up nothing new. A message with " +
    "no tool call also ends your turn, but only this tells Luke you have nothing more. " +
    "Answers `accepted`, or `rejected` for an unreadable call.",
  inputSchema: REST_INPUT,
} as const;

/** The reason a journaled call rests for, or nothing for a call whose input is still streaming in or does not read. */
export function restReasonOf(part: StoredToolPart): TurnRestReason | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readRest(part.input))?.reason;
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runRest(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readRest(input))
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not rested: the reason is unreadable." }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}
