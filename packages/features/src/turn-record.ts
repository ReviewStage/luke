/**
 * turn-record.ts -- what a turn ran on and spent, read off its row as a turn's footer card says it.
 *
 * Every turn row names the model eve resolved it to and the effort it ran
 * at where its session named one, and once it settles, the tokens its steps
 * summed and how it ended; and whether Anthropic refused a fast step of it,
 * which then ran at standard speed. A tab draws those on the card its "Worked for"
 * line hangs, so the reads that answer a tab's turns carry them beside the
 * turn's span: a coding agent's journals, read by the service's page and by
 * the host from the transcript's live window alike. A leaf over the row
 * alone, so it reads nothing.
 */

import { TURN_STATUS } from "@luke/wire";
import { Option, Schema } from "effect";
import { BRAIN_REQUEST_FAILURE } from "./brain/requests.js";
import {
  CODING_AGENT_BOUNDS,
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "./coding-agent-wire.js";
import { catalogIdOf } from "./model-label.js";

/** The row's fields a record is read from. */
export interface RecordedTurn {
  readonly status: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly usage: unknown;
  readonly failure: string | null;
  readonly fastRefused: boolean;
}

/** The counts of a turn's `usage` column a record reads; the column carries more beside them. */
const RecordedUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
});

const decodeUsage = Schema.decodeUnknownOption(RecordedUsageSchema);

/** A recorded name the wire carries: one it bounds, and nothing for an empty or overlong one. */
function choiceOf(recorded: string | null): string | undefined {
  return recorded === null ||
    recorded === "" ||
    recorded.length > CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS
    ? undefined
    : recorded;
}

/** How the turn ended where it did not simply answer; nothing for one that did or still runs. */
function endingOf(turn: RecordedTurn): TurnEnding | undefined {
  if (turn.status === TURN_STATUS.CANCELLED) return TURN_ENDING.STOPPED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  return turn.failure === BRAIN_REQUEST_FAILURE.ABANDONED
    ? TURN_ENDING.ABANDONED
    : TURN_ENDING.FAILED;
}

/** The turn's tokens as its row summed them, or nothing where it recorded none or a shape this build cannot read. */
function tokensOf(turn: RecordedTurn): TurnTokens | undefined {
  if (turn.usage === null) return undefined;
  const usage = decodeUsage(turn.usage);
  if (Option.isNone(usage)) return undefined;
  const { inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens } = usage.value;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ...(cacheWriteTokens === undefined ? undefined : { cacheWriteTokens }),
  };
}

/** What the turn ran on and spent, each as far as its row recorded it. */
export function turnRecordOf(turn: RecordedTurn): TurnRecord {
  const model = choiceOf(turn.model === null ? null : catalogIdOf(turn.model));
  const effort = choiceOf(turn.reasoningEffort);
  const tokens = tokensOf(turn);
  const ending = endingOf(turn);
  return {
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
    ...(tokens === undefined ? undefined : { tokens }),
    ...(ending === undefined ? undefined : { ending }),
    ...(turn.fastRefused ? { fastRefused: true } : undefined),
  };
}
