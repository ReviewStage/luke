import type { StoredTurnRecord } from "@luke/database/models/message-reads";
import {
  isSettledToolPartState,
  isStoredToolPart,
  replySentences,
  SLOW_STEP_KIND,
  type StoredToolPart,
  type StoredUIMessage,
  storedToolName,
  TURN_END,
  TURN_EVENT_KIND,
  TURN_STATUS,
  type TurnEnd,
  type TurnEvent,
  type TurnEventBody,
  type TurnStatus,
  UI_PART_TYPE,
} from "../core.js";
import { END_CALL_TOOL, endsCall } from "../tasks/end-call.js";
import {
  QUEUE_QUESTION_TOOL,
  queuedQuestionOf,
  WITHDRAW_QUESTION_TOOL,
  withdrawnQuestionOf,
} from "../tasks/queue-question.js";
import { SHOW_CODE_TOOL, shownCodeOf } from "../tasks/show-code.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";

/**
 * One turn's run seams as the voice session hears them while the turn runs:
 * a slow step began, a brain call queued a question, every action
 * settled, one sentence of the reply, the turn ended. They are not rows of
 * their own: the store keeps the turn row and the turn's journal, the
 * assistant message the writer opens under the turn's id and amends as each
 * call is written ahead of its run, and the events are a projection over
 * those two, read again on every poll. A turn is projected the same way
 * whichever backend ran it, the task's brain or an agent a call speaks into,
 * since both journal their calls under the registry's names
 * (`agent-runtime/tools.ts`). The projection only grows while the
 * turn runs, because the journal only gains parts and the turn row only
 * moves forward, so the events a reader heard stay where they were numbered
 * and the ones it has not heard come after. A turn that did not complete
 * numbers its end past every event it could have told, since the sentences
 * it released while it ran leave the journal with its words as it ends, so a
 * reader past what the shortened projection holds still hears the end. The
 * end is the last event of every turn.
 *
 * A spoken ask that joined an agent's typed turn under way hears only the
 * steps that turn began after it joined, so a call into an agent an hour
 * into a pull request is never read the hour's words, and its run is
 * answered, and ends, once one of those steps said something and the step
 * after it began, since the turn it joined may run on for that hour. The
 * agent's going back to its work is no news to the call, so a slow step is
 * told only ahead of that answer.
 */

/** How a terminal turn status reads to a client telling a reply from a refusal; nothing for a turn still under way. */
const TURN_END_OF_STATUS = {
  [TURN_STATUS.SETTLED]: TURN_END.COMPLETED,
  [TURN_STATUS.CANCELLED]: TURN_END.CANCELLED,
  [TURN_STATUS.FAILED]: TURN_END.FAILED,
  [TURN_STATUS.QUEUED]: undefined,
  [TURN_STATUS.RUNNING]: undefined,
} as const satisfies Record<TurnStatus, TurnEnd | undefined>;

/** The turn as the projection reads it: which it is and where it stands. */
type ProjectedTurn = Pick<StoredTurnRecord, "id" | "status">;

type JournalParts = StoredUIMessage["parts"];

/**
 * The number a turn that did not complete ends at: past any number the turn
 * could have told before it ended, because the sentences it released while
 * it ran leave the journal with the rest of its words, so its end can no
 * longer be counted from what the journal still holds.
 */
const UNANSWERED_TURN_END_SEQ = Number.MAX_SAFE_INTEGER;

type JournalPart = JournalParts[number];

/** The journal cut at its step boundaries, each step's parts in the order they were journaled; what precedes the first boundary stands as a step of its own. */
function stepsOf(parts: JournalParts): readonly (readonly JournalPart[])[] {
  const steps: JournalPart[][] = [[]];
  for (const part of parts) {
    if (part.type === UI_PART_TYPE.STEP_START) steps.push([]);
    else steps.at(-1)?.push(part);
  }
  return steps;
}

/** A step's words: every text part of it, in order; the words the voice speaks. */
function replyTextOf(parts: readonly JournalPart[]): string {
  return parts.flatMap((part) => (part.type === UI_PART_TYPE.TEXT ? [part.text] : [])).join("\n");
}

/** The calls that run a shell command in a checkout: an agent's own shell. */
const SLOW_STEP_TOOLS: ReadonlySet<string> = new Set([AGENT_TOOL.BASH]);

/**
 * What one call tells while the turn runs: a question a brain call queued
 * or withdrew, code it showed, its ask to end the call, or a shell command
 * in a checkout, the one slow step. A queued or withdrawn question or an end is told
 * once its input is whole, never while it streams, and
 * shown code once its call has answered with the lines, so none is told
 * twice.
 */
function callEventOf(part: StoredToolPart): TurnEventBody | undefined {
  const name = storedToolName(part);
  if (name === QUEUE_QUESTION_TOOL.name) {
    const queued = queuedQuestionOf(part);
    return queued === undefined ? undefined : { kind: TURN_EVENT_KIND.QUESTION_QUEUED, ...queued };
  }
  if (name === WITHDRAW_QUESTION_TOOL.name) {
    const question = withdrawnQuestionOf(part);
    return question === undefined
      ? undefined
      : { kind: TURN_EVENT_KIND.QUESTION_WITHDRAWN, question };
  }
  if (name === END_CALL_TOOL.name) {
    return endsCall(part) ? { kind: TURN_EVENT_KIND.CALL_ENDING } : undefined;
  }
  if (name === SHOW_CODE_TOOL.name) {
    const shown = shownCodeOf(part);
    return shown === undefined
      ? undefined
      : { kind: TURN_EVENT_KIND.CODE_SHOWN, callId: part.toolCallId, code: shown };
  }
  return SLOW_STEP_TOOLS.has(name)
    ? { kind: TURN_EVENT_KIND.SLOW_STEP, step: SLOW_STEP_KIND.REPOSITORY_READ }
    : undefined;
}

/**
 * The journal from the step after the first `afterStep` steps on, which is
 * what a spoken ask that joined the turn there hears: its steps' boundaries
 * and parts, nothing of the steps before it; the whole journal where the
 * ask is its whole turn's (`afterStep` absent).
 */
export function journalAfterStep(
  journal: StoredUIMessage | undefined,
  afterStep: number | undefined,
): StoredUIMessage | undefined {
  if (journal === undefined || afterStep === undefined) return journal;
  let begun = 0;
  for (const [index, part] of journal.parts.entries()) {
    if (part.type !== UI_PART_TYPE.STEP_START) continue;
    begun += 1;
    if (begun > afterStep) return { ...journal, parts: journal.parts.slice(index) };
  }
  return { ...journal, parts: [] };
}

/**
 * The turn's events as the record now stands, numbered from one, walked
 * step by step: a step's sentences, then what its calls tell. The slow step
 * and the end of the call, once per run each, every question a brain call
 * queued, and all the code it showed, are told the
 * moment their call is on the journal, the code once its call has answered. A sentence is
 * told while the turn still runs once every call journaled ahead of its step
 * has settled, behind one settled mark, so nothing is said ahead of an action
 * whose result is not on record; the first sentence held back holds back
 * everything after it, so the numbering only grows. Note that a step's words
 * go ahead of its own calls, because eve tells a step's words before the
 * calls it requests and the journal only gains words at a sentence's end.
 * A completed turn tells every sentence and then its end, the settled mark
 * standing ahead of them even where it said nothing. A cancelled or failed
 * turn tells no sentence, since its words leave the journal at its end; what
 * it released while it ran was said, and its end is numbered past it. Given
 * `joinedAfterStep`, the place a spoken ask joined a typed turn at, the
 * events are those of the steps after it alone, numbered from one, and the
 * first of them that says something is the ask's answer: its words and the
 * code it showed are told, and once a later step began the run completes,
 * the turn still running or not.
 */
export function projectTurnEvents(
  turn: ProjectedTurn,
  journal: StoredUIMessage | undefined,
  joinedAfterStep?: number,
): readonly TurnEvent[] {
  const end = TURN_END_OF_STATUS[turn.status];
  const speaks = end === undefined || end === TURN_END.COMPLETED;
  const joined = joinedAfterStep !== undefined;
  const steps = stepsOf(journalAfterStep(journal, joinedAfterStep)?.parts ?? []);
  const bodies: TurnEventBody[] = [];
  let slowStepTold = false;
  let endTold = false;
  let settledTold = false;
  let unsettled = false;
  let answered = false;
  for (const [index, step] of steps.entries()) {
    const sentences = speaks ? replySentences(replyTextOf(step)) : [];
    // A turn that completed has everything it did on record, whatever its calls' parts say.
    if (sentences.length > 0 && unsettled && end === undefined) break;
    if (sentences.length > 0 && !settledTold) {
      settledTold = true;
      bodies.push({ kind: TURN_EVENT_KIND.ACTIONS_SETTLED });
    }
    for (const sentence of sentences)
      bodies.push({ kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence });
    // A joined ask's answer is the first step after the join that says something.
    const answering = joined && sentences.length > 0;
    for (const part of step) {
      if (!isStoredToolPart(part)) continue;
      if (!isSettledToolPartState(part.state)) unsettled = true;
      const told = callEventOf(part);
      if (told === undefined) continue;
      if (told.kind === TURN_EVENT_KIND.SLOW_STEP && (slowStepTold || answering)) continue;
      if (told.kind === TURN_EVENT_KIND.CALL_ENDING && endTold) continue;
      slowStepTold ||= told.kind === TURN_EVENT_KIND.SLOW_STEP;
      endTold ||= told.kind === TURN_EVENT_KIND.CALL_ENDING;
      bodies.push(told);
    }
    if (answering) {
      answered = index < steps.length - 1;
      break;
    }
  }
  const ended = end ?? (answered ? TURN_END.COMPLETED : undefined);
  if (ended === TURN_END.COMPLETED && !settledTold) {
    bodies.push({ kind: TURN_EVENT_KIND.ACTIONS_SETTLED });
  }
  const events: TurnEvent[] = bodies.map((body, index) => ({
    ...body,
    turnId: turn.id,
    seq: index + 1,
  }));
  if (ended === undefined) return events;
  const seq = ended === TURN_END.COMPLETED ? events.length + 1 : UNANSWERED_TURN_END_SEQ;
  return [...events, { kind: TURN_EVENT_KIND.ENDED, end: ended, turnId: turn.id, seq }];
}
