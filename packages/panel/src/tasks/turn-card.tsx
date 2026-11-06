import {
  TURN_ENDING,
  type TurnEnding,
  type TurnRecord,
  type TurnTokens,
} from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import { formatCount } from "@repo/features/number-format";
import { runSpanText } from "@repo/features/time-format";
import {
  HoverCard,
  type HoverCardFigure,
  HoverCardFigures,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
} from "@repo/ui";
import { HarnessMark } from "../harness-marks.js";
import { providerOf } from "./agent-model.js";
import { ModelLabel } from "./model-label.js";

const ENDING_WORD = {
  [TURN_ENDING.STOPPED]: "Stopped",
  [TURN_ENDING.FAILED]: "Failed",
  [TURN_ENDING.ABANDONED]: "Failed",
} as const satisfies Record<TurnEnding, string>;

const ENDING_NOTE = {
  [TURN_ENDING.STOPPED]: undefined,
  [TURN_ENDING.FAILED]: undefined,
  [TURN_ENDING.ABANDONED]: "Ran out of time.",
} as const satisfies Record<TurnEnding, string | undefined>;

const FAST_REFUSED_NOTE = "Fast wasn't available, so this ran at standard speed.";

const TOKEN_ROW = {
  INPUT: "Input",
  OUTPUT: "Output",
  CACHE_READ: "Cache read",
  CACHE_WRITE: "Cache write",
} as const;

const TOKENS_LABEL = "Tokens";

const UNRECORDED_EFFORT = "";

interface RunEnding {
  readonly reason: string;
  readonly word: string;
  readonly note?: string;
}

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

function turnEnding(ending: TurnEnding): RunEnding {
  const note = ENDING_NOTE[ending];
  return {
    reason: ending,
    word: ENDING_WORD[ending],
    ...(note === undefined ? undefined : { note }),
  };
}

function RunCard({
  model,
  startedAt,
  endedAt,
  now,
  ending,
  note,
  figures,
}: {
  model:
    | { readonly id: string; readonly effort: string; readonly models: readonly CatalogModel[] }
    | undefined;
  startedAt: number;
  endedAt: number;
  now: number;
  ending: RunEnding | undefined;
  note: string | undefined;
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

export function TurnCard({
  startedAt,
  endedAt,
  now,
  record,
  models,
}: {
  startedAt: number;
  endedAt: number;
  now: number;
  record: TurnRecord;
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
