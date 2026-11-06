import {
  INBOX_STATUS,
  type InboxItem,
  type InboxPerson,
  inboxWaitsOn,
} from "@repo/features/inbox-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { CatalogModel } from "@repo/features/models-wire";
import {
  AttentionMark,
  cn,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  HoverCardSkeleton,
  INLINE_REF_LOOK,
  InlineRef,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { CheckIcon, GLYPH, PenLineIcon, SquareCheckIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { useInboxItemDrafted } from "../composer-drafts.js";
import { DraftMark } from "../draft-mark.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { agentStillWriting, providerOf } from "./agent-model.js";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref.js";
import { AutomationChipCard, TaskChipCard } from "./chip-cards.js";
import { HOME_ROW_META } from "./home-row.js";
import {
  holderAutomationId,
  holderName,
  INBOX_HOLDER,
  INBOX_LINE,
  type InboxHolder,
  type InboxLineKind,
  type InboxListed,
  inboxCardWords,
  inboxLineKind,
  inboxSettledStanding,
  inboxSettledWords,
  itemWorkspaceId,
  NEEDS_YOU,
  needsYou as needsYouOf,
  readersItem,
} from "./inbox-model.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PlanGlyph } from "./tab-look.js";
import { TASK_CARD_STANDING, TASK_STATUS_WORDS, TaskKey } from "./task-standing.js";
import { cardTitle } from "./tool-call-model.js";
import { useOpenPlace } from "./use-open-link.js";

const INBOX_ROW_ATTENTION =
  "inbox-row-attention inline-flex [&_.attention-mark]:size-ui-12 [&_.attention-mark_svg]:size-attention-glyph-small";

const INBOX_ROW_DUE =
  "inbox-row-due inline-flex items-center gap-tight-gap text-accent-ink [&>svg]:size-caption-glyph";

const REMINDER_DUE = "Reminder";

function waitingOn(starter: Actor): string {
  return `Waiting on ${actorName(starter, { sentence: true })}`;
}

export function addressedWords(person: Actor): string {
  return `To ${actorName(person, { sentence: true })}`;
}

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

const UNNAMED_AGENT = {
  kind: ACTOR_KIND.AGENT,
  name: "",
  provider: undefined,
  state: ACTOR_STATE.REST,
} as const;

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
  plain?: boolean;
}): React.JSX.Element {
  const subject = itemSubject(holder, agentId, models, readerId);
  if (subject === undefined) {
    if (holder.kind !== INBOX_HOLDER.TASK) return <ActorMark actor={UNNAMED_AGENT} />;
    return (
      <ReadAgentModel agentId={agentId}>
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

export function inboxItemGlyph(item: InboxItem): React.JSX.Element {
  return inboxLineGlyph(inboxLineKind(item)) ?? <GLYPH.THREAD />;
}

function standingWords(item: InboxItem, needsYou: boolean, starter: Actor | undefined): string {
  if (needsYou) return NEEDS_YOU.LABEL;
  if (item.status === INBOX_STATUS.OPEN) {
    return starter === undefined ? "Waiting" : waitingOn(starter);
  }
  return inboxSettledStanding(item);
}

export function InboxItemCard({
  listed,
  now,
  models,
  readerId,
}: {
  listed: InboxListed;
  now?: number | undefined;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter, nameOf } = useInboxStanding(listed, readerId);
  const settled = inboxSettledWords(item, nameOf);
  const subject = itemSubject(holder, item.agentId, models, readerId);
  const words = inboxCardWords(item);
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
        sub={<span>{standingWords(item, needsYou, starter)}</span>}
        corner={<Time at={item.updatedAt} now={now} hint={false} />}
      />
      <HolderDetail holder={holder} workspaceId={itemWorkspaceId(holder)} />
      {settled === undefined ? null : (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={item.status === INBOX_STATUS.CLOSED ? <GLYPH.DISMISSED /> : <CheckIcon />}
          label={settled}
        />
      )}
      {words === "" ? null : <HoverCardNote>{words}</HoverCardNote>}
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

function HolderDetail({
  holder,
  workspaceId,
}: {
  holder: InboxHolder;
  workspaceId: string | undefined;
}): React.JSX.Element {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
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

function HolderRef({
  holder,
  workspaceId,
}: {
  holder: InboxHolder;
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

function TaskStatusChip({
  holder,
  drawn = true,
}: {
  holder: InboxHolder;
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

export function HolderGlyph({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const automationId = holderAutomationId(holder);
  const known = useAutomation(automationId ?? undefined);
  if (holder.kind === INBOX_HOLDER.TASK) return <PlanGlyph status={holder.task.status} />;
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

interface InboxStanding {
  readonly needsYou: boolean;
  readonly starter: Actor | undefined;
  readonly nameOf: (member: Parameters<typeof personActor>[0]) => string;
}

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

function InboxRowMeta({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={HOME_ROW_META}>{children}</span>;
}

interface InboxItemEndProps {
  listed: InboxListed;
  now?: number | undefined;
  readerId: string | undefined;
  open?: boolean;
  face?: boolean;
  standing?: boolean;
  needsYouSaid?: boolean;
  before?: ReactNode;
  after?: ReactNode;
}

export function InboxItemEnd(props: InboxItemEndProps): React.JSX.Element {
  return <InboxItemMarks {...props} drafted={useInboxItemDrafted(props.listed.item)} />;
}

export function InboxItemMarks({
  listed,
  now,
  readerId,
  open = false,
  face = true,
  standing = true,
  needsYouSaid = true,
  drafted,
  before,
  after,
}: InboxItemEndProps & {
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
          {needsYouSaid ? <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden> : null}
        </span>
      ) : null}
      {needsYou && !standing && needsYouSaid ? (
        <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
      ) : null}
      <TaskStatusChip holder={holder} drawn={standing} />
      {item.remindAt === undefined ? (
        <Time at={item.updatedAt} now={now} hint={false} />
      ) : (
        <span className={INBOX_ROW_DUE}>
          <GLYPH.TIME />
          <VisuallyHidden>{REMINDER_DUE}</VisuallyHidden>
          <Time at={item.remindAt} look={TIME_LOOK.DUE} now={now} hint={false} />
        </span>
      )}
      {after}
    </InboxRowMeta>
  );
}
