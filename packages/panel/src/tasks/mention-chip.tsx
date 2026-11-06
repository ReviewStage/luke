import {
  type DateSpan,
  dateChipText,
  dateDistance,
  dateWhole,
  readerZone,
} from "@repo/features/date-mention";
import {
  issueAddressOf,
  LINK_PLACE,
  type LinkPlace,
  linkOf,
  MENTION_SIGIL,
  pullRequestAddressOf,
  type ReadLink,
  readLink,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import {
  decodeMention,
  encodeMention,
  isBareLink,
  linkMention,
  MENTION_KIND,
  type Mention,
  type MentionLines,
  type MentionPlace,
  mentionName,
  type NumberedTaskIdOf,
  type DescriptionMention,
  pageRepositoryOf,
  pastedLinkMention,
  sectionAnchors,
} from "@repo/features/mention-link";
import { type KnownNames, placeChipLook } from "@repo/features/place-chip-model";
import { descriptionSections } from "@repo/features/description-document";
import { UNTITLED_TASK_NAME } from "@repo/features/task-wire";
import {
  THING_KIND,
  THING_WORD,
  thingName,
  thingOfMention,
  thingOfPlace,
  thingWordHeard,
} from "@repo/features/thing-kind";
import { isGitHubAddress, isWebAddress } from "@repo/host/acts";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  InlineRef,
  OneLine,
  TEXT_LINK_LOOK,
  TextLink,
  useMinute,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { CalendarIcon } from "@repo/ui/icons";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import type { LinkDrawer, MarkdownSpan } from "../markdown-message.js";
import type {
  HeadingsChange,
  MentionNode,
  MentionNodeDoors,
} from "../description-editor/contract.js";
import { LinkAutomations, useSectionHeading } from "./chip-cards.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  dateMentionNode,
} from "./date-picker.js";
import { useInboxItemTitle } from "./inbox-item-chip.js";
import { holderTaskId, type MentionHolder } from "./mention-holder.js";
import { OpenedByRow, PullRequestCard } from "./pull-request-card.js";
import { branchNote, thingCard } from "./thing-card.js";
import { type AgentTiles, thingMark } from "./thing-mark.js";
import { useKnownNames, useWordTargets } from "./use-known-names.js";
import {
  type LinkStanding,
  useLinkStanding,
  useNumberedTaskId,
  useWordsWorkspaceId,
} from "./use-link-standing.js";
import { useOpenLink } from "./use-open-link.js";
import { useWordsDates } from "./words-dates.js";

const MENTION_STATE = {
  FOUND: "found",
  GONE: "gone",
} as const;

type MentionState = (typeof MENTION_STATE)[keyof typeof MENTION_STATE];

export interface MentionDoors {
  readonly holder: MentionHolder | undefined;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
  readonly onOpenTask: (mention: DescriptionMention) => void;
  readonly onOpenFile: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  readonly agentOf?: ((agentId: string) => MentionedAgentLook | undefined) | undefined;
  readonly pullRequestOf?: ((url: string) => ReactNode | undefined) | undefined;
}

interface MentionedAgentLook {
  readonly actor: Actor;
  readonly card: ReactNode;
}

export function retargetedMention(
  taskId: string,
  place: MentionPlace,
  target: string,
  change: HeadingsChange,
): MentionNode | undefined {
  const mention = decodeMention(target, place.repository);
  if (mention?.kind !== MENTION_KIND.SECTION || mention.taskId !== taskId) return undefined;
  const was = sectionAnchors(change.before);
  const is = sectionAnchors(change.after);
  const at = was.indexOf(mention.anchor);
  const kept = change.kept.get(at) ?? -1;
  const now = is[kept];
  const heading = change.after[kept];
  if (now === undefined || now === "" || heading === undefined) return undefined;
  if (now === mention.anchor && heading === change.before[at]) return undefined;
  return { name: heading, target: encodeMention({ ...mention, anchor: now }, place) };
}

const GONE_WORDS = "No longer in the description";

function mentionState(mention: Mention, doors: MentionDoors): MentionState {
  if (mention.kind !== MENTION_KIND.SECTION || mention.taskId !== holderTaskId(doors.holder)) {
    return MENTION_STATE.FOUND;
  }
  return doors.anchors.has(mention.anchor) ? MENTION_STATE.FOUND : MENTION_STATE.GONE;
}

function pressOf(
  mention: Mention,
  target: string,
  state: MentionState,
  doors: MentionDoors,
  openLink: (href: string) => void,
): (() => void) | undefined {
  switch (mention.kind) {
    case MENTION_KIND.LINK:
      return () => openLink(mention.url);
    case MENTION_KIND.FILE:
    case MENTION_KIND.FOLDER: {
      const { onOpenFile } = doors;
      if (onOpenFile !== undefined) {
        return mention.kind === MENTION_KIND.FILE
          ? () => onOpenFile(mention.path, mention.lines)
          : undefined;
      }
      return isGitHubAddress(target) ? () => openLink(target) : undefined;
    }
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.DATE:
      return undefined;
    case MENTION_KIND.TASK:
      return () => doors.onOpenTask(mention);
    case MENTION_KIND.SECTION:
      return () =>
        doors.onOpenTask(
          state === MENTION_STATE.FOUND
            ? mention
            : { kind: MENTION_KIND.TASK, taskId: mention.taskId },
        );
    case MENTION_KIND.PAGE:
    case MENTION_KIND.AGENT:
    case MENTION_KIND.PERSON:
      return () => openLink(target);
    case MENTION_KIND.APP:
      return () => doors.onOpenTask({ kind: MENTION_KIND.TASK, taskId: mention.taskId });
  }
}

function leavesFor(mention: Mention, target: string, doors: MentionDoors): boolean {
  if (!isWebAddress(target) || readLink(target) !== undefined) return false;
  if (mention.kind === MENTION_KIND.LINK) return true;
  const paged = mention.kind === MENTION_KIND.FILE || mention.kind === MENTION_KIND.FOLDER;
  return paged && doors.onOpenFile === undefined;
}

function agentTiles(doors: MentionDoors): AgentTiles | undefined {
  const { agentOf } = doors;
  if (agentOf === undefined) return undefined;
  return { tileOf: (agentId) => agentOf(agentId)?.actor };
}

function MentionGlyph({
  mention,
  target,
  name,
  doors,
  known,
  standing,
}: {
  mention: Mention;
  target: string;
  name: string;
  doors: MentionDoors;
  known: KnownNames;
  standing?: LinkStanding | undefined;
}): ReactNode {
  return thingMark(thingOfMention(mention), {
    name,
    known,
    workspace: readLink(target)?.workspace ?? doors.place.workspace,
    tiles: agentTiles(doors),
    standing,
  });
}

function noteOf(
  mention: Mention,
  state: MentionState,
  standing: LinkStanding | undefined,
): string | undefined {
  if (state === MENTION_STATE.GONE) return GONE_WORDS;
  if (mention.kind === MENTION_KIND.LINK) return standing === undefined ? mention.url : undefined;
  return undefined;
}

function MentionCard({
  mention,
  target,
  name,
  state,
  doors,
  known,
  standing,
}: {
  mention: Mention;
  target: string;
  name: string;
  state: MentionState;
  doors: MentionDoors;
  known: KnownNames;
  standing: LinkStanding | undefined;
}): ReactNode {
  const workspaceId = useWordsWorkspaceId({
    taskId: holderTaskId(doors.holder),
    workspace: doors.place.workspace,
  });
  const repository = doors.place.repository ?? undefined;
  const tabCard =
    mention.kind === MENTION_KIND.AGENT ? doors.agentOf?.(mention.agentId)?.card : undefined;
  if (tabCard !== undefined) return tabCard;
  const changesCard =
    mention.kind === MENTION_KIND.LINK ? doors.pullRequestOf?.(mention.url) : undefined;
  if (changesCard !== undefined) return changesCard;
  const whole = mention.kind === MENTION_KIND.FOLDER ? `${mention.path}/` : name;
  const note = noteOf(mention, state, standing);
  const glyph = (
    <MentionGlyph
      mention={mention}
      target={target}
      name={name}
      doors={doors}
      known={known}
      standing={standing}
    />
  );
  const card =
    mention.kind === MENTION_KIND.LINK && standing?.pullRequest !== undefined ? (
      <PullRequestCard
        pullRequest={{ ...standing.pullRequest, title: standing.title, url: mention.url }}
        place={{ taskId: null, workspaceId }}
      />
    ) : (
      <HoverCard data-mention-card="">
        <HoverCardHead
          glyph={glyph}
          name={standing?.title ?? whole}
          sub={mention.kind === MENTION_KIND.FOLDER ? repository : undefined}
        />
        {mention.kind === MENTION_KIND.FOLDER ? (
          <OptionalNote words={branchNote(repository)} />
        ) : null}
        {standing === undefined ? null : (
          <HoverCardNote>
            {standing.state === undefined ? standing.key : `${standing.key} · ${standing.state}`}
          </HoverCardNote>
        )}
        {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
        {standing?.opener === undefined ? null : <OpenedByRow opener={standing.opener} />}
      </HoverCard>
    );
  return thingCard(thingOfMention(mention), {
    own: card,
    glyph,
    name,
    workspace: readLink(target)?.workspace ?? doors.place.workspace,
    wordsWorkspaceId: workspaceId,
    repository,
    gone: state === MENTION_STATE.GONE ? GONE_WORDS : undefined,
  });
}

function OptionalNote({ words }: { words: string | undefined }): ReactNode {
  return words === undefined ? null : <HoverCardNote>{words}</HoverCardNote>;
}

export function MentionChipCard({
  mention,
  target,
  name,
  doors,
  standing,
}: {
  mention: Mention;
  target: string;
  name: string;
  doors: MentionDoors;
  standing: LinkStanding | undefined;
}): ReactNode {
  const known = useKnownNames();
  return (
    <MentionCard
      mention={mention}
      target={target}
      name={name}
      state={mentionState(mention, doors)}
      doors={doors}
      known={known}
      standing={standing}
    />
  );
}

function chipName(
  mention: Mention,
  written: string,
  bare: boolean,
  known: KnownNames,
  standing: LinkStanding | undefined,
  heading: string | undefined,
  repository: string | null,
): string {
  const thing = thingOfMention(mention);
  const { live, held } = thingName(thing, known, { heading, answered: standing, repository });
  if (thing.kind === THING_KIND.PLAN && held === UNTITLED_TASK_NAME) return written;
  return (live || bare ? held : undefined) ?? written;
}

export function githubName(
  mention: Mention,
  standing: LinkStanding | undefined,
): string | undefined {
  if (mention.kind !== MENTION_KIND.LINK || standing === undefined) return undefined;
  if (standing.pullRequest === undefined && standing.issue === undefined) return undefined;
  const address = pullRequestAddressOf(mention.url) ?? issueAddressOf(mention.url);
  if (address === undefined) return undefined;
  return pullRequestLabelOf({ number: address.number, title: standing.title });
}

function MentionChip({
  mention,
  target,
  name: written,
  doors,
  bare = false,
}: {
  mention: Mention;
  target: string;
  name: string;
  doors: MentionDoors;
  bare?: boolean;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const known = useKnownNames();
  const standing = useLinkStanding(mention, {
    taskId: holderTaskId(doors.holder),
    workspace: doors.place.workspace,
  });
  const section = mention.kind === MENTION_KIND.SECTION ? mention : undefined;
  const heading = useSectionHeading(section?.taskId, section?.anchor ?? "");
  const keys = useWordTargets();
  const keyTarget = keys.get(written);
  const keyNames =
    keyTarget === undefined ? undefined : decodeMention(keyTarget, doors.place.repository);
  const keyed =
    mention.kind === MENTION_KIND.TASK &&
    keyNames?.kind === MENTION_KIND.TASK &&
    keyNames.taskId === mention.taskId;
  const name =
    githubName(mention, standing) ??
    (keyed
      ? written
      : chipName(mention, written, bare, known, standing, heading, doors.place.repository));
  const pull = mention.kind === MENTION_KIND.LINK ? pullRequestAddressOf(mention.url) : undefined;
  const label =
    pull === undefined
      ? name
      : (new RegExp(`^\\S*#${pull.number}(?=\\s)`, "u").exec(name)?.[0] ?? name);
  const state = mentionState(mention, doors);
  const press = pressOf(mention, target, state, doors, openLink);
  const card = (
    <MentionCard
      mention={mention}
      target={target}
      name={name}
      state={state}
      doors={doors}
      known={known}
      standing={standing}
    />
  );
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={
        <MentionGlyph
          mention={mention}
          target={target}
          name={name}
          doors={doors}
          known={known}
          standing={standing}
        />
      }
      kind={thingWordHeard(thingOfMention(mention).kind, label)}
      label={label}
      state={standing?.state}
      gone={state === MENTION_STATE.GONE}
      onPress={
        press === undefined
          ? undefined
          : (event) => {
              event.stopPropagation();
              press();
            }
      }
      card={card}
      linkHref={press === undefined ? undefined : target}
      leaves={leavesFor(mention, target, doors)}
      data-mention-ref=""
      data-kind={mention.kind}
      data-state={state}
      data-stated={standing?.state === undefined ? undefined : ""}
    />
  );
}

type DateMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.DATE }>;

function DateCard({ date }: { date: DateMention }): React.JSX.Element {
  const now = useMinute();
  const zone = readerZone();
  return (
    <HoverCard data-date-card="">
      <HoverCardHead glyph={<CalendarIcon aria-hidden="true" />} name={dateWhole(date, zone)} />
      <HoverCardNote>{dateDistance(date, now, zone)}</HoverCardNote>
    </HoverCard>
  );
}

function DateChip({
  date,
  onPick,
}: {
  date: DateMention;
  onPick?: ((chip: Element) => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<CalendarIcon aria-hidden="true" />}
      kind={THING_WORD[THING_KIND.DATE]}
      label={dateChipText(date, now, readerZone())}
      card={<DateCard date={date} />}
      onPress={
        onPick === undefined
          ? undefined
          : (event) => {
              event.stopPropagation();
              onPick(event.currentTarget);
            }
      }
      data-mention-ref=""
      data-kind={date.kind}
      data-state={MENTION_STATE.FOUND}
    />
  );
}

function WrittenDateChip({
  date,
  at,
  place,
}: {
  date: DateMention;
  at: MarkdownSpan | undefined;
  place: MentionPlace;
}): React.JSX.Element {
  const dates = useWordsDates();
  return (
    <DateChip
      date={date}
      onPick={
        dates === undefined || at === undefined
          ? undefined
          : (chip) => dates.pick({ at, date, place }, chip)
      }
    />
  );
}

function placeTaskId(place: LinkPlace): string | undefined {
  return "planId" in place ? place.planId : undefined;
}

function PlaceGlyph({
  place,
  name,
  workspace,
  known,
  doors,
}: {
  place: LinkPlace;
  name: string;
  workspace: string;
  known: KnownNames;
  doors: MentionDoors;
}): ReactNode {
  return thingMark(thingOfPlace(place), {
    name,
    known,
    workspace,
    tiles: agentTiles(doors),
    standing: undefined,
  });
}

function PlaceChip({
  href,
  place,
  workspace,
  label,
  doors,
  read,
}: {
  href: string;
  place: LinkPlace;
  workspace: string;
  label: string | undefined;
  doors: MentionDoors;
  read?: ((known: KnownNames) => KnownNames) | undefined;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const held = useKnownNames("automationId" in place ? place.automationId : undefined);
  const known = read === undefined ? held : read(held);
  const { name, under } = placeChipLook(place, label, known);
  const glyph = (
    <PlaceGlyph place={place} name={name} workspace={workspace} known={known} doors={doors} />
  );
  const own = (
    <HoverCard data-mention-card="">
      <HoverCardHead glyph={glyph} name={name} />
      {under === undefined ? null : <HoverCardNote>{`In ${under}`}</HoverCardNote>}
    </HoverCard>
  );
  const card = (
    <PlaceCard place={place} workspace={workspace} name={name} glyph={glyph} fallback={own} />
  );
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={glyph}
      kind={thingWordHeard(thingOfPlace(place).kind, name)}
      label={name}
      onPress={(event) => {
        event.stopPropagation();
        openLink(href);
      }}
      card={card}
      linkHref={href}
      data-mention-ref=""
      data-kind={MENTION_KIND_PLACE}
    />
  );
}

function PlaceCard({
  place,
  workspace,
  name,
  glyph,
  fallback,
}: {
  place: LinkPlace;
  workspace: string;
  name: string;
  glyph: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const workspaceId = useWordsWorkspaceId({ taskId: placeTaskId(place), workspace });
  return thingCard(thingOfPlace(place), {
    own: fallback,
    glyph,
    name,
    workspace,
    wordsWorkspaceId: workspaceId,
    repository: undefined,
    gone: undefined,
  });
}

type InboxItemLinkPlace = Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>;

function InboxItemChip({
  place,
  ...chip
}: {
  href: string;
  place: InboxItemLinkPlace;
  workspace: string;
  label: string | undefined;
  doors: MentionDoors;
}): React.JSX.Element {
  const title = useInboxItemTitle(place);
  const read =
    title === undefined
      ? undefined
      : (known: KnownNames): KnownNames => ({
          ...known,
          inboxItems: new Map([...known.inboxItems, [place.itemId, title]]),
        });
  return <PlaceChip place={place} read={read} {...chip} />;
}

function NumberedLinkChip({
  href,
  read,
  label,
  doors,
}: {
  href: string;
  read: ReadLink;
  label: string;
  doors: MentionDoors;
}): React.JSX.Element {
  const taskId = useNumberedTaskId(read.workspace, taskNumberOf(read.place));
  const bare = isBareLink(label, href);
  const byId =
    taskId === undefined ? undefined : linkOf(withTaskId(read.place, taskId), read.workspace);
  const found =
    byId === undefined ? undefined : linkMention(bare ? byId : label, byId, doors.place.repository);
  if (found !== undefined) {
    return (
      <MentionChip
        mention={found.mention}
        target={href}
        name={found.name}
        doors={doors}
        bare={bare}
      />
    );
  }
  return (
    <PlaceChip
      href={href}
      place={read.place}
      workspace={read.workspace}
      label={bare ? undefined : mentionName(label.trim())}
      doors={doors}
    />
  );
}

const MENTION_KIND_PLACE = "place";

function pageDoors(doors: MentionDoors, href: string): MentionDoors {
  const repository = doors.place.repository === null ? pageRepositoryOf(href) : undefined;
  if (repository === undefined) return doors;
  return { ...doors, place: { ...doors.place, repository }, onOpenFile: undefined };
}

export function linkChip(
  href: string,
  label: string,
  doors: MentionDoors,
  at?: MarkdownSpan | undefined,
): React.JSX.Element | undefined {
  const bare = isBareLink(label, href);
  const placed = pageDoors(doors, href);
  const found = linkMention(label, href, placed.place.repository);
  if (found?.mention.kind === MENTION_KIND.DATE) {
    return <WrittenDateChip date={found.mention} at={at} place={doors.place} />;
  }
  if (found !== undefined) {
    return (
      <MentionChip
        mention={found.mention}
        target={href}
        name={found.name}
        doors={placed}
        bare={bare}
      />
    );
  }
  const read = readLink(href);
  if (read === undefined) return undefined;
  if (taskNumberOf(read.place) !== undefined) {
    return <NumberedLinkChip href={href} read={read} label={label} doors={placed} />;
  }
  const written = bare ? undefined : mentionName(label.trim());
  if (read.place.kind === LINK_PLACE.INBOX_ITEM) {
    return (
      <InboxItemChip
        href={href}
        place={read.place}
        workspace={read.workspace}
        label={written}
        doors={placed}
      />
    );
  }
  if (read.place.kind === LINK_PLACE.AUTOMATION || read.place.kind === LINK_PLACE.AUTOMATION_RUN) {
    return (
      <LinkAutomations workspace={read.workspace}>
        <PlaceChip
          href={href}
          place={read.place}
          workspace={read.workspace}
          label={written}
          doors={placed}
        />
      </LinkAutomations>
    );
  }
  return (
    <PlaceChip
      href={href}
      place={read.place}
      workspace={read.workspace}
      label={written}
      doors={placed}
    />
  );
}

export const ORIGIN_CHIP = "agent-origin-chip inline-flex min-w-0 max-w-full";

export const CHIP_OR_LINK_FRAME = {
  BARE: "bare",
  ORIGIN: "origin",
  SUBJECT: "subject",
} as const;

export type ChipOrLinkFrame = (typeof CHIP_OR_LINK_FRAME)[keyof typeof CHIP_OR_LINK_FRAME];

export function ChipOrLink({
  href,
  words,
  doors,
  onOpen,
  frame = CHIP_OR_LINK_FRAME.BARE,
}: {
  href: string;
  words: string;
  doors?: MentionDoors | undefined;
  onOpen?: ((href: string) => void) | undefined;
  frame?: ChipOrLinkFrame;
}): ReactNode {
  const openLink = useOpenLink();
  const chip = doors === undefined ? undefined : linkChip(href, words, doors);
  if (chip !== undefined) {
    return frame === CHIP_OR_LINK_FRAME.BARE ? chip : <span className={ORIGIN_CHIP}>{chip}</span>;
  }
  const link = (
    <TextLink
      href={href}
      look={TEXT_LINK_LOOK.UNDERLINED}
      onClick={(event) => {
        event.preventDefault();
        (onOpen ?? openLink)(href);
      }}
    >
      {words}
    </TextLink>
  );
  switch (frame) {
    case CHIP_OR_LINK_FRAME.BARE:
      return link;
    case CHIP_OR_LINK_FRAME.ORIGIN:
      return <span className={ORIGIN_CHIP}>{link}</span>;
    case CHIP_OR_LINK_FRAME.SUBJECT:
      return (
        <OneLine className="agent-origin-subject" words={words}>
          {link}
        </OneLine>
      );
  }
}

export function mentionLinkDrawer(doors: MentionDoors): LinkDrawer {
  return (href, label, at) => linkChip(href, label, doors, at);
}

export interface PastedNames {
  readonly known: KnownNames;
  readonly taskIdOf: NumberedTaskIdOf;
  readonly taskId: string | undefined;
  readonly text: () => string;
}

function pastedName(
  mention: Mention,
  said: string,
  names: PastedNames,
  repository: string | null,
): string {
  if (mention.kind !== MENTION_KIND.SECTION)
    return chipName(mention, said, true, names.known, undefined, undefined, repository);
  if (mention.taskId !== names.taskId) return said;
  const headings = descriptionSections(names.text()).map((section) => section.heading);
  return headings[sectionAnchors(headings).indexOf(mention.anchor)] ?? said;
}

function byTaskId(words: string, taskIdOf: NumberedTaskIdOf): string {
  const read = readLink(words.trim());
  const number = read === undefined ? undefined : taskNumberOf(read.place);
  if (read === undefined || number === undefined) return words;
  const taskId = taskIdOf({ workspace: read.workspace, number });
  return taskId === undefined ? words : linkOf(withTaskId(read.place, taskId), read.workspace);
}

export function pastedMentionNode(
  words: string,
  place: MentionPlace,
  names: PastedNames,
): MentionNode | undefined {
  const link = pastedLinkMention(byTaskId(words, names.taskIdOf), place.repository);
  const elsewhere =
    link?.mention.kind === MENTION_KIND.PERSON &&
    readLink(words.trim())?.workspace !== place.workspace;
  return link === undefined || elsewhere
    ? undefined
    : {
        name: pastedName(link.mention, link.name, names, place.repository),
        target: encodeMention(link.mention, place),
      };
}

export interface MentionNodeEdit {
  readonly node: MentionNodeDoors;
  readonly pickDate: (opening: DatePickerOpening) => void;
}

function datePicked(
  node: MentionNodeDoors,
  was: DateSpan,
  picked: DatePicked,
  place: MentionPlace,
): void {
  if (picked.how === DATE_PICKER_CLOSE.CLEAR) {
    node.remove();
    return;
  }
  const keyed = picked.how === DATE_PICKER_CLOSE.KEY;
  const { date } = picked;
  const moved =
    picked.changed &&
    date !== undefined &&
    (date.start !== was.start || date.end !== was.end || picked.zonePicked);
  if (moved) node.rename(dateMentionNode(date, place, picked.zone), keyed);
  else if (keyed) node.focusAfter();
}

export function MentionNodeChip({
  mention,
  doors,
  edit,
}: {
  mention: MentionNode;
  doors: MentionDoors;
  edit?: MentionNodeEdit | undefined;
}): React.JSX.Element {
  const named = decodeMention(mention.target, doors.place.repository);
  if (named === undefined) {
    const written = `${MENTION_SIGIL}${mention.name}`;
    return linkChip(mention.target, written, doors) ?? <>{written}</>;
  }
  if (named.kind === MENTION_KIND.DATE) {
    return (
      <DateChip
        date={named}
        onPick={
          edit === undefined
            ? undefined
            : (chip) =>
                edit.pickDate({
                  at: chip,
                  date: named,
                  onClose: (picked) => datePicked(edit.node, named, picked, doors.place),
                })
        }
      />
    );
  }
  return <MentionChip mention={named} target={mention.target} name={mention.name} doors={doors} />;
}
