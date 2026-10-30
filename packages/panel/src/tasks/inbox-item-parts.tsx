/**
 * inbox-item-parts.tsx -- the pieces that draw an Inbox item as the Inbox does, for every place that lists one: its agent's tile, the glyph of what it asks, its card, and the marks at its row's end.
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
  type InboxPerson,
  inboxWaitsOn,
  recommendedLabels,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import type { CatalogModel } from "@luke/features/models-wire";
import {
  AttentionMark,
  Badge,
  cn,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  HoverCardSkeleton,
  INLINE_REF_LOOK,
  InlineRef,
  STATUS_TONE,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  VisuallyHidden,
  WingFace,
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
import { useAutomation } from "../automation-directory.js";
import { useInboxItemDraft, useInboxItemDrafted } from "../composer-drafts.js";
import { DraftMark } from "../draft-mark.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { agentStillWriting, providerOf } from "./agent-model.js";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref.js";
import { AutomationChipCard, TaskChipCard } from "./chip-cards.js";
import { HOME_ROW_META } from "./home-row.js";
import { fillInWords, WRITE_AN_ANSWER } from "./inbox-ask-words.js";
import {
  holderAutomationId,
  holderName,
  INBOX_HOLDER,
  INBOX_LINE,
  type InboxHolder,
  type InboxKnownAsk,
  type InboxLineKind,
  type InboxListed,
  inboxCardThread,
  inboxLineKind,
  inboxSettledStanding,
  inboxSettledWords,
  inboxShownTicks,
  itemWorkspaceId,
  NEEDS_YOU,
  needsYou as needsYouOf,
  operatorHolder,
  RECOMMENDED,
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

/** What a message or a thread its agent addressed to a member by name says of them: "To you", or "To" and their name. */
export function addressedWords(person: Actor): string {
  return `To ${actorName(person, { sentence: true })}`;
}

/**
 * Whom an agent addressed a message or a thread to by name, at the end of
 * its head: "To", their face, and their name, or "you"; nothing where it
 * named nobody, which then waits on its task's assignee or its starter.
 */
export function AddressedTo({ to }: { to: InboxPerson | undefined }): React.JSX.Element | null {
  const person = usePerson(to);
  if (to === undefined) return null;
  return (
    <span className="inbox-addressed-to inline-flex min-w-0 items-center gap-tight-gap">
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        To
      </Text>
      <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />
      <Text variant={TEXT_VARIANT.CAPTION}>{actorName(person, { sentence: true })}</Text>
    </span>
  );
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
  if (holder.kind === INBOX_HOLDER.AGENT) {
    const { agent } = holder;
    return agent.agentId !== agentId ? undefined : tasklessSubject(agent, models);
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

/** The glyph saying what an item asks, as its row's second line leads with it: its open ask's kind, a tick where an answer settled it, and none before words alone. */
export function inboxLineGlyph(kind: InboxLineKind): React.JSX.Element | null {
  switch (kind) {
    case INBOX_LINE.DECIDE:
      return <GLYPH.DECIDE />;
    case INBOX_LINE.DO:
      return <SquareCheckIcon aria-hidden="true" />;
    case INBOX_LINE.ANSWER:
      return <PenLineIcon aria-hidden="true" />;
    case INBOX_LINE.SETTLED:
      return <CheckIcon aria-hidden="true" />;
    case INBOX_LINE.SAID:
      return null;
  }
}

/**
 * An item's own glyph, as its chip wears it and its card leads with it:
 * what it asks, as its row's second line leads with it (`inboxLineGlyph`),
 * or the thread's glyph where it asks nothing.
 */
export function inboxItemGlyph(item: InboxItem): React.JSX.Element {
  return inboxLineGlyph(inboxLineKind(item)) ?? <GLYPH.THREAD />;
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
 * thread. It leads with the item's glyph, what it asks as its chip wears
 * it, its title, where it stands, waiting on the reader, on a teammate, or
 * settled, and when it last moved; then what holds it, a task as its key
 * and its chip, which wears its status, or an automation by its name;
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
  /** The time its age counts from; the window's minute where none is handed. */
  now?: number | undefined;
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
    <HoverCard data-inbox-item-card="">
      <HoverCardHead
        glyph={inboxItemGlyph(item)}
        name={cardTitle(item.title)}
        sub={
          <>
            {needsYou ? <AttentionMark /> : null}
            <span>{standingWords(item, needsYou, starter)}</span>
          </>
        }
        corner={<Time at={item.updatedAt} now={now} hint={false} />}
      />
      <HolderDetail holder={holder} workspaceId={itemWorkspaceId(holder)} />
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
 * What holds an item, as its card says it under the head, a quieter row
 * on the name's column: a task by its key, as the task's own card says it
 * (`TaskKey`), and by its chip as a mention of it is drawn (`HolderRef`),
 * which wears the task's status as its mark, so the card says no status in
 * words; an automation, or the agents no automation names, by their chip
 * alone. Note that the row wears no glyph of its own, because the chip
 * already leads with the holder's.
 */
function HolderDetail({
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
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={null}
      label={
        <span className={cn(TASK_CARD_STANDING, "flex-nowrap")} data-holder-detail="">
          {holder.kind === INBOX_HOLDER.TASK ? (
            <TaskKey workspaceName={workspaceName} number={holder.task.number} />
          ) : null}
          <HolderRef holder={holder} workspaceId={workspaceId} />
        </span>
      }
    />
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
  const automationId = holderAutomationId(holder);
  const known = useAutomation(automationId ?? undefined);
  const glyph = <HolderGlyph holder={holder} />;
  const name = holderName(holder);
  const head = <HoverCardHead glyph={glyph} name={name} />;
  if (holder.kind !== INBOX_HOLDER.TASK) {
    const fallback = <HoverCard data-actor-card={ACTOR_KIND.AUTOMATION}>{head}</HoverCard>;
    return (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={glyph}
        label={name}
        card={
          automationId === null ? undefined : workspaceId === undefined ? (
            // Note that an older service names no workspace for the item, so only a directory around the card can know the automation.
            known === undefined ? undefined : (
              <AutomationCard {...known} />
            )
          ) : (
            <AutomationChipCard
              automationId={automationId}
              workspace={workspaceId}
              wordsWorkspaceId={workspaceId}
              reading={
                <HoverCardSkeleton
                  glyph={glyph}
                  name={name}
                  data-actor-card={ACTOR_KIND.AUTOMATION}
                />
              }
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
      card={
        <TaskChipCard taskId={task.id} fallback={<HoverCard data-task-card="">{head}</HoverCard>} />
      }
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
              ? WRITE_AN_ANSWER
              : fillInWords(ask.fields.map((field) => field.label))
          }
        />
      );
  }
}

/**
 * An item's task's status as its row wears it before its time: the
 * status's mark alone, small and quiet, as the task's sidebar row wears
 * it, so a Done task's item reads ✓ and a Canceled one's ×, its words said
 * to a reader and in the row's card (`HolderDetail`). Note that it is drawn
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
 * automation's clock tile, Luke's face for the member's operator, and the
 * automation glyph for the agents no automation names, as the holder's
 * group header draws them.
 */
export function HolderGlyph({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const automationId = holderAutomationId(holder);
  const known = useAutomation(automationId ?? undefined);
  if (holder.kind === INBOX_HOLDER.TASK) return <PlanGlyph status={holder.task.status} />;
  if (operatorHolder(holder)) return <WingFace />;
  if (automationId === null) return <GLYPH.AUTOMATION />;
  return (
    <ActorMark
      actor={
        known === undefined
          ? { kind: ACTOR_KIND.AUTOMATION, name: holderName(holder), state: ACTOR_STATE.REST }
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

/** What an item row's end is handed: the item, and how it stands on its row. */
interface InboxItemEndProps {
  listed: InboxListed;
  /** The time its age counts from; the window's minute where none is handed. */
  now?: number | undefined;
  readerId: string | undefined;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked. */
  open?: boolean;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the end draws the attention mark and the task's status, which a row saying them elsewhere leaves to a reader's ears. */
  standing?: boolean;
  before?: ReactNode;
  /** What stands after the time, as a shortcut does. */
  after?: ReactNode;
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
export function InboxItemEnd(props: InboxItemEndProps): React.JSX.Element {
  return <InboxItemMarks {...props} drafted={useInboxItemDrafted(props.listed.item)} />;
}

/**
 * An item row's end (`InboxItemEnd`) where its list reads every row's
 * draft at once (`useInboxRowDrafts`), handed whether the item's box holds
 * one rather than reading it row by row.
 */
export function InboxItemMarks({
  listed,
  now,
  readerId,
  open = false,
  face = true,
  standing = true,
  drafted,
  before,
  after,
}: InboxItemEndProps & {
  /** Whether the item's box holds a draft as the item now stands (`rowDrafted`), marked where that box is not the one open. */
  drafted: boolean;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter } = useInboxStanding(listed, readerId);
  return (
    <InboxRowMeta>
      {before}
      {starter === undefined || !face ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
      {starter === undefined || item.status !== INBOX_STATUS.OPEN ? null : (
        <VisuallyHidden>{waitingOn(starter)}</VisuallyHidden>
      )}
      {drafted && !open ? <DraftMark /> : null}
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
