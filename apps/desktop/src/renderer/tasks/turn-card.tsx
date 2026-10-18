import {
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { spanText } from "@luke/panel/tasks/task-time";
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardRule } from "@luke/ui";
import { HarnessMark } from "../harness-marks";
import { providerOf } from "./coding-agent-model";
import { ModelLabel } from "./model-label";

/**
 * turn-card.tsx -- the card a finished turn's "Worked for" line hangs while the pointer rests on it, and a call's closing line hangs too: what the run ran on, when, how it ended, and what it spent.
 *
 * The line says how long a turn worked and when it ended; the card says
 * the rest a developer reaches for once they wonder what a turn cost or
 * ran on, as Conductor's and Codex's turn footers do. Its head is the
 * model and effort the turn ran on as every place draws the pair
 * (`model-label.tsx`), wearing its provider's mark as read from the
 * model's id, as a subagent's row and an agent's tab do, with when the
 * turn began and ended, in full, under it, and at its right how the turn
 * ended where it did not simply answer. Under the head, a quiet line where
 * Anthropic refused a fast step of the turn, which then ran at standard
 * speed, as Claude Code says when it falls back from fast mode. Then, under
 * a hairline, its tokens: the input the model read fresh, the output it
 * wrote, the input its prefix cache answered, and, where the provider said
 * it, the input written to that cache, each label muted at the start and
 * its count at the end in tabular figures. Only what the turn's row
 * recorded is said: a turn from before the record, or whose model counted
 * nothing, has no token rows, and no placeholder stands in for one. No
 * price is said, since a developer on their own key pays at their
 * provider's rate, not the catalog's.
 *
 * A call's card (`call-card.tsx`) is this card (`RunCard`), its voice model
 * at the head and the seconds the Live API metered under the rule.
 */

/** What a run's card is of, which its root names. */
export const RUN_CARD = {
  TURN: "turn",
  CALL: "call",
} as const;

type RunCardKind = (typeof RUN_CARD)[keyof typeof RUN_CARD];

/** What the card's corner says for how a turn ended. */
const ENDING_WORD = {
  [TURN_ENDING.STOPPED]: "Stopped",
  [TURN_ENDING.FAILED]: "Failed",
  [TURN_ENDING.ABANDONED]: "Abandoned",
} as const satisfies Record<TurnEnding, string>;

/** The line a turn says where a fast step of it ran at standard speed instead. */
const FAST_REFUSED_NOTE = "Fast wasn't available, so this ran at standard speed";

/** The token rows, in the order the card lists them. */
const TOKEN_ROW = {
  INPUT: "Input",
  OUTPUT: "Output",
  CACHE_READ: "Cache read",
  CACHE_WRITE: "Cache write",
} as const;

/** What the card's figures are, for a reader. */
const TOKENS_LABEL = "Tokens";

const COUNT = new Intl.NumberFormat("en-US");

/** The effort a turn whose row recorded none says, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/** One row under a run card's rule: what it counts, and the count as the card says it. */
export type RunFigure = readonly [label: string, said: string];

/** How a run ended where it did not simply answer or hang up: the reason its record names, and the word its corner says. */
export interface RunEnding {
  readonly reason: string;
  readonly word: string;
}

/**
 * A turn's tokens as the card lists them. Note that the input the row
 * counts holds what the cache answered and what was written to it, so the
 * input row says the rest, and the rows add up to what the model read and
 * wrote. The cache's writes have a row only where the provider said them.
 */
function tokenRows(tokens: TurnTokens): readonly RunFigure[] {
  const read = Math.min(tokens.cachedInputTokens, tokens.inputTokens);
  const written = Math.min(tokens.cacheWriteTokens ?? 0, tokens.inputTokens - read);
  const rows: RunFigure[] = [
    [TOKEN_ROW.INPUT, COUNT.format(tokens.inputTokens - read - written)],
    [TOKEN_ROW.OUTPUT, COUNT.format(tokens.outputTokens)],
    [TOKEN_ROW.CACHE_READ, COUNT.format(read)],
  ];
  if (tokens.cacheWriteTokens !== undefined) {
    rows.push([TOKEN_ROW.CACHE_WRITE, COUNT.format(written)]);
  }
  return rows;
}

/**
 * A run's card, a turn's or a call's: the model it ran on at the head,
 * wearing its provider's mark as read from the model's id, so a model the
 * catalog does not list wears it too, and no mark for a provider Luke runs
 * nothing on; when it ran under the model, or as the head itself where no
 * model is on record; how it ended at the head's right; a note; and its
 * figures under a rule.
 */
export function RunCard({
  kind,
  model,
  startedAt,
  endedAt,
  ending,
  note,
  figures,
}: {
  kind: RunCardKind;
  /** The model and effort it ran on, and the catalog as last read, which names the model; nothing where the record holds none. */
  model:
    | { readonly id: string; readonly effort: string; readonly models: readonly CatalogModel[] }
    | undefined;
  startedAt: number;
  endedAt: number;
  ending: RunEnding | undefined;
  note: string | undefined;
  /** What the figures are, for a reader, and their rows; nothing where none is on record. */
  figures: { readonly label: string; readonly rows: readonly RunFigure[] } | undefined;
}): React.JSX.Element {
  const provider = model === undefined ? undefined : providerOf(model.id);
  const when = (
    <time dateTime={new Date(startedAt).toISOString()}>{spanText(startedAt, endedAt)}</time>
  );
  return (
    <HoverCard data-run-card={kind}>
      <HoverCardHead
        glyph={provider === undefined ? undefined : <HarnessMark provider={provider} />}
        name={
          model === undefined ? (
            when
          ) : (
            <ModelLabel choice={{ model: model.id, effort: model.effort }} models={model.models} />
          )
        }
        sub={model === undefined ? undefined : when}
        corner={
          ending === undefined ? undefined : <span data-ending={ending.reason}>{ending.word}</span>
        }
      />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
      {figures === undefined ? null : (
        <>
          <HoverCardRule />
          <dl className="run-card-figures" aria-label={figures.label}>
            {figures.rows.map(([label, said]) => (
              <div key={label} className="run-card-figure">
                <dt>{label}</dt>
                <dd>{said}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </HoverCard>
  );
}

/** The card a finished turn hangs: the model and how the turn ended, when it ran, and its tokens where its row counted them. */
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
  const { model, effort, tokens, ending, fastRefused } = record;
  return (
    <RunCard
      kind={RUN_CARD.TURN}
      model={
        model === undefined ? undefined : { id: model, effort: effort ?? UNRECORDED_EFFORT, models }
      }
      startedAt={startedAt}
      endedAt={endedAt}
      ending={ending === undefined ? undefined : { reason: ending, word: ENDING_WORD[ending] }}
      note={fastRefused === true ? FAST_REFUSED_NOTE : undefined}
      figures={tokens === undefined ? undefined : { label: TOKENS_LABEL, rows: tokenRows(tokens) }}
    />
  );
}
