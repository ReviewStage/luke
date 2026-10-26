/**
 * inbox-item-parts.tsx -- the pieces that draw an Inbox item as the Inbox does, for every place that lists one: its agent's tile, its card, and the marks at its row's end.
 *
 * The Inbox's own list draws an item as a row of its agent's tile, its
 * title, the last word in its thread, and at its end the teammate's face
 * whose agent asks it, the Draft pencil, the attention mark, its task's
 * status and how long ago it changed (`InboxItemEnd`), with the item's card
 * hung beside the row (`InboxItemCard`). ⌘K, the person page, the Next row,
 * and a chip of an item draw those same pieces, so an item reads alike
 * wherever it stands; the list itself composes them in `inbox-list.tsx`.
 */

import {
  INBOX_ASK,
  INBOX_STATUS,
  type InboxItem,
  recommendedLabels,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import type { CatalogModel } from "@luke/features/models-wire";
import {
  Badge,
  cn,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  INLINE_REF_LOOK,
  InlineRef,
  STATUS_TONE,
  TaskStatusMark,
  Time,
  VisuallyHidden,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName, personActor } from "@luke/ui/actor-model";
import {
  CheckIcon,
  CircleIcon,
  GLYPH,
  PenLineIcon,
  SquareCheckIcon,
  SquareIcon,
} from "@luke/ui/icons";
import * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref.js";
import { AttentionMark } from "../attention-mark.js";
import { useAutomation } from "../automation-directory.js";
import { useInboxItemDraft, useInboxItemDrafted } from "../composer-drafts.js";
import { DraftMark } from "../draft-mark.js";
import { useMemberDirectory } from "../member-directory.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref.js";
import { AutomationChipCard, ChipCardSkeleton, TaskChipCard } from "./chip-cards.js";
import { agentStillWriting, providerOf } from "./coding-agent-model.js";
import { HOME_ROW_META } from "./home-row.js";
import {
  holderName,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxKnownAsk,
  type InboxListed,
  inboxCardThread,
  inboxSettledStanding,
  inboxSettledWords,
  inboxShownTicks,
  inboxWaitsOn,
  itemWorkspaceId,
  NEEDS_YOU,
  needsYou as needsYouOf,
  readersItem,
} from "./inbox-model.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PlanGlyph } from "./tab-look.js";
import { TASK_CARD_STANDING, TASK_STATUS_WORDS, TaskKey } from "./task-standing.js";
import { cardTitle, plainWords } from "./tool-call-model.js";
import { useOpenPlace } from "./use-open-link.js";

/** A row's mark before its words, the next item's, which keeps its own size. */
export const INBOX_ROW_MARK = "inbox-row-mark flex flex-none";

/**
 * An item that needs the developer wears the attention mark before its time,
 * a size under a row glyph's, as a sidebar plan wears it, so the disc's edge
 * reads at the time's height.
 */
const INBOX_ROW_ATTENTION =
  "inbox-row-attention inline-flex [&_.attention-mark]:size-luke-12 [&_.attention-mark_svg]:size-attention-glyph-small";

/** What a teammate's open item says to a reader beside their face, which is drawn for the eye alone: it waits on them, not the reader. */
function waitingOn(starter: Actor): string {
  return `Waiting on ${actorName(starter, { sentence: true })}`;
}

/** The tile of an agent the window names nothing of. */
const UNNAMED_AGENT = {
  kind: ACTOR_KIND.AGENT,
  name: "",
  provider: undefined,
  state: ACTOR_STATE.REST,
} as const;

/** The agent that posted an item as its holder names it: the task's summary's line, or main's line for an agent with no task; none where neither holds it. */
function itemSubject(
  holder: InboxHolder,
  agentId: string,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject | undefined {
  if (holder.kind === INBOX_HOLDER.AUTOMATION) {
    const line = holder.agents.get(agentId);
    return line === undefined
      ? undefined
      : tasklessSubject(
          {
            title: line.agentTitle,
            model: line.agentModel,
            automationId: line.automationId,
            automationName: holder.automationId === null ? undefined : holder.name,
          },
          models,
        );
  }
  const line = holder.task.agents?.agents.find((each) => each.id === agentId);
  return line === undefined ? undefined : lineSubject(line, models, readerId);
}

/**
 * The tile of the agent that posted an item, hanging the agent's card and
 * leaving the press to its row; where the holder names no such agent, an
 * archived one say, whose items still stand, a bare tile of the harness
 * read for it on its task (`ReadAgentModel`), and of no known harness
 * while that is read and where nothing is.
 */
export function ItemMark({
  holder,
  agentId,
  models,
  readerId,
  plain = false,
}: {
  holder: InboxHolder;
  agentId: string;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  /** Whether the tile hangs no card of its own, as a row's leading mark does, the row's own card naming the agent instead. */
  plain?: boolean;
}): React.JSX.Element {
  const subject = itemSubject(holder, agentId, models, readerId);
  if (subject === undefined) {
    if (holder.kind !== INBOX_HOLDER.TASK) return <ActorMark actor={UNNAMED_AGENT} />;
    return (
      <ReadAgentModel agentId={agentId} taskId={holder.task.id}>
        {(model) => (
          <ActorMark
            actor={{
              ...UNNAMED_AGENT,
              provider: model === undefined ? undefined : providerOf(model),
            }}
          />
        )}
      </ReadAgentModel>
    );
  }
  return plain ? (
    <ActorMark actor={subject.tile} />
  ) : (
    <AgentMarkRef subject={subject} models={models} />
  );
}

/** Where an item stands, as its row's card says it under its title. */
function standingWords(item: InboxItem, needsYou: boolean, starter: Actor | undefined): string {
  if (needsYou) return NEEDS_YOU.LABEL;
  if (item.status === INBOX_STATUS.OPEN) {
    return starter === undefined ? "Waiting" : waitingOn(starter);
  }
  return inboxSettledStanding(item);
}

/**
 * An Inbox row's card, hung beside the row as a sidebar task's row hangs
 * its task's, so the row's tile hangs none of its own: the card of the
 * thread. It leads with what holds it, a task as its key and its chip,
 * which wears its status, or an automation by its name, as a task's card
 * leads with where it stands; then the item's title and when it last moved; where it stands,
 * waiting on the reader, on a teammate, or settled;
 * the ask in full while one waits, every option with the recommended one
 * marked or every step as the reader's draft ticks it, or how it ended; and
 * the agent's latest words, three lines at most. The agent that asked
 * stands at its foot, the loading spinner beside it while it works.
 */
export function InboxItemCard({
  listed,
  now,
  models,
  readerId,
}: {
  listed: InboxListed;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter, nameOf } = useInboxStanding(listed, readerId);
  const settled = inboxSettledWords(item, nameOf);
  const subject = itemSubject(holder, item.agentId, models, readerId);
  const thread = inboxCardThread(item);
  const ticked = inboxShownTicks(item, useInboxItemDraft(item));
  // Note that a task's row names what each of its agents is doing; an agent with no task carries no such word, and shows no spinner.
  const line =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.agents?.agents.find((each) => each.id === item.agentId)
      : undefined;
  const working = line !== undefined && agentStillWriting(line.status);
  return (
    <HoverCard data-inbox-row-card="">
      <HolderLine holder={holder} workspaceId={itemWorkspaceId(holder, item.agentId)} />
      <HoverCardHead
        name={cardTitle(item.title)}
        sub={
          <>
            {needsYou ? <AttentionMark /> : null}
            <span>{standingWords(item, needsYou, starter)}</span>
          </>
        }
        corner={<Time at={item.updatedAt} now={now} hint={false} />}
      />
      {thread.ask === undefined ? (
        settled === undefined ? null : (
          <HoverCardRow
            look={HOVER_CARD_ROW_LOOK.DETAIL}
            glyph={item.status === INBOX_STATUS.CLOSED ? <GLYPH.DISMISSED /> : <CheckIcon />}
            label={settled}
          />
        )
      ) : (
        <CardAsk ask={thread.ask} ticked={ticked} title={cardTitle(item.title)} />
      )}
      {thread.words === "" ? null : <HoverCardNote>{thread.words}</HoverCardNote>}
      <HoverCardRule />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={
          <ItemMark
            holder={holder}
            agentId={item.agentId}
            models={models}
            readerId={readerId}
            plain
          />
        }
        label={subject?.name ?? UNNAMED_AGENT.name}
        end={working ? <StateGlyph state={GLYPH_STATE.WORKING} /> : undefined}
      />
    </HoverCard>
  );
}

/** The account's workspaces, which tell their readers only as the list moves, not as the tasks beside it do. */
const WORKSPACES = Atom.map(APP_SLICE.TASKS, (tasks) => tasks?.workspaces);

/**
 * What holds an item, as its card leads with it, on one line: a task by its
 * key, as the task's own card leads with it (`TaskKey`), and by its chip
 * as a mention of it is drawn (`HolderRef`), which wears the task's status
 * as its mark, so the card says no status in words; an automation, or the
 * agents no automation names, by their chip alone.
 */
function HolderLine({
  holder,
  workspaceId,
}: {
  holder: InboxHolder;
  workspaceId: string | undefined;
}): React.JSX.Element {
  const workspaces = useAppSlice(WORKSPACES);
  const workspaceName =
    holder.kind === INBOX_HOLDER.TASK
      ? workspaces?.find((each) => each.id === holder.task.workspaceId)?.name
      : undefined;
  return (
    <div className={cn(TASK_CARD_STANDING, "flex-nowrap text-caption-inline")} data-line="one">
      {holder.kind === INBOX_HOLDER.TASK ? (
        <TaskKey workspaceName={workspaceName} number={holder.task.number} />
      ) : null}
      <HolderRef holder={holder} workspaceId={workspaceId} />
    </div>
  );
}

/**
 * What holds an item, named as a mention of it is (`mention-chip.tsx`): a
 * pill of its glyph and its name, cut at its end where the card is too
 * narrow for it. A task's hangs the task's card and opens the task, as a
 * mention of the task does; an automation's hangs its card, read as the
 * card is hung where no directory around it knows the automation yet; the agents no automation names hang their name alone.
 */
function HolderRef({
  holder,
  workspaceId,
}: {
  holder: InboxHolder;
  /** The workspace the item belongs to, in which an automation the window has not read yet is read as its card is hung. */
  workspaceId: string | undefined;
}): React.JSX.Element {
  const openPlace = useOpenPlace();
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  const glyph = <HolderGlyph holder={holder} />;
  const name = holderName(holder);
  const fallback = (
    <HoverCard>
      <HoverCardHead glyph={glyph} name={name} />
    </HoverCard>
  );
  if (holder.kind !== INBOX_HOLDER.TASK) {
    return (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={glyph}
        label={name}
        card={
          holder.automationId === null ? undefined : workspaceId === undefined ? (
            // Note that an older service names no workspace for the item, so only a directory around the card can know the automation.
            known === undefined ? undefined : (
              <AutomationCard {...known} />
            )
          ) : (
            <AutomationChipCard
              automationId={holder.automationId}
              workspace={workspaceId}
              wordsWorkspaceId={workspaceId}
              reading={<ChipCardSkeleton glyph={glyph} name={name} />}
              fallback={fallback}
            />
          )
        }
        data-holder-ref=""
        data-kind={holder.kind}
      />
    );
  }
  const { task } = holder;
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={glyph}
      label={name}
      card={<TaskChipCard taskId={task.id} fallback={fallback} />}
      onPress={
        openPlace === undefined
          ? undefined
          : () => openPlace({ kind: LINK_PLACE.TASK, planId: task.id })
      }
      data-holder-ref=""
      data-kind={holder.kind}
    />
  );
}

/** An open ask as an item's card shows it in full: a choice's options, each recommended one marked; a to-do's steps, ticked as the reader's draft ticks them; or what a form or an answer asks. */
function CardAsk({
  ask,
  ticked,
  title,
}: {
  ask: InboxKnownAsk;
  ticked: readonly number[];
  /** The item's title, which a to-do naming no steps of its own asks as its one step, as its box shows it. */
  title: string;
}): React.JSX.Element {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return (
        <HoverCardList label="Options">
          {ask.options.map((option) => (
            <li key={option.label}>
              <HoverCardRow
                glyph={<CircleIcon aria-hidden="true" />}
                label={option.label}
                end={
                  recommendedLabels(ask).includes(option.label) ? (
                    <Badge tone={STATUS_TONE.ATTENTION}>{RECOMMENDED}</Badge>
                  ) : undefined
                }
              />
            </li>
          ))}
        </HoverCardList>
      );
    case INBOX_ASK.DO:
      return (
        <HoverCardList label="Steps">
          {(ask.steps.length === 0 ? [title] : ask.steps).map((step, at) => (
            <li key={at} data-done={ticked.includes(at) ? "true" : undefined}>
              <HoverCardRow
                glyph={
                  ticked.includes(at) ? (
                    <SquareCheckIcon aria-hidden="true" />
                  ) : (
                    <SquareIcon aria-hidden="true" />
                  )
                }
                label={plainWords(step)}
              />
            </li>
          ))}
        </HoverCardList>
      );
    case INBOX_ASK.ANSWER:
      return (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={<PenLineIcon />}
          label={
            ask.fields === undefined
              ? "Write an answer"
              : `Fill in ${ask.fields.map((field) => field.label).join(", ")}`
          }
        />
      );
  }
}

/** What marks a choice's option the agent recommends, on an item's card. */
const RECOMMENDED = "Recommended";

/**
 * An item's task's status as its row wears it before its time: the
 * status's mark alone, small and quiet, as the task's sidebar row wears
 * it, so a Done task's item reads ✓ and a Canceled one's ×, its words said
 * to a reader and in the row's card (`HolderLine`). Note that it is drawn
 * whatever the status, an item of a finished task staying listed until it
 * is read or answered, and none for an agent with no task, nor for a task
 * from a service before statuses. A row that draws the status elsewhere, on
 * the line naming its task, keeps only its words here (`drawn` off).
 */
function TaskStatusChip({
  holder,
  drawn = true,
}: {
  holder: InboxHolder;
  /** Whether the mark is drawn, or its words alone said to a reader. */
  drawn?: boolean;
}): React.JSX.Element | null {
  if (holder.kind !== INBOX_HOLDER.TASK || holder.task.status === undefined) return null;
  const { status } = holder.task;
  return (
    <span className="inbox-row-task-status inline-flex" data-task-status={status}>
      {drawn ? <TaskStatusMark status={status} /> : null}
      <VisuallyHidden>{TASK_STATUS_WORDS[status]}</VisuallyHidden>
    </span>
  );
}

/**
 * A holder's glyph as a row's chip draws it: a task's status's mark, an
 * automation's clock tile, and the automation glyph for the agents no
 * automation names, as the holder's group header draws them.
 */
export function HolderGlyph({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  if (holder.kind === INBOX_HOLDER.TASK) return <PlanGlyph status={holder.task.status} />;
  if (holder.automationId === null) return <GLYPH.AUTOMATION />;
  return (
    <ActorMark
      actor={
        known === undefined
          ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
          : automationActor(known.automation)
      }
    />
  );
}

/** Where an item stands for the reader, as its row, its card, and its end marks all say it. */
interface InboxStanding {
  /** Whether the item is an open one the reader's own agent asks, which needs their answer. */
  readonly needsYou: boolean;
  /** The teammate whose agent's open item waits on them; none for the reader's own. */
  readonly starter: Actor | undefined;
  /** A member's name as the window says it, the reader's own as You. */
  readonly nameOf: (member: Parameters<typeof personActor>[0]) => string;
}

/** An item's standing for the reader, read as the member directory around the row knows its people. */
export function useInboxStanding(listed: InboxListed, readerId: string | undefined): InboxStanding {
  const { item } = listed;
  const directory = useMemberDirectory();
  const reader = directory.readerId ?? readerId;
  const starter = readersItem(item, reader)
    ? undefined
    : personActor(inboxWaitsOn(item), directory.members, reader, directory.former);
  return {
    needsYou: needsYouOf(listed, reader),
    starter,
    nameOf: (member) => actorName(personActor(member, directory.members, reader, directory.former)),
  };
}

/** An item row's meta, its context, marks, and time in one line at the title's right. */
function InboxRowMeta({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={HOME_ROW_META}>{children}</span>;
}

/**
 * The marks at an item row's end, in the Inbox's own order: the face of the
 * teammate whose agent asks it, the Draft pencil where an answer or message
 * waits unsent in its box and that box is not the one open beside the list,
 * the attention mark where it needs the reader, its task's status, and how
 * long ago it changed. `before` stands ahead of them, as the row's context does, and `after` behind, as a shortcut does.
 * A row that says where its item stands on a line of its own (`standing`
 * off), the Inbox's own, draws neither the attention mark nor the status at
 * its end, a reader still hearing both there.
 */
export function InboxItemEnd({
  listed,
  now,
  readerId,
  open = false,
  standing = true,
  before,
  after,
}: {
  listed: InboxListed;
  now: number;
  readerId: string | undefined;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked. */
  open?: boolean;
  /** Whether the end draws the attention mark and the task's status, which a row saying them elsewhere leaves to a reader's ears. */
  standing?: boolean;
  before?: ReactNode;
  /** What stands after the time, as a shortcut does. */
  after?: ReactNode;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter } = useInboxStanding(listed, readerId);
  const drafted = useInboxItemDrafted(item) && !open;
  return (
    <InboxRowMeta>
      {before}
      {starter === undefined ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
      {starter === undefined || item.status !== INBOX_STATUS.OPEN ? null : (
        <VisuallyHidden>{waitingOn(starter)}</VisuallyHidden>
      )}
      {drafted ? <DraftMark /> : null}
      {needsYou && standing ? (
        <span className={INBOX_ROW_ATTENTION}>
          <AttentionMark />
          <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
        </span>
      ) : null}
      {needsYou && !standing ? <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden> : null}
      <TaskStatusChip holder={holder} drawn={standing} />
      <Time at={item.updatedAt} now={now} hint={false} />
      {after}
    </InboxRowMeta>
  );
}
