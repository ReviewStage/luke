import { useAtomValue } from "@effect/atom-react/Hooks";
import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import type { RolloutItem } from "@sidecar/hosted/plan-wire";
import { WORKER_REPORT_KIND } from "@sidecar/hosted/rollout-wire";
import { Clock, Duration, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { LayersIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { useCopyToast } from "../copy-feedback";
import { EmptyState } from "../empty-state";
import { rendererRuntime } from "../renderer-runtime";
import { PublishedChip, type PublishedDoors } from "./agent-published";
import { PUBLISHED_REREAD_MS } from "./coding-agent-model";
import { ModelLabel } from "./model-label";
import {
  keeperStateWords,
  type StackCard,
  type StackColumn,
  type StackKeeper,
  stackAgents,
  stackBaseWords,
  stackKeeper,
  stackLayout,
  stackPositionLabel,
  stackStateWords,
  stackWorking,
} from "./stack-model";
import { AgentGlyph } from "./tab-look";

/**
 * stack-tab.tsx -- the plan's Stack tab: its rollout's pull requests and the coding agents working them, drawn as one stack.
 *
 * The tab stands in the plan's column while its rollout names more than one
 * pull request (`use-main-tabs.ts`). It draws a column per depth from main
 * and a card per position (`stack-model.ts`): the position and its title,
 * its base, its worker's glyph and model, the chip of the pull request the
 * worker published, and where it stands in a word, with the question its
 * worker asked and the answers it offered, or the block it hit, under the
 * card. A press of a card with a worker chooses the worker's tab; one with
 * none does nothing. Above the cards stands the rollout's keeper, the agent
 * that links, restacks, and merges the stack and is never a card: its glyph,
 * its model, and where it stands in a word, a press choosing its tab; with
 * no keeper started, nothing stands there. The tab acts on nothing itself: a worker is stopped on
 * its own tab, and merges and answers are said to Luke, who runs the
 * rollout.
 *
 * The cards are the plan's agents list as it was last read, which carries
 * each pull request as its row last kept it, so the tab asks GitHub
 * nothing. It asks the list to be read again every `PUBLISHED_REREAD_MS`
 * while any worker or the keeper is at work, the pace an agent's own tab rereads its pull
 * request at, and once as any worker's status changes, which is when what
 * it published and reported is most likely to have moved.
 */

/** What the plan's Stack tab is called. */
export const STACK_TAB_LABEL = "Stack";

/** What the tab says while the plan's rollout holds nothing to stack, the moment before the tab leaves. */
const NOTHING_STACKED = "Each pull request of the rollout will stand here.";

/** What the header calls the rollout's keeper. */
const KEEPER_LABEL = "Stack keeper";

/** No agents read yet, one array so a render that has none hands down the same one. */
const NO_AGENTS: readonly CodingAgentSummary[] = [];

/** The time now, and again each reread's pace after, while a worker of the rollout is at work. */
const stackRereadTicks: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(Duration.millis(PUBLISHED_REREAD_MS)),
);

const stackRereadAtom = rendererRuntime.atom(stackRereadTicks);

/** The Stack tab's glyph, on its tab and over its empty ground alike. */
export function StackGlyph(): React.JSX.Element {
  return <LayersIcon />;
}

/**
 * Asks the list to be read again on each tick past the first, for as long
 * as it is mounted, which is while a worker is at work. Note that the first
 * tick is the moment it mounted, when the list was just read.
 */
function StackReread({ onRead }: { onRead: () => void }): null {
  const at = AsyncResult.getOrElse(useAtomValue(stackRereadAtom), () => undefined);
  const latest = useRef(onRead);
  latest.current = onRead;
  const first = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (at === undefined) return;
    first.current ??= at;
    if (at !== first.current) latest.current();
  }, [at]);
  return null;
}

/** What stands under a card while its worker waits: the question and the answers it offered, or the block. */
function Waiting({ card }: { card: StackCard }): React.JSX.Element | null {
  const { waiting } = card;
  if (waiting === null) return null;
  const asks = waiting.kind === WORKER_REPORT_KIND.QUESTION;
  return (
    <div
      className="flex flex-col gap-1 border-border border-t px-3 pt-2 pb-2.5 text-foreground"
      data-stack-waiting={waiting.kind}
    >
      <span className="text-[11.5px] text-muted-foreground">{asks ? "Asks" : "Blocked"}</span>
      <p className="m-0 whitespace-pre-wrap">{waiting.text}</p>
      {waiting.options === undefined ? null : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {waiting.options.map((option) => (
            <li
              key={option}
              className="rounded-md bg-secondary px-2 py-0.5 text-[12px]"
              data-stack-option=""
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A card's face: the position and title, its base and state, and its worker's glyph and model. */
function CardFace({
  card,
  models,
}: {
  card: StackCard;
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const { worker } = card;
  return (
    <>
      <span className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground tabular-nums">
          {stackPositionLabel(card.position)}
        </span>
        <span className="font-medium text-foreground" data-stack-title="">
          {card.item.title}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span>{stackBaseWords(card.item.base)}</span>
        <span aria-hidden="true">·</span>
        <span data-stack-state={card.state}>{stackStateWords(card)}</span>
      </span>
      {worker === undefined ? null : (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <AgentGlyph agent={worker} />
          <ModelLabel choice={{ model: worker.model, effort: worker.effort }} models={models} />
        </span>
      )}
    </>
  );
}

/** One position's card: a press of its face chooses its worker's tab, and its pull request's chip opens the pull request. */
function StackCardView({
  card,
  models,
  doors,
  onChoose,
}: {
  card: StackCard;
  models: readonly CatalogModel[];
  doors: PublishedDoors;
  onChoose: (agentId: string) => void;
}): React.JSX.Element {
  const { worker, published } = card;
  const face = "flex w-full flex-col items-start gap-1 px-3 pt-2.5 pb-2 text-left";
  return (
    <article
      className="w-64 shrink-0 overflow-clip rounded-lg border border-border bg-muted text-[12.5px]"
      data-stack-position={card.position}
    >
      <div className="flex items-start">
        {worker === undefined ? (
          <div className={face}>
            <CardFace card={card} models={models} />
          </div>
        ) : (
          <button
            type="button"
            className={`${face} transition-colors hover:bg-secondary`}
            onClick={() => onChoose(worker.id)}
          >
            <CardFace card={card} models={models} />
          </button>
        )}
        {published === null ? null : (
          <span className="shrink-0 pt-2 pr-2">
            {/* The chip opens the pull request alone, so it needs no branch. */}
            <PublishedChip
              published={{ repository: "", branch: null, pullRequest: published }}
              doors={doors}
            />
          </span>
        )}
      </div>
      <Waiting card={card} />
    </article>
  );
}

/** The header over the cards: the rollout's keeper, its glyph, model, and state, a press choosing its tab. */
function KeeperHeader({
  keeper,
  models,
  onChoose,
}: {
  keeper: StackKeeper;
  models: readonly CatalogModel[];
  onChoose: (agentId: string) => void;
}): React.JSX.Element {
  const { agent } = keeper;
  return (
    <div className="flex px-(--content-inset) pt-(--section-gap)">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary"
        data-stack-keeper={agent.id}
        onClick={() => onChoose(agent.id)}
      >
        <AgentGlyph agent={agent} />
        <span className="font-medium text-foreground">{KEEPER_LABEL}</span>
        <ModelLabel choice={{ model: agent.model, effort: agent.effort }} models={models} />
        <span aria-hidden="true">·</span>
        <span data-stack-state={keeper.state}>{keeperStateWords(keeper)}</span>
      </button>
    </div>
  );
}

/** The stack as laid out: the keeper's header where one is started, then a column per depth from main, each holding its groups of positions on one base. */
export function StackView({
  columns,
  keeper,
  models,
  doors,
  onChoose,
}: {
  columns: readonly StackColumn[];
  keeper: StackKeeper | undefined;
  models: readonly CatalogModel[];
  doors: PublishedDoors;
  onChoose: (agentId: string) => void;
}): React.JSX.Element {
  if (columns.length === 0) return <EmptyState icon={<StackGlyph />}>{NOTHING_STACKED}</EmptyState>;
  return (
    <div className="stack-tab ph-no-capture flex min-h-0 flex-1 flex-col">
      {keeper === undefined ? null : (
        <KeeperHeader keeper={keeper} models={models} onChoose={onChoose} />
      )}
      <StackBoard columns={columns} models={models} doors={doors} onChoose={onChoose} />
    </div>
  );
}

/** The columns themselves. */
function StackBoard({
  columns,
  models,
  doors,
  onChoose,
}: {
  columns: readonly StackColumn[];
  models: readonly CatalogModel[];
  doors: PublishedDoors;
  onChoose: (agentId: string) => void;
}): React.JSX.Element {
  return (
    <div className="stack-board flex min-h-0 flex-1 gap-6 overflow-auto px-(--content-inset) pt-(--section-gap) pb-5">
      {columns.map((column, depth) => (
        <div
          // A column is its depth from main, and holds no identity beyond it.
          key={depth}
          className="flex shrink-0 flex-col gap-4"
          data-stack-depth={depth}
        >
          {column.map((group) => (
            <div key={group.base} className="flex flex-col gap-2" data-stack-base={group.base}>
              {group.cards.map((card) => (
                <StackCardView
                  key={card.position}
                  card={card}
                  models={models}
                  doors={doors}
                  onChoose={onChoose}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * What the Stack tab shows in the column: the plan's `rollout` laid out over
 * `agents`, its agents as last read, none before the first read lands.
 * `onChoose` chooses a worker's tab, and `onReadAgain` asks the list to be
 * read again.
 */
export function StackTab({
  rollout,
  agents,
  models,
  onChoose,
  onReadAgain,
}: {
  rollout: readonly RolloutItem[];
  agents: readonly CodingAgentSummary[] | undefined;
  models: readonly CatalogModel[];
  onChoose: (agentId: string) => void;
  onReadAgain: () => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const copy = useCopyToast();
  const held = agents ?? NO_AGENTS;
  const columns = useMemo(() => stackLayout(rollout, held), [rollout, held]);
  const keeper = useMemo(() => stackKeeper(held), [held]);
  // A builder's or the keeper's status, by its id, as the list or its own tab last said it.
  const statuses = useMemo(
    () => new Map(stackAgents(held).map((agent) => [agent.id, agent.status])),
    [held],
  );
  const seen = useRef<ReadonlyMap<string, CodingAgentSummary["status"]> | undefined>(undefined);
  useEffect(() => {
    const was = seen.current;
    seen.current = statuses;
    if (was === undefined) return;
    const moved = [...statuses].some(([id, status]) => was.has(id) && was.get(id) !== status);
    if (moved) onReadAgain();
  }, [statuses, onReadAgain]);
  return (
    <>
      {stackWorking(held) ? <StackReread onRead={onReadAgain} /> : null}
      <StackView
        columns={columns}
        keeper={keeper}
        models={models}
        doors={{ openGitHub: (url) => tell(ACT_KIND.GITHUB_OPEN, { url }), copy }}
        onChoose={onChoose}
      />
    </>
  );
}
