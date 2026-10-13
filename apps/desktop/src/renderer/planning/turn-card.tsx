import {
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { HarnessMark } from "../provider-marks";
import { providerOf } from "./coding-agent-model";
import { ModelLabel } from "./model-label";
import { spanText } from "./plan-time";

/**
 * turn-card.tsx -- the card a finished turn's "Worked for" line hangs while the pointer rests on it: what the turn ran on, when, how it ended, and the tokens it spent.
 *
 * The line says how long a turn worked and when it ended; the card says
 * the rest a developer reaches for once they wonder what a turn cost or
 * ran on, as Conductor's and Codex's turn footers do. Its head is the
 * model and effort the turn ran on as every place draws the pair
 * (`model-label.tsx`), wearing its provider's mark as read from the
 * model's id, as a subagent's row and an agent's tab do, so a coding
 * agent's turn, Luke's own on the Call tab, and a call's card
 * (`call-card.tsx`) all wear it alike; and at its right how the turn ended
 * where it did not simply answer. Under it, when the turn began and ended,
 * in full. Then, under a hairline, its tokens: the input the model read
 * fresh, the output it wrote, the input its prefix cache answered, and,
 * where the provider said it, the input written to that cache, each label
 * muted at the start and its count at the end in tabular figures. Only what the turn's row recorded is said: a turn from before
 * the record, or whose model counted nothing, has no token rows, and no
 * placeholder stands in for one. No price is said, since a developer on
 * their own key pays at their provider's rate, not the catalog's.
 */

/** What the card's corner says for how a turn ended. */
const ENDING_WORD = {
  [TURN_ENDING.STOPPED]: "Stopped",
  [TURN_ENDING.FAILED]: "Failed",
  [TURN_ENDING.ABANDONED]: "Abandoned",
} as const satisfies Record<TurnEnding, string>;

/** The token rows, in the order the card lists them. */
const TOKEN_ROW = {
  INPUT: "Input",
  OUTPUT: "Output",
  CACHE_READ: "Cache read",
  CACHE_WRITE: "Cache write",
} as const;

type TokenRow = (typeof TOKEN_ROW)[keyof typeof TOKEN_ROW];

const COUNT = new Intl.NumberFormat("en-US");

/** The effort a turn whose row recorded none says, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/**
 * A turn's tokens as the card lists them. Note that the input the row
 * counts holds what the cache answered and what was written to it, so the
 * input row says the rest, and the rows add up to what the model read and
 * wrote. The cache's writes have a row only where the provider said them.
 */
function tokenRows(tokens: TurnTokens): readonly (readonly [TokenRow, number])[] {
  const read = Math.min(tokens.cachedInputTokens, tokens.inputTokens);
  const written = Math.min(tokens.cacheWriteTokens ?? 0, tokens.inputTokens - read);
  const rows: [TokenRow, number][] = [
    [TOKEN_ROW.INPUT, tokens.inputTokens - read - written],
    [TOKEN_ROW.OUTPUT, tokens.outputTokens],
    [TOKEN_ROW.CACHE_READ, read],
  ];
  if (tokens.cacheWriteTokens !== undefined) rows.push([TOKEN_ROW.CACHE_WRITE, written]);
  return rows;
}

/**
 * The head's model: its provider's mark, read from the model's id as a
 * subagent's row and an agent's tab read it, so a model the catalog does not
 * list wears it too, then the model and effort as every place names them.
 * No mark for a model of a provider Luke runs nothing on.
 */
export function TurnModel({
  model,
  effort,
  models,
}: {
  model: string;
  effort: string;
  /** The catalog as last read, which names the model; empty before the first read lands, or where the model is none a coding agent runs on. */
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const provider = providerOf(model);
  return (
    <span className="turn-card-model">
      {provider === undefined ? null : (
        <span className="turn-card-harness" data-harness={provider}>
          <HarnessMark provider={provider} />
        </span>
      )}
      <ModelLabel choice={{ model, effort }} models={models} />
    </span>
  );
}

/** The card: the model and how the turn ended, when it ran, and its tokens where its row counted them. */
export function TurnCard({
  startedAt,
  endedAt,
  record,
  models,
}: {
  startedAt: number;
  endedAt: number;
  record: TurnRecord;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const { model, effort, tokens, ending } = record;
  return (
    <div className="turn-card" data-turn-card="">
      {model === undefined && ending === undefined ? null : (
        <div className="turn-card-head">
          {model === undefined ? null : (
            <TurnModel model={model} effort={effort ?? UNRECORDED_EFFORT} models={models} />
          )}
          {ending === undefined ? null : (
            <span className="turn-card-ending" data-ending={ending}>
              {ENDING_WORD[ending]}
            </span>
          )}
        </div>
      )}
      <p className="turn-card-when">
        <time dateTime={new Date(startedAt).toISOString()}>{spanText(startedAt, endedAt)}</time>
      </p>
      {tokens === undefined ? null : (
        <dl className="turn-card-tokens" aria-label="Tokens">
          {tokenRows(tokens).map(([label, count]) => (
            <div key={label} className="turn-card-token">
              <dt>{label}</dt>
              <dd>{COUNT.format(count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
