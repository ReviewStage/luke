import {
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "@luke/features/agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { formatCount } from "@luke/features/number-format";
import { runSpanText } from "@luke/features/time-format";
import {
  HoverCard,
  type HoverCardFigure,
  HoverCardFigures,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
} from "@luke/ui";
import { HarnessMark } from "../harness-marks.js";
import { providerOf } from "./agent-model.js";
import { ModelLabel } from "./model-label.js";

/**
 * turn-card.tsx -- the card a finished turn's "Worked for" line hangs while the pointer rests on it: what the turn ran on, when, how it ended, and what it spent.
 *
 * The line says how long a turn worked and when it ended; the card says
 * the rest a developer reaches for once they wonder what a turn cost or
 * ran on, as Codex's turn footers do. Its head is the
 * model and effort the turn ran on as every place draws the pair
 * (`model-label.tsx`), wearing its provider's mark as read from the
 * model's id, as a subagent's row and an agent's tab do, with when the
 * turn ran and for how long under it, on one line ("Today, 2:32 – 3:42 PM
 * · 1h 10m"), and at its right how the turn ended where it did not simply
 * answer, with why as a sentence under the head where the word alone does
 * not say. Under the head, a quiet line where
 * Anthropic refused a fast step of the turn, which then ran at standard
 * speed, as Claude Code says when it falls back from fast mode. Then, under
 * a hairline, its tokens: the input the model read fresh, the output it
 * wrote, the input its prefix cache answered, and, where the provider said
 * it, the input written to that cache, as a card's figures
 * (`HoverCardFigures`). Only what the turn's row
 * recorded is said: a turn from before the record, or whose model counted
 * nothing, has no token rows, and no placeholder stands in for one. No
 * price is said, since a developer on their own key pays at their
 * provider's rate, not the catalog's.
 */

/** What the card's corner says for how a turn ended. */
const ENDING_WORD = {
  [TURN_ENDING.STOPPED]: "Stopped",
  [TURN_ENDING.FAILED]: "Failed",
  [TURN_ENDING.ABANDONED]: "Failed",
} as const satisfies Record<TurnEnding, string>;

/** The sentence under the head where the corner's word alone leaves the reader asking why; a swept turn failed by running out of time. */
const ENDING_NOTE = {
  [TURN_ENDING.STOPPED]: undefined,
  [TURN_ENDING.FAILED]: undefined,
  [TURN_ENDING.ABANDONED]: "Ran out of time.",
} as const satisfies Record<TurnEnding, string | undefined>;

/** The line a turn says where a fast step of it ran at standard speed instead. */
const FAST_REFUSED_NOTE = "Fast wasn't available, so this ran at standard speed.";

/** The token rows, in the order the card lists them. */
const TOKEN_ROW = {
  INPUT: "Input",
  OUTPUT: "Output",
  CACHE_READ: "Cache read",
  CACHE_WRITE: "Cache write",
} as const;

/** What the card's figures are, for a reader. */
const TOKENS_LABEL = "Tokens";

/** The effort a turn whose row recorded none says, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/** How a run ended where it did not simply answer: the reason its record names, and the word its corner says. */
interface RunEnding {
  readonly reason: string;
  readonly word: string;
  /** Why, in a line under the head, where the word alone does not say. */
  readonly note?: string;
}

/**
 * A turn's tokens as the card lists them. Note that the input the row
 * counts holds what the cache answered and what was written to it, so the
 * input row says the rest, and the rows add up to what the model read and
 * wrote. The cache's writes have a row only where the provider said them.
 */
function tokenRows(tokens: TurnTokens): readonly HoverCardFigure[] {
  const read = Math.min(tokens.cachedInputTokens, tokens.inputTokens);
  const written = Math.min(tokens.cacheWriteTokens ?? 0, tokens.inputTokens - read);
  const rows: HoverCardFigure[] = [
    { label: TOKEN_ROW.INPUT, figure: formatCount(tokens.inputTokens - read - written) },
    { label: TOKEN_ROW.OUTPUT, figure: formatCount(tokens.outputTokens) },
    { label: TOKEN_ROW.CACHE_READ, figure: formatCount(read) },
  ];
  if (tokens.cacheWriteTokens !== undefined) {
    rows.push({ label: TOKEN_ROW.CACHE_WRITE, figure: formatCount(written) });
  }
  return rows;
}

/** A turn's ending as the card says it: the corner's word, and its reason where it has one. */
function turnEnding(ending: TurnEnding): RunEnding {
  const note = ENDING_NOTE[ending];
  return {
    reason: ending,
    word: ENDING_WORD[ending],
    ...(note === undefined ? undefined : { note }),
  };
}

/**
 * A turn's card: the model it ran on at the head,
 * wearing its provider's mark as read from the model's id, so a model the
 * catalog does not list wears it too, and no mark for a provider Luke runs
 * nothing on; when it ran under the model, or as the head itself where no
 * model is on record; how it ended at the head's right; a note; and its
 * figures under a rule.
 */
function RunCard({
  model,
  startedAt,
  endedAt,
  now,
  ending,
  note,
  figures,
}: {
  /** The model and effort it ran on, and the catalog as last read, which names the model; nothing where the record holds none. */
  model:
    | { readonly id: string; readonly effort: string; readonly models: readonly CatalogModel[] }
    | undefined;
  startedAt: number;
  endedAt: number;
  /** What its day is named from: "Today" where it ran on `now`'s. */
  now: number;
  ending: RunEnding | undefined;
  note: string | undefined;
  /** What the figures are, for a reader, and their rows; nothing where none is on record. */
  figures: { readonly label: string; readonly rows: readonly HoverCardFigure[] } | undefined;
}): React.JSX.Element {
  const provider = model === undefined ? undefined : providerOf(model.id);
  const when = (
    <time dateTime={new Date(startedAt).toISOString()}>{runSpanText(startedAt, endedAt, now)}</time>
  );
  return (
    <HoverCard data-turn-card="">
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
      {ending?.note === undefined ? null : <HoverCardNote>{ending.note}</HoverCardNote>}
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
      {figures === undefined ? null : (
        <>
          <HoverCardRule />
          <HoverCardFigures label={figures.label} figures={figures.rows} />
        </>
      )}
    </HoverCard>
  );
}

/** The card a finished turn hangs: the model and how the turn ended, when it ran, and its tokens where its row counted them. */
export function TurnCard({
  startedAt,
  endedAt,
  now,
  record,
  models,
}: {
  startedAt: number;
  endedAt: number;
  /** What the turn's day is named from, as the line hanging the card names it. */
  now: number;
  record: TurnRecord;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const { model, effort, tokens, ending, fastRefused } = record;
  return (
    <RunCard
      model={
        model === undefined ? undefined : { id: model, effort: effort ?? UNRECORDED_EFFORT, models }
      }
      startedAt={startedAt}
      endedAt={endedAt}
      now={now}
      ending={ending === undefined ? undefined : turnEnding(ending)}
      note={fastRefused === true ? FAST_REFUSED_NOTE : undefined}
      figures={tokens === undefined ? undefined : { label: TOKENS_LABEL, rows: tokenRows(tokens) }}
    />
  );
}
