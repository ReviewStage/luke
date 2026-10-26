import {
  type DateSpan,
  dateChipText,
  dateDistance,
  dateWhole,
  readerZone,
} from "@luke/features/date-mention";
import {
  issueAddressOf,
  LINK_PLACE,
  type LinkPlace,
  pullRequestAddressOf,
  readLink,
} from "@luke/features/link-grammar";
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
  type PlanMention,
  pageRepositoryOf,
  pastedLinkMention,
  sectionAnchors,
} from "@luke/features/mention-link";
import { type KnownNames, placeChipLook } from "@luke/features/place-chip-model";
import { planSections } from "@luke/features/plan-document";
import { UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import {
  THING_KIND,
  THING_WORD,
  thingName,
  thingOfMention,
  thingOfPlace,
  thingWordHeard,
} from "@luke/features/thing-kind";
import { isGitHubAddress, isWebAddress } from "@luke/host/acts";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  InlineRef,
  useMinute,
} from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import { CalendarIcon } from "@luke/ui/icons";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import type { ReactNode } from "react";
import type { LinkDrawer, MarkdownSpan } from "../markdown-message.js";
import type { HeadingsChange, MentionNode, MentionNodeDoors } from "../plan-editor/contract.js";
import { useSectionHeading } from "./chip-cards.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  dateMentionNode,
} from "./date-picker.js";
import { useInboxItemTitle } from "./inbox-item-chip.js";
import { OpenedNote, PullRequestCardNotes } from "./pull-request-card-notes.js";
import { branchNote, thingCard } from "./thing-card.js";
import { type AgentTiles, thingMark } from "./thing-mark.js";
import { useKnownNames, useTaskNameCatchUp, useWordTargets } from "./use-known-names.js";
import { type LinkStanding, useLinkStanding, useWordsWorkspaceId } from "./use-link-standing.js";
import { useOpenLink } from "./use-open-link.js";
import { useWordsDates } from "./words-dates.js";

/**
 * mention-chip.tsx -- a mention drawn in words as its chip: its kind's glyph and its name, a button that opens what it names, or a link where that leaves the app, hanging a card that says what that is, struck through where what it names is gone.
 *
 * A mention is written into markdown as a link whose target names it
 * (`@luke/features/mention-link`'s `linkMention`), a developer's with a
 * label starting with `@`, and wherever words are drawn, the link is drawn
 * as this chip: a pill on the words' line, the kind's glyph and the name the
 * mention was written with, cut to the chip's width. A press opens it: a
 * section of a task, that task scrolled to the section; a task, the task
 * at its top; a file, its tab, through the side panel's one door for a file
 * (`file-ref.tsx`). A folder opens nothing, since the window has no door to
 * one, and is a chip that hangs its card alone, as is a file where the
 * place can open none; either, where no File tab opens it, opens its GitHub
 * page where it was written as one. Words of no repository read a GitHub
 * page of a file or a folder as of the repository its address names
 * (`pageDoors`), so it is still that file's or folder's chip. An MCP server or one of its tools opens nothing
 * either, wearing its server's mark and hanging its server's row as the
 * MCP popover draws it, with what the mention does for the agent the words
 * go to (`server-card.tsx`); a page of an integration's, a Linear
 * issue say, wears the integration's mark and opens the page in the
 * browser, its card saying its address. A Linear issue's chip, a pull
 * request's, and a GitHub issue's say the state it stands in after their
 * name, a pull request's and a GitHub issue's wearing GitHub's mark for it,
 * as the workspace's own Linear or GitHub App answers them on the service
 * (`use-link-standing.ts`). A pull request or a GitHub issue GitHub answered
 * for is then called by its number alone, `#42`, its repository's name
 * before it where that is not the task's, `relay#42`, whatever words its
 * link was written with, so a pasted address, an agent's `[@#42](…)`, and
 * its `[@the fix](…)` draw one chip; a bare Linear issue is called by its
 * key and title. Its card then says its title, its key and state, and a
 * pull request's its size, who opened it and when, its branches, labels,
 * and counts (`pull-request-card-notes.tsx`), in its address's place,
 * which it says only while its provider has answered nothing. A page an
 * agent showed on a plan wears its tab's glyph, and one of a plan's coding agents its harness's
 * mark, as the place drawing it knows it (`MentionDoors.agentOf`), and any
 * other agent, one of another task's or of none, or one named where the
 * place knows no agents, the mark of the harness the window last read it
 * running on (`useKnownNames`), or, for one the window lists not, an
 * archived agent say, the harness read for it (`mentioned-agent-card.tsx`); either
 * opens its tab through the window's opener for a Luke link, as a link
 * copied to it does, and an agent hangs its tab's own card where the place
 * has one, and otherwise the same card read as it is hung, on any task of
 * the workspace or on none (`mentioned-agent-card.tsx`). A person wears
 * their picture and hangs their card, their email and role, or grayed as
 * having left, as the workspace's members around the chip say
 * (`../member-directory.tsx`), and opens their page in the workspace. A
 * link to any other place in Luke, an Inbox item, an
 * automation, an agent's message (`@luke/features/link-grammar`), is drawn as
 * the same chip, wearing the place's glyph and named as the window already
 * knows it (`@luke/features/place-chip-model`): the words it was labelled
 * with, else the place's own name, else its kind. A plan, a section, a
 * page, an agent, a person, or an Inbox item is called by its name now
 * wherever the window holds it, whatever words its link was written with:
 * the task's, the heading the section's anchor names, the page's, the
 * agent's as its tab names it, Luke for Luke, the member's, the item's, so
 * a chip never keeps a name its card no longer says. What it was written
 * with stands in only where the window cannot read it, a task deleted, of
 * another workspace, or not the reader's; and a task named before the
 * window ever read its task list has the list followed, once between every
 * chip, so its name lands (`useTaskNameCatchUp`). A press opens the
 * place as any Luke link opens, in the window. Its card, hung while the pointer rests
 * on it, names it whole: a file's is the card every place naming the file
 * hangs, and a file's lines open at the commit the mention pins them to.
 *
 * A date is said from where the reader stands rather than by the words it
 * was written with (`@luke/features/date-mention`): Today, Tomorrow,
 * Friday 3:00 PM, in the reader's own zone, said again as the minute turns
 * (`useMinute`), and its card says it in full and how far off it is. A day
 * has no page, so in words that take no change it opens nothing; in an
 * editor's words a press opens the date's picker, which names the chip
 * anew in place or takes it out (`date-picker.tsx`), and so it does in
 * words drawn at rest that take a change, the plan's or the reader's own
 * comment's, which are then saved with the date written anew
 * (`words-dates.tsx`).
 *
 * A section is known by its heading's anchor, so a section of the plan
 * drawn here whose anchor no heading of the plan spells any longer is gone:
 * its chip keeps the name it was written with, struck through, its card
 * says it is no longer in the plan, and a press opens the task at its top.
 * A section of another task is drawn as found, since what that task holds
 * is not at hand.
 *
 * A chip whose press leaves the app for a page on the web, a provider's
 * page or a file's GitHub page where no File tab opens it, is a link to
 * that address (`leavesFor`); every other press opens in the window and
 * stays a button, as an underline is kept for what leaves the app. A
 * screen reader hears the chip's kind before its name (`THING_WORD`), since
 * its glyph is hidden from one, unless its name already says it
 * (`thingWordHeard`), and that a gone section is gone after it.
 *
 * Nothing the mention names rides on the chip's element but a link's
 * `href`: no other attribute carries its target, its task, its heading, or
 * its path, because only the attributes that carry words, and `href`, are
 * masked when the panel is recorded (`../session-replay.ts`), and a `data-`
 * attribute is not one of them. The chip's words are a text node, which
 * the recording masks.
 */

/** Where a mention's chip stands: what it names is there, or the plan no longer holds it. */
const MENTION_STATE = {
  FOUND: "found",
  GONE: "gone",
} as const;

type MentionState = (typeof MENTION_STATE)[keyof typeof MENTION_STATE];

/** What a place drawing mentions knows and does: the plan it draws, where its mentions are written, its sections' anchors, and what opening a mention does. */
export interface MentionDoors {
  readonly taskId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
  readonly onOpenTask: (mention: PlanMention) => void;
  /** Shows a file's tab, at its lines where a mention names them; none where no file can be opened from here. */
  readonly onOpenFile: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  /** One of the plan's agents as its chip wears it; none where the place knows the plan's agents not. */
  readonly agentOf?: ((agentId: string) => MentionedAgentLook) | undefined;
  /** The card a pull request one of the plan's agents opened hangs on its Pull request tab, by any link to it; none for any other, or where the place knows the plan's agents not. */
  readonly pullRequestOf?: ((url: string) => ReactNode | undefined) | undefined;
}

/** An agent as its chip wears it: its tile, and the card its tab hangs. */
interface MentionedAgentLook {
  readonly actor: Actor;
  readonly card: ReactNode;
}

/**
 * A mention named again where an edit of the plan it names renamed the
 * section it names or moved its anchor (`../plan-editor/plan-mentions.ts`):
 * the target at its anchor now, under the section's heading now, so the
 * words the plan is saved with call it what its chip does; or nothing where
 * the target names no section of the plan, or one whose heading and anchor
 * the edit left as they were, or one of a section the edit did not keep.
 */
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
  // Note that a heading renamed in case or punctuation alone keeps its anchor and still renames its mentions.
  if (now === mention.anchor && heading === change.before[at]) return undefined;
  return { name: heading, target: encodeMention({ ...mention, anchor: now }, place) };
}

/** What a gone section's card says of it. */
const GONE_WORDS = "No longer in the plan";

/** What a page's card says of it. */
const PAGE_WORDS = "A page on this task";

/** What an agent's card says of it, where the place has no card of its tab: on this task, another, or none. */
const AGENT_WORDS = {
  THIS_TASK: "A coding agent on this task",
  OTHER_TASK: "A coding agent on another task",
  NO_TASK: "A coding agent on no task",
} as const;

/** Whether what the mention names is there to open: a section of this plan is there while a heading of the plan spells its anchor. */
function mentionState(mention: Mention, doors: MentionDoors): MentionState {
  if (mention.kind !== MENTION_KIND.SECTION || mention.taskId !== doors.taskId) {
    return MENTION_STATE.FOUND;
  }
  return doors.anchors.has(mention.anchor) ? MENTION_STATE.FOUND : MENTION_STATE.GONE;
}

/** What a press on the chip does, or nothing where it opens nothing from here; `target` is the mention's link as written. */
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
      // Where no File tab opens it, a file or a folder written as its GitHub page opens there, as its link would.
      return isGitHubAddress(target) ? () => openLink(target) : undefined;
    }
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.DATE:
      return undefined;
    case MENTION_KIND.TASK:
      return () => doors.onOpenTask(mention);
    case MENTION_KIND.SECTION:
      // A gone section opens the task it was in, at its top.
      return () =>
        doors.onOpenTask(
          state === MENTION_STATE.FOUND
            ? mention
            : { kind: MENTION_KIND.TASK, taskId: mention.taskId },
        );
    // A page, an agent, a person, or a channel opens as its Luke link does, through the window's opener, under the workspace it was written in.
    case MENTION_KIND.PAGE:
    case MENTION_KIND.AGENT:
    case MENTION_KIND.PERSON:
    case MENTION_KIND.CHANNEL:
      return () => openLink(target);
    // Luke has no tab of his own on a task, so his chip opens the task he thinks about.
    case MENTION_KIND.LUKE:
      return () => doors.onOpenTask({ kind: MENTION_KIND.TASK, taskId: mention.taskId });
  }
}

/**
 * Whether a press on the chip leaves the app for its address, so it is drawn
 * as a link to it: a page on the web its link names, or a file's or a
 * folder's GitHub page where no File tab opens it. Note that a Luke link,
 * and anything else the window opens in place, is a press, never a link.
 */
function leavesFor(mention: Mention, target: string, doors: MentionDoors): boolean {
  if (!isWebAddress(target) || readLink(target) !== undefined) return false;
  if (mention.kind === MENTION_KIND.LINK) return true;
  const paged = mention.kind === MENTION_KIND.FILE || mention.kind === MENTION_KIND.FOLDER;
  return paged && doors.onOpenFile === undefined;
}

/** The tile an agent of the plan drawn wears, as its tab wears it; none where the place knows the plan's agents not. */
function agentTiles(doors: MentionDoors): AgentTiles | undefined {
  const { agentOf } = doors;
  if (agentOf === undefined) return undefined;
  return { taskId: doors.taskId, tileOf: (agentId) => agentOf(agentId).actor };
}

/** The mark a mention's chip leads with: its thing's (`thing-mark.tsx`), as a link to the same thing leads with it. */
function MentionGlyph({
  mention,
  target,
  name,
  doors,
  known,
  standing,
}: {
  mention: Mention;
  /** Its link's target as written, whose workspace a person is drawn as of. */
  target: string;
  /** The name the chip calls it by, which a person not among the members read is drawn by. */
  name: string;
  doors: MentionDoors;
  known: KnownNames;
  standing?: LinkStanding | undefined;
}): ReactNode {
  return thingMark(thingOfMention(mention), {
    name,
    known,
    where: { taskId: doors.taskId, workspace: doors.place.workspace },
    workspace: readLink(target)?.workspace ?? doors.place.workspace,
    tiles: agentTiles(doors),
    standing,
  });
}

/** What a chip's card says of what it names, beside its name, where the name alone does not say it: a link's address only while its provider has answered nothing, since its key and state say it then. */
function noteOf(
  mention: Mention,
  state: MentionState,
  taskId: string,
  standing: LinkStanding | undefined,
): string | undefined {
  if (state === MENTION_STATE.GONE) return GONE_WORDS;
  if (mention.kind === MENTION_KIND.LINK) return standing === undefined ? mention.url : undefined;
  if (mention.kind === MENTION_KIND.PAGE) return PAGE_WORDS;
  if (mention.kind === MENTION_KIND.AGENT) {
    if (mention.taskId === undefined) return AGENT_WORDS.NO_TASK;
    return mention.taskId === taskId ? AGENT_WORDS.THIS_TASK : AGENT_WORDS.OTHER_TASK;
  }
  return undefined;
}

/** The card a chip hangs: its thing's (`thing-card.tsx`), a file's own card and a server's or a tool's its server's row among them, an agent's tab's or a pull request's Pull request tab's where the place has one, or its glyph and whole name, a provider's page's key and state with what a pull request's notes say, and why it is gone where it is. */
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
  /** Its link's target as written, whose workspace a person's card is read in. */
  target: string;
  name: string;
  state: MentionState;
  doors: MentionDoors;
  known: KnownNames;
  standing: LinkStanding | undefined;
}): ReactNode {
  const workspaceId = useWordsWorkspaceId({
    taskId: doors.taskId,
    workspace: doors.place.workspace,
  });
  const repository = doors.place.repository ?? undefined;
  // Only an agent of the page's own task has a tab here, so only its chip hangs that tab's card.
  const tabCard =
    mention.kind === MENTION_KIND.AGENT && mention.taskId === doors.taskId
      ? doors.agentOf?.(mention.agentId)?.card
      : undefined;
  if (tabCard !== undefined) return tabCard;
  // A pull request one of the plan's agents opened hangs its Pull request tab's card, as the tab does.
  const changesCard =
    mention.kind === MENTION_KIND.LINK ? doors.pullRequestOf?.(mention.url) : undefined;
  if (changesCard !== undefined) return changesCard;
  const whole = mention.kind === MENTION_KIND.FOLDER ? `${mention.path}/` : name;
  const note = noteOf(mention, state, doors.taskId, standing);
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
  const card = (
    <HoverCard data-mention-card="">
      <HoverCardHead
        glyph={glyph}
        name={standing?.title ?? whole}
        sub={mention.kind === MENTION_KIND.FOLDER ? repository : undefined}
      />
      {mention.kind === MENTION_KIND.FOLDER ? (
        <OptionalNote words={branchNote(repository)} />
      ) : null}
      {standing === undefined ? null : standing.pullRequest === undefined ? (
        <>
          <HoverCardNote>
            {standing.state === undefined ? standing.key : `${standing.key} · ${standing.state}`}
          </HoverCardNote>
          {standing.opener === undefined ? (
            <OptionalNote words={standing.byline} />
          ) : (
            <OpenedNote opener={standing.opener} />
          )}
        </>
      ) : (
        <PullRequestCardNotes
          heading={
            standing.state === undefined ? standing.key : `${standing.key} · ${standing.state}`
          }
          pullRequest={standing.pullRequest}
          opener={standing.opener}
        />
      )}
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
    </HoverCard>
  );
  // Note that what the mention names hangs the card the window hangs for it elsewhere, its own card standing in where the window holds none.
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

/** A card's note, where there are words for one. */
function OptionalNote({ words }: { words: string | undefined }): ReactNode {
  return words === undefined ? null : <HoverCardNote>{words}</HoverCardNote>;
}

/**
 * The card a mention's chip hangs, for a row that names the same thing
 * rather than a chip, as a pull request's or a page's lone link card does
 * (`lone-link-card.tsx`), so the row and the chip hang one card.
 */
export function MentionChipCard({
  mention,
  target,
  name,
  doors,
  standing,
}: {
  mention: Mention;
  /** Its link's target as written. */
  target: string;
  /** The name the row calls it. */
  name: string;
  doors: MentionDoors;
  /** What its provider answered for it, as the row read it. */
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

/**
 * What a chip calls a mention: the name of what it names as the window
 * holds it now (`THING_NAME`), the plan's, the section's heading, the
 * page's, the agent's as its tab names it, the person's, Luke, whatever
 * words it was written with; else the name it was written with; and a
 * provider's page written as its bare address, by the key and title its
 * provider answered for it, and a pull request or an issue by its key alone,
 * `#42` or `relay#42` off `repository`, until it does.
 */
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
  // Note that a plan the window still lists Untitled keeps the name it was written with, which says more.
  if (thing.kind === THING_KIND.PLAN && held === UNTITLED_TASK_NAME) return written;
  return (live || bare ? held : undefined) ?? written;
}

/**
 * What a pull request's or a GitHub issue's chip is called once GitHub
 * answered for it, whatever words its link was written with: its number and
 * its live title, `#42 Fix the refresh`, as a pull request's tab and row are
 * named. Never its repository, which its card says; nothing for any other
 * mention, or one GitHub answered nothing for, which keeps the words it was
 * written with.
 */
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

/** A mention in words: its chip, a button that opens what it names where it can, or a link where that leaves the app, hanging its card. */
function MentionChip({
  mention,
  target,
  name: written,
  doors,
  bare = false,
}: {
  mention: Mention;
  /** Its link's target as written, which names it. */
  target: string;
  /** The name it was written with, without its `@`. */
  name: string;
  doors: MentionDoors;
  /** Whether it was written as its bare address, so a provider's page is called by the key and title its provider answered. */
  bare?: boolean;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const known = useKnownNames();
  const standing = useLinkStanding(mention, {
    taskId: doors.taskId,
    workspace: doors.place.workspace,
  });
  const section = mention.kind === MENTION_KIND.SECTION ? mention : undefined;
  const heading = useSectionHeading(section?.taskId, section?.anchor ?? "");
  useTaskNameCatchUp(mention.kind === MENTION_KIND.TASK ? mention.taskId : undefined);
  // Note that a plan written as its own key (`ACME-42`) says the key, as the words wrote it, and one labelled with another task's key its name.
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
      kind={thingWordHeard(thingOfMention(mention).kind, name)}
      label={name}
      state={standing?.state}
      gone={state === MENTION_STATE.GONE}
      onPress={
        press === undefined
          ? undefined
          : (event) => {
              // Note that the press stops here, because a click into a section opens its editor.
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

/** A date mention. */
type DateMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.DATE }>;

/** A date's card: the date in full, in the reader's zone, and how far off it is now. */
function DateCard({ date }: { date: DateMention }): React.JSX.Element {
  const now = useMinute();
  const zone = readerZone();
  return (
    <HoverCard data-mention-card="">
      <HoverCardHead glyph={<CalendarIcon aria-hidden="true" />} name={dateWhole(date, zone)} />
      <HoverCardNote>{dateDistance(date, now, zone)}</HoverCardNote>
    </HoverCard>
  );
}

/** A date in words: its chip, saying it from the reader's today and moving on as the minute turns, hanging its card, and opening its picker where `onPick` is given. */
function DateChip({
  date,
  onPick,
}: {
  date: DateMention;
  /** Opens the date's picker hung from the chip; none where the words take no change. */
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
              // Note that the press stops here, as a mention's does, because a click into a section opens its editor.
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

/**
 * A date's link drawn in words as its chip, opening its picker where the
 * words take a change and say where the link is written in them
 * (`words-dates.tsx`), and nothing elsewhere.
 */
function WrittenDateChip({
  date,
  at,
  place,
}: {
  date: DateMention;
  /** Where its link is written in the words drawn; none where the place drawing them says not. */
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

/** The mark a place in Luke leads with: its thing's (`thing-mark.tsx`), as a mention of the same thing leads with it. */
function PlaceGlyph({
  place,
  name,
  workspace,
  known,
  doors,
}: {
  place: LinkPlace;
  name: string;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  known: KnownNames;
  doors: MentionDoors;
}): ReactNode {
  return thingMark(thingOfPlace(place), {
    name,
    known,
    where: { taskId: "planId" in place ? (place.planId ?? NO_TASK_ID) : NO_TASK_ID, workspace },
    workspace,
    tiles: agentTiles(doors),
    standing: undefined,
  });
}

/**
 * A link to a place in Luke that no mention names, an agent's or a page's
 * say: its chip, the place's glyph and its name as the window knows it
 * (`placeChipLook`), a button that opens the place in the window, hanging a
 * card naming it and the task it stands under.
 */
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
  /** The slug of the workspace the link was written under. */
  workspace: string;
  /** The words it was labelled with, without an `@`; none where it was written bare. */
  label: string | undefined;
  /** The doors of the words the link is written in, whose plan's agents wear their tabs' tiles. */
  doors: MentionDoors;
  /** The names the window holds beyond its own, an Inbox item's read as its chip stands say. */
  read?: ((known: KnownNames) => KnownNames) | undefined;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const held = useKnownNames("automationId" in place ? place.automationId : undefined);
  const known = read === undefined ? held : read(held);
  const planned = place.kind === LINK_PLACE.TASK || place.kind === LINK_PLACE.VERSION;
  useTaskNameCatchUp(planned ? place.planId : undefined);
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
        // Note that the press stops here, as a mention's does, because a click into a section opens its editor.
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

/**
 * The card a place in Luke hangs, as the window hangs it wherever it names
 * the place, by its thing's kind (`thing-card.tsx`): a plan's, a section's,
 * a version's, a page's, an agent's, a member's, an Inbox item's, or an
 * automation's; `fallback`, the chip's glyph and name, for any other, and
 * where the window holds none.
 */
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
  /** The chip's glyph, which its card wears while what it shows is read. */
  glyph: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const workspaceId = useWordsWorkspaceId({
    taskId: "planId" in place ? (place.planId ?? NO_TASK_ID) : NO_TASK_ID,
    workspace,
  });
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

/** A link to an Inbox item. */
type InboxItemLinkPlace = Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>;

/** An Inbox item's chip, called by the item's title whether it waits or was settled, as its Inbox row is, which only its followed inbox holds once it no longer waits. */
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

/** The plan of a place that names none, which no plan's id spells. */
const NO_TASK_ID = "";

/** The kind a chip of a place in Luke carries beside a mention's kinds, for its styles and a test. */
const MENTION_KIND_PLACE = "place";

/**
 * The doors a link's chip opens through: the place's, or, where the place
 * names no repository and the link is a GitHub page of a file or a folder,
 * the place's under the repository the page names, so the chip is that
 * file's or folder's, of that repository, and opens no File tab, which
 * reads the place's repository alone.
 */
function pageDoors(doors: MentionDoors, href: string): MentionDoors {
  const repository = doors.place.repository === null ? pageRepositoryOf(href) : undefined;
  if (repository === undefined) return doors;
  return { ...doors, place: { ...doors.place, repository }, onOpenFile: undefined };
}

/**
 * A link in words as its chip, through the doors given: a mention's where
 * its target names one (`linkMention`), a place's in Luke where it is a
 * Luke link no mention names (`readLink`); nothing where it is neither, and
 * it stays a link. `at` is where the link is written in the words drawn,
 * which a date's chip names to its picker in words that take a change.
 */
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

/** What draws a link in Markdown as its chip through the doors given (`linkChip`); a link where it names nothing. */
export function mentionLinkDrawer(doors: MentionDoors): LinkDrawer {
  return (href, label, at) => linkChip(href, label, doors, at);
}

/** What a place pasted into knows to call a pasted address by: the names the window holds, and the plan it stands on, whose headings name its sections. */
export interface PastedNames {
  readonly known: KnownNames;
  readonly taskId: string;
  /** The plan's text as the place holds it. */
  readonly text: () => string;
}

/** What a pasted address's chip is called: a section of the plan pasted on by its heading, a plan, a page, or an agent by the name the window holds, else what its address says. */
function pastedName(
  mention: Mention,
  said: string,
  names: PastedNames,
  repository: string | null,
): string {
  if (mention.kind !== MENTION_KIND.SECTION)
    return chipName(mention, said, true, names.known, undefined, undefined, repository);
  if (mention.taskId !== names.taskId) return said;
  const headings = planSections(names.text()).map((section) => section.heading);
  return headings[sectionAnchors(headings).indexOf(mention.anchor)] ?? said;
}

/**
 * The mention node words pasted whole stand for: an address of Luke's own,
 * a plan's, a section's, a page's, or an agent's, by the scheme of the web
 * or the app's own, named as its bare link's chip is (`pastedName`); or a
 * page of an integration's, named by its address's readable form; nothing
 * for any other words, a file of the plan's repository among them, or a
 * person's page in another workspace than the place's.
 */
export function pastedMentionNode(
  words: string,
  place: MentionPlace,
  names: PastedNames,
): MentionNode | undefined {
  const link = pastedLinkMention(words, place.repository);
  // A person's page is of the workspace its link names, so one of another workspace stays the link it is.
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

/** What an editor hands a chip it holds: the doors to its node, and what opens the date picker over its words. */
export interface MentionNodeEdit {
  readonly node: MentionNodeDoors;
  readonly pickDate: (opening: DatePickerOpening) => void;
}

/**
 * A date's picker closed over its chip: Clear takes the chip out, a date
 * changed names it anew in place, and a key hands the caret back after it.
 */
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
  // Note that a zone picked names the date anew even where its moment stands, as at another zone of the same offset.
  const moved =
    picked.changed &&
    date !== undefined &&
    (date.start !== was.start || date.end !== was.end || picked.zonePicked);
  if (moved) node.rename(dateMentionNode(date, place, picked.zone), keyed);
  else if (keyed) node.focusAfter();
}

/** A mention an editor holds, as its node names it: its chip where its target names a mention, and its words where it names none; a date's opens its picker where the editor hands what changes it. */
export function MentionNodeChip({
  mention,
  doors,
  edit,
}: {
  mention: MentionNode;
  doors: MentionDoors;
  /** What changes the node; none where the editor hands nothing. */
  edit?: MentionNodeEdit | undefined;
}): React.JSX.Element {
  const named = decodeMention(mention.target, doors.place.repository);
  if (named === undefined) return <>{`@${mention.name}`}</>;
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
