import { CHECK_SUMMARY } from "@luke/features/coding-agent-wire";
import { INTEGRATION_NAME } from "@luke/features/integration-wire";
import { LINK_PLACE, type LinkPlace, readLink } from "@luke/features/luke-link";
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
  pastedLinkMention,
  sectionAnchors,
} from "@luke/features/mention-link";
import { placeChipLook } from "@luke/features/place-chip-model";
import { CallIcon, DocumentIcon, GearIcon, ProviderMark, UserIcon } from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import { fileName } from "@luke/voice/code-pane-model";
import {
  AppWindowIcon,
  BotIcon,
  FactoryIcon,
  FileDiffIcon,
  FolderIcon,
  HashIcon,
  InboxIcon,
  MessageSquareIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { CardHead, CardNote, HoverCard } from "../hover-card";
import type { LinkDrawer } from "../markdown-message";
import type { HeadingsChange, MentionNode } from "../plan-editor/contract";
import { Tooltip } from "../tooltip";
import { FileCard } from "./file-ref";
import { shortCommit } from "./file-tab-model";
import { FileTypeIcon } from "./file-type-icon";
import { IssueMark } from "./issue-mark";
import { PullRequestMark } from "./pull-request-mark";
import { AgentMark } from "./tab-look";
import { useKnownNames } from "./use-known-names";
import { type LinkStanding, useLinkStanding } from "./use-link-standing";
import { useOpenLink } from "./use-open-link";

/**
 * mention-chip.tsx -- a mention drawn in words as its chip: its kind's glyph and its name, a button that opens what it names, hanging a card that says what that is, struck through where what it names is gone.
 *
 * A mention is written into markdown as a link whose target names it
 * (`@luke/features/mention-link`'s `linkMention`), a developer's with a
 * label starting with `@`, and wherever words are drawn, the link is drawn
 * as this chip: a pill on the words' line, the kind's glyph and the name the
 * mention was written with, cut to the chip's width. A press opens it: a
 * section of a plan, that plan scrolled to the section; a plan, the plan
 * at its top; a file, its tab, through the side panel's one door for a file
 * (`file-ref.tsx`). A folder opens nothing, since the window has no door to
 * one, and is a chip that hangs its card alone, as is a file where the
 * place can open none. An MCP server or one of its tools opens nothing
 * either, wearing its server's mark; a page of an integration's, a Linear
 * issue say, wears the integration's mark and opens the page in the
 * browser, its card saying its address. A Linear issue's chip, a pull
 * request's, and a GitHub issue's say the state it stands in after their
 * name, a pull request's and a GitHub issue's wearing GitHub's mark for it,
 * and a bare one is called by its key and title, as
 * the workspace's own Linear or GitHub App answers them on the service
 * (`use-link-standing.ts`). A page an agent showed on a plan
 * wears its tab's glyph, and one of a plan's coding agents its harness's
 * mark, as the place drawing it knows it (`MentionDoors.agentOf`); either
 * opens its tab through the window's opener for a Luke link, as a link
 * copied to it does, and an agent hangs its tab's own card where the place
 * has one. A link to any other place in Luke, a member, an Inbox item, an
 * automation, an agent's message (`@luke/features/luke-link`), is drawn as
 * the same chip, wearing the place's glyph and named as the window already
 * knows it (`@luke/features/place-chip-model`): the words it was labelled
 * with, else the place's own name, else its kind; and a bare plan's, page's,
 * or agent's link is called by the task's, the page's, or the agent's own
 * name where the window holds it, rather than by its kind. A press opens the
 * place as any Luke link opens, in the window. Its card, hung while the pointer rests
 * on it, names it whole: a file's is the card every place naming the file
 * hangs, and a file's lines open at the commit the mention pins them to.
 *
 * A section is known by its heading's anchor, so a section of the plan
 * drawn here whose anchor no heading of the plan spells any longer is gone:
 * its chip keeps the name it was written with, struck through, its card
 * says it is no longer in the plan, and a press opens the plan at its top.
 * A section of another plan is drawn as found, since what that plan holds
 * is not at hand.
 *
 * Nothing the mention names rides on the chip's element: no attribute
 * carries its target, its plan, its heading, or its path, because only the
 * attributes that carry words are masked when the panel is recorded
 * (`../session-replay.ts`), and a `data-` attribute is not one of them.
 * The chip's words are a text node, which the recording masks.
 */

/** Where a mention's chip stands: what it names is there, or the plan no longer holds it. */
const MENTION_STATE = {
  FOUND: "found",
  GONE: "gone",
} as const;

type MentionState = (typeof MENTION_STATE)[keyof typeof MENTION_STATE];

/** What a place drawing mentions knows and does: the plan it draws, where its mentions are written, its sections' anchors, and what opening a mention does. */
export interface MentionDoors {
  readonly planId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
  readonly onOpenPlan: (mention: PlanMention) => void;
  /** Shows a file's tab, at its lines where a mention names them; none where no file can be opened from here. */
  readonly onOpenFile: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  /** One of the plan's agents as its chip wears it; none where the place knows the plan's agents not. */
  readonly agentOf?: ((agentId: string) => MentionedAgentLook) | undefined;
}

/** An agent as its chip wears it: its tile, and the card its tab hangs. */
interface MentionedAgentLook {
  readonly actor: Actor;
  readonly card: ReactNode;
}

/**
 * A mention's target named again where an edit of the plan it names moved
 * the anchor of the section it names (`../plan-editor/plan-mentions.ts`):
 * the new target, or nothing where the target names no section of the
 * plan, or one whose anchor the edit left where it was, or one of a
 * section the edit did not keep.
 */
export function retargetedMention(
  planId: string,
  place: MentionPlace,
  target: string,
  change: HeadingsChange,
): string | undefined {
  const mention = decodeMention(target, place.repository);
  if (mention?.kind !== MENTION_KIND.SECTION || mention.taskId !== planId) return undefined;
  const was = sectionAnchors(change.before);
  const is = sectionAnchors(change.after);
  const at = was.indexOf(mention.anchor);
  const now = is[change.kept.get(at) ?? -1];
  if (now === undefined || now === "" || now === mention.anchor) return undefined;
  return encodeMention({ ...mention, anchor: now }, place);
}

/** What a gone section's card says of it. */
const GONE_WORDS = "No longer in the plan";

/** What a server's card says of it. */
const SERVER_WORDS = "An MCP server";

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
  if (mention.kind !== MENTION_KIND.SECTION || mention.taskId !== doors.planId) {
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
    case MENTION_KIND.FILE: {
      const { onOpenFile } = doors;
      return onOpenFile === undefined ? undefined : () => onOpenFile(mention.path, mention.lines);
    }
    case MENTION_KIND.FOLDER:
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
      return undefined;
    case MENTION_KIND.TASK:
      return () => doors.onOpenPlan(mention);
    case MENTION_KIND.SECTION:
      // A gone section opens the plan it was in, at its top.
      return () =>
        doors.onOpenPlan(
          state === MENTION_STATE.FOUND
            ? mention
            : { kind: MENTION_KIND.TASK, taskId: mention.taskId },
        );
    // A page or an agent opens its tab as its Luke link does, through the window's opener, under the workspace it was written in.
    case MENTION_KIND.PAGE:
    case MENTION_KIND.AGENT:
      return () => openLink(target);
  }
}

function MentionGlyph({
  mention,
  doors,
  standing,
}: {
  mention: Mention;
  doors: MentionDoors;
  standing?: LinkStanding | undefined;
}): React.JSX.Element {
  // A pull request its provider answered for wears its own mark for where it stands, as everywhere the window draws one.
  if (standing?.pullRequest !== undefined) {
    return (
      <PullRequestMark pullRequest={{ ...standing.pullRequest, checks: CHECK_SUMMARY.NONE }} />
    );
  }
  // And a GitHub issue its own, as GitHub draws it.
  if (standing?.issue !== undefined) return <IssueMark issue={standing.issue} />;
  switch (mention.kind) {
    case MENTION_KIND.SECTION:
      return <HashIcon aria-hidden="true" />;
    case MENTION_KIND.TASK:
      return <DocumentIcon />;
    case MENTION_KIND.FILE:
      return <FileTypeIcon name={fileName(mention.path)} />;
    case MENTION_KIND.FOLDER:
      return <FolderIcon aria-hidden="true" />;
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return <ProviderMark provider={mention.provider} />;
    case MENTION_KIND.PAGE:
      return <AppWindowIcon aria-hidden="true" />;
    case MENTION_KIND.AGENT: {
      const look = mention.taskId === doors.planId ? doors.agentOf?.(mention.agentId) : undefined;
      return look === undefined ? (
        <AgentMark provider={undefined} />
      ) : (
        <ActorMark actor={look.actor} size={ACTOR_SIZE.INLINE} />
      );
    }
  }
}

/** What a chip's card says of what it names, beside its name, where the name alone does not say it. */
function noteOf(mention: Mention, state: MentionState, planId: string): string | undefined {
  if (state === MENTION_STATE.GONE) return GONE_WORDS;
  if (mention.kind === MENTION_KIND.SERVER) return SERVER_WORDS;
  if (mention.kind === MENTION_KIND.TOOL)
    return `A tool of ${INTEGRATION_NAME[mention.provider]}'s MCP server`;
  if (mention.kind === MENTION_KIND.LINK) return mention.url;
  if (mention.kind === MENTION_KIND.PAGE) return PAGE_WORDS;
  if (mention.kind === MENTION_KIND.AGENT) {
    if (mention.taskId === undefined) return AGENT_WORDS.NO_TASK;
    return mention.taskId === planId ? AGENT_WORDS.THIS_TASK : AGENT_WORDS.OTHER_TASK;
  }
  return undefined;
}

/** What a file's card says of the lines a mention pins: where they run, and the commit they were read at. */
function linesNote(lines: MentionLines | undefined): string | undefined {
  if (lines === undefined) return undefined;
  const span =
    lines.startLine === lines.endLine
      ? `Line ${lines.startLine}`
      : `Lines ${lines.startLine}–${lines.endLine}`;
  return `${span} at ${shortCommit(lines.commit)}`;
}

/** The card a chip hangs: a file's own card, an agent's tab's where the place has one, or its glyph and whole name, and why it is gone where it is. */
function MentionCard({
  mention,
  name,
  state,
  doors,
  standing,
}: {
  mention: Mention;
  name: string;
  state: MentionState;
  doors: MentionDoors;
  standing: LinkStanding | undefined;
}): ReactNode {
  if (mention.kind === MENTION_KIND.FILE) {
    return <FileCard path={mention.path} note={linesNote(mention.lines)} />;
  }
  // Only an agent of the page's own task has a tab here, so only its chip hangs that tab's card.
  const tabCard =
    mention.kind === MENTION_KIND.AGENT && mention.taskId === doors.planId
      ? doors.agentOf?.(mention.agentId)?.card
      : undefined;
  if (tabCard !== undefined) return tabCard;
  const whole = mention.kind === MENTION_KIND.FOLDER ? `${mention.path}/` : name;
  const note = noteOf(mention, state, doors.planId);
  return (
    <HoverCard data-mention-card="">
      <CardHead
        glyph={<MentionGlyph mention={mention} doors={doors} standing={standing} />}
        name={standing?.title ?? whole}
      />
      {standing === undefined ? null : (
        <CardNote>
          {standing.state === undefined ? standing.key : `${standing.key} · ${standing.state}`}
        </CardNote>
      )}
      {note === undefined ? null : <CardNote>{note}</CardNote>}
    </HoverCard>
  );
}

/**
 * What a chip calls a mention: the name it was written with, unless it was
 * written as its bare address and the window holds better, the name of the
 * plan, the page, or the agent it names, or the key and title a provider
 * answered for its page.
 */
function bareName(
  mention: Mention,
  written: string,
  bare: boolean,
  known: ReturnType<typeof useKnownNames>,
  standing: LinkStanding | undefined,
): string {
  if (!bare) return written;
  switch (mention.kind) {
    case MENTION_KIND.LINK:
      return standing === undefined ? written : `${standing.key} ${standing.title}`;
    case MENTION_KIND.TASK:
      return known.plans.get(mention.taskId) ?? written;
    case MENTION_KIND.PAGE:
      return known.pages.get(mention.pageId) ?? written;
    case MENTION_KIND.AGENT:
      return known.agents.get(mention.agentId) ?? written;
    default:
      return written;
  }
}

/** A mention in words: its chip, a button that opens what it names where it can, hanging its card. */
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
  /** Whether it was written as its bare address, so a plan, a page, an agent, or a provider's page is called by its own name where the window holds it. */
  bare?: boolean;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const known = useKnownNames();
  const standing = useLinkStanding(mention, {
    planId: doors.planId,
    workspace: doors.place.workspace,
  });
  const name = bareName(mention, written, bare, known, standing);
  const state = mentionState(mention, doors);
  const press = pressOf(mention, target, state, doors, openLink);
  const face = (
    <>
      <span className="mention-chip-glyph">
        <MentionGlyph mention={mention} doors={doors} standing={standing} />
      </span>
      <span className="mention-chip-label">{name}</span>
      {standing?.state === undefined ? null : (
        <span className="mention-chip-state">{standing.state}</span>
      )}
    </>
  );
  const card = (
    <MentionCard mention={mention} name={name} state={state} doors={doors} standing={standing} />
  );
  return (
    <Tooltip label={name} card={card}>
      {press === undefined ? (
        <span className="mention-chip" data-kind={mention.kind} data-state={state}>
          {face}
        </span>
      ) : (
        <button
          type="button"
          className="mention-chip"
          data-kind={mention.kind}
          data-state={state}
          onClick={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            press();
          }}
        >
          {face}
        </button>
      )}
    </Tooltip>
  );
}

/** The glyph a place in Luke wears, the one its tab or its row in the window wears. */
function PlaceGlyph({ kind }: { kind: LinkPlace["kind"] }): React.JSX.Element {
  switch (kind) {
    case LINK_PLACE.TASK:
    case LINK_PLACE.VERSION:
    case LINK_PLACE.TURN:
      return <DocumentIcon />;
    case LINK_PLACE.SECTION:
      return <HashIcon aria-hidden="true" />;
    case LINK_PLACE.PAGE:
      return <AppWindowIcon aria-hidden="true" />;
    case LINK_PLACE.CALL:
      return <CallIcon />;
    case LINK_PLACE.AGENT:
      return <AgentMark provider={undefined} />;
    case LINK_PLACE.WORKER:
      return <BotIcon aria-hidden="true" />;
    case LINK_PLACE.CHANGES:
      return <FileDiffIcon aria-hidden="true" />;
    case LINK_PLACE.MESSAGE:
      return <MessageSquareIcon aria-hidden="true" />;
    case LINK_PLACE.INBOX:
    case LINK_PLACE.INBOX_ITEM:
      return <InboxIcon aria-hidden="true" />;
    case LINK_PLACE.AUTOMATIONS:
    case LINK_PLACE.AUTOMATION:
    case LINK_PLACE.AUTOMATION_RUN:
      return <ZapIcon aria-hidden="true" />;
    case LINK_PLACE.FACTORY:
      return <FactoryIcon aria-hidden="true" />;
    case LINK_PLACE.SETTINGS:
      return <GearIcon />;
    case LINK_PLACE.PERSON:
      return <UserIcon />;
  }
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
  label,
}: {
  href: string;
  place: LinkPlace;
  /** The words it was labelled with, without an `@`; none where it was written bare. */
  label: string | undefined;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const known = useKnownNames("automationId" in place ? place.automationId : undefined);
  const { name, under } = placeChipLook(place, label, known);
  const glyph = <PlaceGlyph kind={place.kind} />;
  const card = (
    <HoverCard data-mention-card="">
      <CardHead glyph={glyph} name={name} />
      {under === undefined ? null : <CardNote>{`In ${under}`}</CardNote>}
    </HoverCard>
  );
  return (
    <Tooltip label={name} card={card}>
      <button
        type="button"
        className="mention-chip"
        data-kind={MENTION_KIND_PLACE}
        onClick={(event) => {
          // Note that the press stops here, as a mention's does, because a click into a section opens its editor.
          event.stopPropagation();
          openLink(href);
        }}
      >
        <span className="mention-chip-glyph">{glyph}</span>
        <span className="mention-chip-label">{name}</span>
      </button>
    </Tooltip>
  );
}

/** The kind a chip of a place in Luke carries beside a mention's kinds, for its styles and a test. */
const MENTION_KIND_PLACE = "place";

/**
 * A link in words as its chip, through the doors given: a mention's where
 * its target names one (`linkMention`), a place's in Luke where it is a
 * Luke link no mention names (`readLink`); nothing where it is neither, and
 * it stays a link.
 */
export function linkChip(
  href: string,
  label: string,
  doors: MentionDoors,
): React.JSX.Element | undefined {
  const bare = isBareLink(label, href);
  const found = linkMention(label, href, doors.place.repository);
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
  const read = readLink(href);
  if (read === undefined) return undefined;
  return (
    <PlaceChip
      href={href}
      place={read.place}
      label={bare ? undefined : mentionName(label.trim())}
    />
  );
}

/** What draws a link in Markdown as its chip through the doors given (`linkChip`); a link where it names nothing. */
export function mentionLinkDrawer(doors: MentionDoors): LinkDrawer {
  return (href, label) => linkChip(href, label, doors);
}

/** The mention node words pasted whole stand for: a page of an integration's, named by its address's readable form; nothing for any other words, a file of the plan's repository among them. */
export function pastedMentionNode(words: string, place: MentionPlace): MentionNode | undefined {
  const link = pastedLinkMention(words, place.repository);
  return link === undefined
    ? undefined
    : { name: link.name, target: encodeMention(link.mention, place) };
}

/** A mention an editor holds, as its node names it: its chip where its target names a mention, and its words where it names none. */
export function MentionNodeChip({
  mention,
  doors,
}: {
  mention: MentionNode;
  doors: MentionDoors;
}): React.JSX.Element {
  const named = decodeMention(mention.target, doors.place.repository);
  if (named === undefined) return <>{`@${mention.name}`}</>;
  return <MentionChip mention={named} target={mention.target} name={mention.name} doors={doors} />;
}
