import { TURN_STATUS } from "@repo/wire";
import { Option, Schema } from "effect";
import {
  AGENT_BOUNDS,
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "./agent-wire.js";
import { catalogIdOf } from "./model-label.js";
import { TURN_FAILURE } from "./turn-run/requests.js";

export interface RecordedTurn {
  readonly status: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly usage: unknown;
  readonly failure: string | null;
  readonly fastRefused: boolean;
}

const RecordedUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
});

const decodeUsage = Schema.decodeUnknownOption(RecordedUsageSchema);

function choiceOf(recorded: string | null): string | undefined {
  return recorded === null || recorded === "" || recorded.length > AGENT_BOUNDS.MAX_CHOICE_CHARS
    ? undefined
    : recorded;
}

function endingOf(turn: RecordedTurn): TurnEnding | undefined {
  if (turn.status === TURN_STATUS.CANCELED) return TURN_ENDING.STOPPED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  return turn.failure === TURN_FAILURE.ABANDONED ? TURN_ENDING.ABANDONED : TURN_ENDING.FAILED;
}

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
