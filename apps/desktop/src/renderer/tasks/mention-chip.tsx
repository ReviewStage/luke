import { CHECK_SUMMARY } from "@luke/features/coding-agent-wire";
import { issueAddressOf, pullRequestAddressOf } from "@luke/features/github-repositories-wire";
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
import { type KnownNames, placeChipLook } from "@luke/features/place-chip-model";
import { planSections } from "@luke/features/plan-document";
import { ACTOR_SIZE, ActorMark } from "@luke/panel/actor-ref";
import { InlineRef } from "@luke/panel/inline-ref";
import type { LinkDrawer } from "@luke/panel/markdown-message";
import { usePerson } from "@luke/panel/member-directory";
import type { HeadingsChange, MentionNode } from "@luke/panel/plan-editor/contract";
import { providerOf } from "@luke/panel/tasks/coding-agent-model";
import { FileCard } from "@luke/panel/tasks/file-ref";
import { shortCommit } from "@luke/panel/tasks/file-tab-model";
import { FileTypeIcon } from "@luke/panel/tasks/file-type-icon";
import { IssueMark } from "@luke/panel/tasks/issue-mark";
import { OpenedNote, PullRequestCardNotes } from "@luke/panel/tasks/pull-request-card-notes";
import { PullRequestMark } from "@luke/panel/tasks/pull-request-mark";
import { ServerCard } from "@luke/panel/tasks/server-card";
import { AgentMark } from "@luke/panel/tasks/tab-look";
import { useKnownNames } from "@luke/panel/tasks/use-known-names";
import {
  type ChipWhere,
  type LinkStanding,
  useLinkStanding,
  useWordsWorkspaceId,
} from "@luke/panel/tasks/use-link-standing";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import { useAppState } from "@luke/panel/use-app-state";
import {
  CallIcon,
  CommentsIcon,
  DocumentIcon,
  GearIcon,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  ProviderMark,
  UserIcon,
} from "@luke/ui";
import { ACTOR_KIND, type Actor } from "@luke/ui/actor-model";
import { fileName } from "@luke/voice/code-pane-model";
import {
  AppWindowIcon,
  BotIcon,
  FactoryIcon,
  FileDiffIcon,
  FolderIcon,
  HashIcon,
  InboxIcon,
  ListTodoIcon,
  MessageSquareIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  AutomationChipCard,
  InboxItemChipCard,
  PageChipCard,
  PersonChipCard,
  SectionChipCard,
  TaskChipCard,
  VersionChipCard,
} from "./chip-cards";
import { MentionedAgentCard, ReadAgentModel } from "./mentioned-agent-card";

/**
 * mention-chip.tsx -- a mention drawn in words as its chip: its kind's glyph and its name, a button that opens what it names, hanging a card that says what that is, struck through where what it names is gone.
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
 * place can open none. An MCP server or one of its tools opens nothing
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
 * (`../member-directory.tsx`), and opens their page in the workspace. A link to any other place in Luke, an Inbox item, an
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
 * says it is no longer in the plan, and a press opens the task at its top.
 * A section of another task is drawn as found, since what that task holds
 * is not at hand.
 *
 * Nothing the mention names rides on the chip's element: no attribute
 * carries its target, its task, its heading, or its path, because only the
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
  readonly taskId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
  readonly onOpenTask: (mention: PlanMention) => void;
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
  taskId: string,
  place: MentionPlace,
  target: string,
  change: HeadingsChange,
): string | undefined {
  const mention = decodeMention(target, place.repository);
  if (mention?.kind !== MENTION_KIND.SECTION || mention.taskId !== taskId) return undefined;
  const was = sectionAnchors(change.before);
  const is = sectionAnchors(change.after);
  const at = was.indexOf(mention.anchor);
  const now = is[change.kept.get(at) ?? -1];
  if (now === undefined || now === "" || now === mention.anchor) return undefined;
  return encodeMention({ ...mention, anchor: now }, place);
}

/** What a gone section's card says of it. */
const GONE_WORDS = "No longer in the plan";

/** Where a file or a folder no lines pin is read: the head of its repository's default branch, as its link names it. */
const DEFAULT_BRANCH_WORDS = "On the default branch";

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
    case MENTION_KIND.FILE: {
      const { onOpenFile } = doors;
      return onOpenFile === undefined ? undefined : () => onOpenFile(mention.path, mention.lines);
    }
    case MENTION_KIND.FOLDER:
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
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
    // A page or an agent opens its tab as its Luke link does, through the window's opener, under the workspace it was written in.
    case MENTION_KIND.PAGE:
    case MENTION_KIND.AGENT:
    case MENTION_KIND.PERSON:
      return () => openLink(target);
  }
}

/** The harness an agent runs in, read off its model; the mark of no known harness where no model is known. */
function harnessMark(model: string | undefined): React.JSX.Element {
  return <AgentMark provider={model === undefined ? undefined : providerOf(model)} />;
}

/**
 * The mark of an agent the place holds no tile of: the harness the window
 * last read it running on, and where the window holds no model of it, an
 * archived agent's or one past the few its task's row names, the one read
 * for it (`ReadAgentModel`).
 */
function KnownAgentMark({
  agentId,
  taskId,
  name,
  where,
  known,
}: {
  agentId: string;
  taskId: string | undefined;
  /** The name the chip calls it by, which an agent on no task is found by. */
  name: string;
  /** Where the chip stands, whose workspace an agent on no task is found in. */
  where: ChipWhere;
  known: KnownNames;
}): React.JSX.Element {
  const workspaceId = useWordsWorkspaceId(where);
  const held = useAppState() !== undefined;
  const model = known.agentModels.get(agentId);
  // Note that nothing is read before main's document lands, because the agent may be among those it lists.
  if (model !== undefined || !held) return harnessMark(model);
  return (
    <ReadAgentModel agentId={agentId} taskId={taskId} workspaceId={workspaceId} name={name}>
      {harnessMark}
    </ReadAgentModel>
  );
}

/** A person as the workspace's members around the chip draw them: their picture, or grayed where they left. */
function PersonGlyph({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  const person = usePerson({ userId, name });
  return <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />;
}

function MentionGlyph({
  mention,
  name,
  doors,
  known,
  standing,
}: {
  mention: Mention;
  /** The name the chip calls it by, which a person not among the members read is drawn by. */
  name: string;
  doors: MentionDoors;
  known: KnownNames;
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
      const look = mention.taskId === doors.taskId ? doors.agentOf?.(mention.agentId) : undefined;
      // Note that a tile the page knows no harness of, its agents not yet read say, gives way to the mark read for it.
      const harnessless =
        look === undefined ||
        (look.actor.kind === ACTOR_KIND.AGENT && look.actor.provider === undefined);
      return harnessless ? (
        <KnownAgentMark
          agentId={mention.agentId}
          taskId={mention.taskId}
          name={name}
          where={{ taskId: doors.taskId, workspace: doors.place.workspace }}
          known={known}
        />
      ) : (
        <ActorMark actor={look.actor} size={ACTOR_SIZE.INLINE} />
      );
    }
    case MENTION_KIND.PERSON:
      return <PersonGlyph userId={mention.userId} name={name} />;
  }
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

/** What a file's or a folder's card says of where it is read with no lines pinned: the repository's default branch, where a repository names it. */
function branchNote(repository: string | undefined): string | undefined {
  return repository === undefined ? undefined : DEFAULT_BRANCH_WORDS;
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

/** The card a chip hangs: a file's own card, a server's or a tool's its server's row, an agent's tab's where the place has one, or its glyph and whole name, a provider's page's key and state with what a pull request's notes say, and why it is gone where it is. */
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
  if (mention.kind === MENTION_KIND.FILE) {
    return (
      <FileCard
        path={mention.path}
        repository={repository}
        note={linesNote(mention.lines) ?? branchNote(repository)}
      />
    );
  }
  if (mention.kind === MENTION_KIND.SERVER || mention.kind === MENTION_KIND.TOOL) {
    return (
      <ServerCard
        provider={mention.provider}
        connection={mention.connection}
        tool={mention.kind === MENTION_KIND.TOOL ? mention.tool : undefined}
      />
    );
  }
  // Only an agent of the page's own task has a tab here, so only its chip hangs that tab's card.
  const tabCard =
    mention.kind === MENTION_KIND.AGENT && mention.taskId === doors.taskId
      ? doors.agentOf?.(mention.agentId)?.card
      : undefined;
  if (tabCard !== undefined) return tabCard;
  const whole = mention.kind === MENTION_KIND.FOLDER ? `${mention.path}/` : name;
  const note = noteOf(mention, state, doors.taskId, standing);
  const card = (
    <HoverCard data-mention-card="">
      <HoverCardHead
        glyph={
          <MentionGlyph
            mention={mention}
            name={name}
            doors={doors}
            known={known}
            standing={standing}
          />
        }
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
  // A plan, a section, a page, or an agent hangs the card the window hangs for it elsewhere, its own card standing in where the window holds none.
  switch (mention.kind) {
    case MENTION_KIND.TASK:
      return <TaskChipCard taskId={mention.taskId} fallback={card} />;
    case MENTION_KIND.SECTION:
      return (
        <SectionChipCard
          taskId={mention.taskId}
          anchor={mention.anchor}
          name={name}
          gone={state === MENTION_STATE.GONE ? GONE_WORDS : undefined}
          fallback={card}
        />
      );
    case MENTION_KIND.PAGE:
      return <PageChipCard taskId={mention.taskId} pageId={mention.pageId} fallback={card} />;
    // A person hangs their card as the members of the workspace their link names draw them.
    case MENTION_KIND.PERSON:
      return (
        <PersonChipCard
          userId={mention.userId}
          workspace={readLink(target)?.workspace ?? doors.place.workspace}
          fallback={card}
        />
      );
    // Any other agent hangs its tab's card all the same, read as the card is hung.
    case MENTION_KIND.AGENT:
      return (
        <MentionedAgentCard
          agentId={mention.agentId}
          taskId={mention.taskId}
          name={name}
          workspaceId={workspaceId}
          fallback={card}
        />
      );
    default:
      return card;
  }
}

/** A card's note, where there are words for one. */
function OptionalNote({ words }: { words: string | undefined }): ReactNode {
  return words === undefined ? null : <HoverCardNote>{words}</HoverCardNote>;
}

/**
 * What a chip calls a mention: the name it was written with, unless it was
 * written as its bare address and the window holds better, the name of the
 * plan, the page, the agent, or the person it names, or the key and title a provider
 * answered for its page.
 */
function bareName(
  mention: Mention,
  written: string,
  bare: boolean,
  known: KnownNames,
  standing: LinkStanding | undefined,
): string {
  if (!bare) return written;
  switch (mention.kind) {
    case MENTION_KIND.LINK:
      return standing === undefined ? written : `${standing.key} ${standing.title}`;
    case MENTION_KIND.TASK:
      return known.tasks.get(mention.taskId) ?? written;
    case MENTION_KIND.PAGE:
      return known.pages.get(mention.pageId) ?? written;
    case MENTION_KIND.AGENT:
      return known.agents.get(mention.agentId) ?? written;
    case MENTION_KIND.PERSON:
      return known.people.get(mention.userId) ?? written;
    default:
      return written;
  }
}

/**
 * What a pull request's or a GitHub issue's chip is called once GitHub
 * answered for it, whatever words its link was written with: its number,
 * and its repository's name before it where that is not `repository`, the
 * task's; nothing for any other mention, or one GitHub answered nothing for.
 */
function githubName(
  mention: Mention,
  standing: LinkStanding | undefined,
  repository: string | null,
): string | undefined {
  if (mention.kind !== MENTION_KIND.LINK || standing === undefined) return undefined;
  if (standing.pullRequest === undefined && standing.issue === undefined) return undefined;
  const address = pullRequestAddressOf(mention.url) ?? issueAddressOf(mention.url);
  const own =
    address !== undefined &&
    repository !== null &&
    address.repository.toLowerCase() === repository.toLowerCase();
  return own ? `#${address.number}` : standing.key;
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
    taskId: doors.taskId,
    workspace: doors.place.workspace,
  });
  const name =
    githubName(mention, standing, doors.place.repository) ??
    bareName(mention, written, bare, known, standing);
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
          name={name}
          doors={doors}
          known={known}
          standing={standing}
        />
      }
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
      data-mention-ref=""
      data-kind={mention.kind}
      data-state={state}
      data-stated={standing?.state === undefined ? undefined : ""}
    />
  );
}

/** The glyph a place in Luke wears, the one its tab or its row in the window wears: an agent's its harness's mark, where the window holds the agent. */
function PlaceGlyph({
  place,
  name,
  workspace,
  known,
}: {
  place: LinkPlace;
  name: string;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  known: KnownNames;
}): React.JSX.Element {
  switch (place.kind) {
    case LINK_PLACE.TASK:
    case LINK_PLACE.VERSION:
    case LINK_PLACE.TURN:
      return <DocumentIcon />;
    case LINK_PLACE.SECTION:
      return <HashIcon aria-hidden="true" />;
    case LINK_PLACE.COMMENT:
      return <CommentsIcon />;
    case LINK_PLACE.PAGE:
      return <AppWindowIcon aria-hidden="true" />;
    case LINK_PLACE.CALL:
      return <CallIcon />;
    case LINK_PLACE.AGENT:
      return (
        <KnownAgentMark
          agentId={place.agentId}
          taskId={place.planId}
          name={name}
          where={{ taskId: place.planId ?? NO_TASK_ID, workspace }}
          known={known}
        />
      );
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
    case LINK_PLACE.ISSUE:
      return <ListTodoIcon aria-hidden="true" />;
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
  workspace,
  label,
}: {
  href: string;
  place: LinkPlace;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  /** The words it was labelled with, without an `@`; none where it was written bare. */
  label: string | undefined;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const known = useKnownNames("automationId" in place ? place.automationId : undefined);
  const { name, under } = placeChipLook(place, label, known);
  const glyph = <PlaceGlyph place={place} name={name} workspace={workspace} known={known} />;
  const own = (
    <HoverCard data-mention-card="">
      <HoverCardHead glyph={glyph} name={name} />
      {under === undefined ? null : <HoverCardNote>{`In ${under}`}</HoverCardNote>}
    </HoverCard>
  );
  const card = <PlaceCard place={place} workspace={workspace} name={name} fallback={own} />;
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={glyph}
      label={name}
      onPress={(event) => {
        // Note that the press stops here, as a mention's does, because a click into a section opens its editor.
        event.stopPropagation();
        openLink(href);
      }}
      card={card}
      data-mention-ref=""
      data-kind={MENTION_KIND_PLACE}
    />
  );
}

/**
 * The card a place in Luke hangs, as the window hangs it wherever it names
 * the place: a plan's, a section's, a version's, a page's, an agent's, a
 * member's, an Inbox item's, or an automation's; `fallback`, the chip's
 * glyph and name, for any other, and where the window holds none.
 */
function PlaceCard({
  place,
  workspace,
  name,
  fallback,
}: {
  place: LinkPlace;
  workspace: string;
  name: string;
  fallback: ReactNode;
}): ReactNode {
  const workspaceId = useWordsWorkspaceId({
    taskId: "planId" in place ? (place.planId ?? NO_TASK_ID) : NO_TASK_ID,
    workspace,
  });
  switch (place.kind) {
    case LINK_PLACE.TASK:
      return <TaskChipCard taskId={place.planId} fallback={fallback} />;
    case LINK_PLACE.SECTION:
      return (
        <SectionChipCard
          taskId={place.planId}
          anchor={place.anchor}
          name={name}
          gone={undefined}
          fallback={fallback}
        />
      );
    case LINK_PLACE.VERSION:
      return (
        <VersionChipCard taskId={place.planId} revision={place.revision} fallback={fallback} />
      );
    case LINK_PLACE.PAGE:
      return <PageChipCard taskId={place.planId} pageId={place.pageId} fallback={fallback} />;
    case LINK_PLACE.AGENT:
      return (
        <MentionedAgentCard
          agentId={place.agentId}
          taskId={place.planId}
          name={name}
          workspaceId={workspaceId}
          fallback={fallback}
        />
      );
    case LINK_PLACE.PERSON:
      return <PersonChipCard userId={place.userId} workspace={workspace} fallback={fallback} />;
    case LINK_PLACE.INBOX_ITEM:
      return <InboxItemChipCard itemId={place.itemId} fallback={fallback} />;
    case LINK_PLACE.AUTOMATION:
    case LINK_PLACE.AUTOMATION_RUN:
      return (
        <AutomationChipCard
          automationId={place.automationId}
          workspace={workspace}
          wordsWorkspaceId={workspaceId}
          fallback={fallback}
        />
      );
    default:
      return fallback;
  }
}

/** The plan of a place that names none, which no plan's id spells. */
const NO_TASK_ID = "";

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
      workspace={read.workspace}
      label={bare ? undefined : mentionName(label.trim())}
    />
  );
}

/** What draws a link in Markdown as its chip through the doors given (`linkChip`); a link where it names nothing. */
export function mentionLinkDrawer(doors: MentionDoors): LinkDrawer {
  return (href, label) => linkChip(href, label, doors);
}

/** What a place pasted into knows to call a pasted address by: the names the window holds, and the plan it stands on, whose headings name its sections. */
export interface PastedNames {
  readonly known: KnownNames;
  readonly taskId: string;
  /** The plan's text as the place holds it. */
  readonly text: () => string;
}

/** What a pasted address's chip is called: a section of the plan pasted on by its heading, a plan, a page, or an agent by the name the window holds, else what its address says. */
function pastedName(mention: Mention, said: string, names: PastedNames): string {
  if (mention.kind !== MENTION_KIND.SECTION)
    return bareName(mention, said, true, names.known, undefined);
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
  // A person's page is their page in the workspace its link names, so one of another workspace stays the link it is.
  const elsewhere =
    link?.mention.kind === MENTION_KIND.PERSON &&
    readLink(words.trim())?.workspace !== place.workspace;
  return link === undefined || elsewhere
    ? undefined
    : {
        name: pastedName(link.mention, link.name, names),
        target: encodeMention(link.mention, place),
      };
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
