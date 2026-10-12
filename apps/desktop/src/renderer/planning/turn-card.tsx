import {
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { HarnessMark } from "../provider-marks";
import { ModelLabel } from "./model-label";
import { spanText } from "./plan-time";

/**
 * turn-card.tsx -- the card a finished turn's "Worked for" line hangs while the pointer rests on it: what the turn ran on, when, how it ended, and the tokens it spent.
 *
 * The line says how long a turn worked and when it ended; the card says
 * the rest a developer reaches for once they wonder what a turn cost or
 * ran on, as Conductor's and Codex's turn footers do. Its head is the
 * model and effort the turn ran on as every place draws the pair
 * (`model-label.tsx`), wearing its harness's mark where the catalog lists
 * the model, as a subagent's row does, though not on Luke's own turns,
 * which ran in no harness; and at its right how the turn ended
 * where it did not simply answer. Under it, when the turn began and ended,
 * in full. Then, under a hairline, its tokens: the input the model read
 * fresh, the output it wrote, and the input its prefix cache answered,
 * each label muted at the start and its count at the end in tabular
 * figures. Only what the turn's row recorded is said: a turn from before
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
} as const;

type TokenRow = (typeof TOKEN_ROW)[keyof typeof TOKEN_ROW];

const COUNT = new Intl.NumberFormat("en-US");

/** The effort a turn whose row recorded none says, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/**
 * A turn's tokens as the card lists them. Note that the input the row
 * counts holds what the cache answered, so the input row says the rest,
 * and the three rows add up to what the model read and wrote.
 */
function tokenRows(tokens: TurnTokens): readonly (readonly [TokenRow, number])[] {
  const cached = Math.min(tokens.cachedInputTokens, tokens.inputTokens);
  return [
    [TOKEN_ROW.INPUT, tokens.inputTokens - cached],
    [TOKEN_ROW.OUTPUT, tokens.outputTokens],
    [TOKEN_ROW.CACHE_READ, cached],
  ];
}

/** The model's harness mark, where the catalog lists the model; nothing otherwise. */
function TurnHarness({
  model,
  models,
}: {
  model: string;
  models: readonly CatalogModel[];
}): React.JSX.Element | null {
  const listed = models.find((each) => each.id === model);
  if (listed === undefined) return null;
  return (
    <span className="turn-card-harness" data-harness={listed.provider}>
      <HarnessMark provider={listed.provider} />
    </span>
  );
}

/** The card: the model and how the turn ended, when it ran, and its tokens where its row counted them. */
export function TurnCard({
  startedAt,
  endedAt,
  record,
  models,
  harnessed,
}: {
  startedAt: number;
  endedAt: number;
  record: TurnRecord;
  /** Whether the turn ran in a harness, an agent's or a subagent's, whose mark the model then wears; Luke's own turns ran in none. */
  harnessed: boolean;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const { model, effort, tokens, ending } = record;
  return (
    <div className="turn-card" data-turn-card="">
      {model === undefined && ending === undefined ? null : (
        <div className="turn-card-head">
          {model === undefined ? null : (
            <span className="turn-card-model">
              {harnessed ? <TurnHarness model={model} models={models} /> : null}
              <ModelLabel choice={{ model, effort: effort ?? UNRECORDED_EFFORT }} models={models} />
            </span>
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
