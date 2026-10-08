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
import { QUEUE_QUESTION_TOOL, queuedQuestionOf } from "./queue-question.js";
import { RUN_IN_REPOSITORY_TOOL } from "./repository-shell.js";
import type { StoredTurnRecord } from "./store/index.js";

/**
 * One turn's run seams as the voice session hears them while the turn runs:
 * a slow step began, a planning call queued a question, every action
 * settled, one sentence of the reply, the turn ended. They are not rows of
 * their own: the store keeps the turn row and the turn's journal, the
 * assistant message the writer opens under the turn's id and amends as each
 * call is written ahead of its run, and the events are a projection over
 * those two, read again on every poll. The projection only grows while the
 * turn runs, because the journal only gains parts and the turn row only
 * moves forward, so the events a reader heard stay where they were numbered
 * and the ones it has not heard come after. A turn that did not complete
 * numbers its end past every event it could have told, since the sentences
 * it released while it ran leave the journal with its words as it ends, so a
 * reader past what the shortened projection holds still hears the end. The
 * end is the last event of every turn.
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
export const UNANSWERED_TURN_END_SEQ = Number.MAX_SAFE_INTEGER;

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

/**
 * What one call tells while the turn runs: a question a planning call queued,
 * or a repository command, the one slow step. A queued question is told once
 * its input is whole, never while it streams, so a question is never told
 * twice.
 */
function callEventOf(part: StoredToolPart): TurnEventBody | undefined {
  const name = storedToolName(part);
  if (name === QUEUE_QUESTION_TOOL.name) {
    const queued = queuedQuestionOf(part);
    return queued === undefined ? undefined : { kind: TURN_EVENT_KIND.QUESTION_QUEUED, ...queued };
  }
  return name === RUN_IN_REPOSITORY_TOOL.name
    ? { kind: TURN_EVENT_KIND.SLOW_STEP, step: SLOW_STEP_KIND.REPOSITORY_READ }
    : undefined;
}

/**
 * The turn's events as the record now stands, numbered from one, walked
 * step by step: a step's sentences, then what its calls tell. The slow step,
 * once per run, and every question a planning call queued, are told the
 * moment their call is on the journal. A sentence is
 * told while the turn still runs once every call journaled ahead of its step
 * has settled, behind one settled mark, so nothing is said ahead of an action
 * whose result is not on record; the first sentence held back holds back
 * everything after it, so the numbering only grows. Note that a step's words
 * go ahead of its own calls, because eve tells a step's words before the
 * calls it requests and the journal only gains words at a sentence's end.
 * A completed turn tells every sentence and then its end, the settled mark
 * standing ahead of them even where it said nothing. A cancelled or failed
 * turn tells no sentence, since its words leave the journal at its end; what
 * it released while it ran was said, and its end is numbered past it.
 */
export function projectTurnEvents(
  turn: ProjectedTurn,
  journal: StoredUIMessage | undefined,
): readonly TurnEvent[] {
  const end = TURN_END_OF_STATUS[turn.status];
  const speaks = end === undefined || end === TURN_END.COMPLETED;
  const bodies: TurnEventBody[] = [];
  let slowStepTold = false;
  let settledTold = false;
  let unsettled = false;
  for (const step of stepsOf(journal?.parts ?? [])) {
    const sentences = speaks ? replySentences(replyTextOf(step)) : [];
    // A turn that completed has everything it did on record, whatever its calls' parts say.
    if (sentences.length > 0 && unsettled && end === undefined) break;
    if (sentences.length > 0 && !settledTold) {
      settledTold = true;
      bodies.push({ kind: TURN_EVENT_KIND.ACTIONS_SETTLED });
    }
    for (const sentence of sentences)
      bodies.push({ kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence });
    for (const part of step) {
      if (!isStoredToolPart(part)) continue;
      if (!isSettledToolPartState(part.state)) unsettled = true;
      const told = callEventOf(part);
      if (told === undefined || (told.kind === TURN_EVENT_KIND.SLOW_STEP && slowStepTold)) continue;
      slowStepTold ||= told.kind === TURN_EVENT_KIND.SLOW_STEP;
      bodies.push(told);
    }
  }
  if (end === TURN_END.COMPLETED && !settledTold) {
    bodies.push({ kind: TURN_EVENT_KIND.ACTIONS_SETTLED });
  }
  const events: TurnEvent[] = bodies.map((body, index) => ({
    ...body,
    turnId: turn.id,
    seq: index + 1,
  }));
  if (end === undefined) return events;
  const seq = end === TURN_END.COMPLETED ? events.length + 1 : UNANSWERED_TURN_END_SEQ;
  return [...events, { kind: TURN_EVENT_KIND.ENDED, end, turnId: turn.id, seq }];
}
