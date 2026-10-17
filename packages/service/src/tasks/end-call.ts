import { Schema } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";

/**
 * end-call.ts -- the brain's `end_call` tool: the developer said they are done, so Luke hangs up.
 *
 * Note that the call does nothing when it runs, as `queue_question` does
 * nothing: the store journals a call's input before it runs, so the voice's
 * follow reads it off the journal mid-turn (`projectTurnEvents`) and the
 * voice service tells the developer's Mac the call is ending. The Mac hangs
 * up through the developer's own stop once Luke's goodbye has finished
 * playing, and keeps the call up if the developer speaks first, so the
 * decision here is only that the developer is done; when the line goes
 * quiet is the Mac's.
 *
 * The call ends its turn (`endsTurn`): the developer is done and Luke is
 * already saying goodbye, so there is nothing for the model to add. Asked
 * for a step after it anyway, the model answers with nothing, as its words
 * tell it to, and eve reads an empty answer as the model failing, retries it
 * once, and fails the turn, which the Call tab then said had failed.
 */

/**
 * The call takes nothing. Note that a call reads when its input is an
 * object, checked as a record rather than through the empty struct, because
 * an empty struct admits any value but null and a string is no call.
 */
const END_CALL_INPUT = Schema.Struct({});

const isEndCallInput = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

/** The tool as the brain is offered it: its name, its words, and its input schema. */
export const END_CALL_TOOL = {
  name: AGENT_TOOL.END_CALL,
  description:
    "End the voice call once the developer asks you to end it or has clearly said they are " +
    'done with it, such as "can you end the call", "bye", "see ya", "that\'s all", "thanks, ' +
    'I\'m done", or "let\'s stop here", even right after another request such as starting a ' +
    "coding agent. Luke is already saying goodbye, so call it first and add nothing to your " +
    'return. Never call it on a bare "okay" or "thanks" mid-conversation, while the developer ' +
    'is still mid-sentence, when they ask for it later ("end the call when the agent ' +
    "finishes\"), or because the plan looks complete. The call hangs up once Luke's goodbye " +
    "has played, and stays up if the developer speaks first. Answers `accepted`.",
  inputSchema: END_CALL_INPUT,
  endsTurn: true,
} as const;

/**
 * Whether a journaled call asks for the end: its input whole and readable.
 * A call whose input is still streaming, or one that does not read, asks
 * for nothing, so a malformed call leaves the call up.
 */
export function endsCall(part: StoredToolPart): boolean {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return false;
  return isEndCallInput(part.input);
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runEndCall(input: UnparsedWireValue): WireRecord {
  return isEndCallInput(input)
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not ended: the call is unreadable." };
}
