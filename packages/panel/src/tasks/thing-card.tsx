import type { MentionLines } from "@luke/features/mention-link";
import { THING_KIND, type Thing, type ThingKind, type ThingOf } from "@luke/features/thing-kind";
import type { ReactNode } from "react";
import { LukeCard } from "../actor-ref.js";
import { tabCard } from "../desktop/tab-card.js";
import {
  AutomationChipCard,
  ChipCardSkeleton,
  PageChipCard,
  PersonChipCard,
  SectionChipCard,
  UnreadPageCard,
  VersionChipCard,
} from "./chip-cards.js";
import { FileCard } from "./file-ref.js";
import { shortCommit } from "./file-tab-model.js";
import { InboxItemChipCard } from "./inbox-item-chip.js";
import {
  AgentPullRequestChipCard,
  MentionedAgentCard,
  PullRequestChipCard,
} from "./mentioned-agent-card.js";
import { ServerCard } from "./server-card.js";
import { TAB_KIND } from "./tab-look.js";

/**
 * thing-card.tsx -- the card a chip hangs for each kind of thing it names, one entry per kind (`@luke/features/thing-kind`).
 *
 * A mention's chip and a Luke link's chip both hang their thing's card
 * through `thingCard`, so a plan's chip hangs the plan's card whichever way
 * it was written. The table is keyed by every `THING_KIND` and typed over
 * each kind's own `Thing`, so a kind added there fails to compile until it
 * says what card it hangs. A kind with no card of its own yet hangs the
 * chip's own, its glyph and name, and says so by name, `OWN_CARD`. A plan,
 * an agent, and a pull request hang the card their own tab hangs
 * (`tabCard`), wherever the chip stands. A card that reads what it shows
 * as it is hung waits in one way whatever its kind (`ChipCardSkeleton`),
 * and stands in with the chip's own only where the read answers nothing.
 */

/** What a chip hands its thing's card: the card it draws of its own, and where it stands. */
export interface ThingCardAt {
  /** The chip's own card, its glyph and its name, which a kind with none of its own hangs, and any card stands in with where the window holds nothing. */
  readonly own: ReactNode;
  /** The chip's glyph, which a card waiting on its read wears. */
  readonly glyph: ReactNode;
  /** The name the chip calls it by. */
  readonly name: string;
  /** The slug of the workspace the link was written under. */
  readonly workspace: string;
  /** The workspace the words are of, by its id, which an agent on no task is read in. */
  readonly wordsWorkspaceId: string | undefined;
  /** The repository the place names, `owner/name`, which a file is read in. */
  readonly repository: string | undefined;
  /** What a section's card says of it where the plan no longer holds it; none while it does. */
  readonly gone: string | undefined;
}

/** The card a kind hangs. */
type ThingCard<T> = (thing: T, at: ThingCardAt) => ReactNode;

/** The cards, one entry per kind. */
type ThingCards = { readonly [K in ThingKind]: ThingCard<ThingOf<K>> };

/** Where a file or a folder no lines pin is read: the head of its repository's default branch, as its link names it. */
const DEFAULT_BRANCH_WORDS = "On the default branch";

/** A kind with no card of its own, which hangs the chip's own: its glyph and its name. */
export const OWN_CARD: ThingCard<Thing> = (_thing, at) => at.own;

/** What a file's card says of the lines a mention pins: where they run, and the commit they were read at. */
function linesNote(lines: MentionLines | undefined): string | undefined {
  if (lines === undefined) return undefined;
  const span =
    lines.startLine === lines.endLine
      ? `Line ${lines.startLine}`
      : `Lines ${lines.startLine}–${lines.endLine}`;
  return `${span} at ${shortCommit(lines.commit)}`;
}

/** A card's one waiting state while what it shows is read: the chip's glyph and name over a line standing in for the rest. */
function reading(at: ThingCardAt): ReactNode {
  return <ChipCardSkeleton glyph={at.glyph} name={at.name} />;
}

/** An MCP server's card, or one of its tools': its server's row as the MCP popover draws it. */
const SERVER_CARD: ThingCard<ThingOf<typeof THING_KIND.SERVER | typeof THING_KIND.TOOL>> = (
  server,
) => (
  <ServerCard
    provider={server.provider}
    connection={server.connection}
    tool={server.kind === THING_KIND.TOOL ? server.tool : undefined}
  />
);

/** An automation's card, or one of its runs': the automation's, read in the workspace its link names. */
const AUTOMATION_CARD: ThingCard<
  ThingOf<typeof THING_KIND.AUTOMATION | typeof THING_KIND.AUTOMATION_RUN>
> = (automation, at) => (
  <AutomationChipCard
    automationId={automation.automationId}
    workspace={at.workspace}
    wordsWorkspaceId={at.wordsWorkspaceId}
    reading={reading(at)}
    fallback={at.own}
  />
);

/** The card each kind hangs, as the window hangs it wherever it names the thing; the chip's own standing in where the window holds none. */
export const THING_CARD: ThingCards = {
  [THING_KIND.PLAN]: (plan, at) =>
    tabCard({ kind: TAB_KIND.PLAN, taskId: plan.taskId, name: at.name }),
  [THING_KIND.SECTION]: (section, at) => (
    <SectionChipCard
      taskId={section.taskId}
      anchor={section.anchor}
      name={at.name}
      gone={at.gone}
      fallback={at.own}
    />
  ),
  [THING_KIND.VERSION]: (version, at) => (
    <VersionChipCard taskId={version.planId} revision={version.revision} fallback={at.own} />
  ),
  [THING_KIND.COMMENT]: OWN_CARD,
  [THING_KIND.TURN]: OWN_CARD,
  [THING_KIND.PAGE]: (page, at) => (
    <PageChipCard
      place={"taskId" in page ? { taskId: page.taskId } : { agentId: page.agentId }}
      pageId={page.pageId}
      reading={reading(at)}
      fallback={<UnreadPageCard glyph={at.glyph} name={at.name} />}
    />
  ),
  [THING_KIND.AGENT]: (agent, at) => (
    <MentionedAgentCard
      agentId={agent.agentId}
      taskId={agent.taskId}
      name={at.name}
      workspaceId={at.wordsWorkspaceId}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [THING_KIND.WORKER]: OWN_CARD,
  [THING_KIND.LUKE]: () => <LukeCard />,
  [THING_KIND.CHANGES]: (changes, at) => (
    <AgentPullRequestChipCard
      agentId={changes.agentId}
      taskId={changes.planId}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [THING_KIND.PULL_REQUEST]: (pullRequest, at) => (
    <PullRequestChipCard url={pullRequest.url} reading={reading(at)} fallback={at.own} />
  ),
  [THING_KIND.PULL_REQUEST_THREAD]: OWN_CARD,
  [THING_KIND.ISSUE]: OWN_CARD,
  [THING_KIND.LINK]: OWN_CARD,
  [THING_KIND.MESSAGE]: OWN_CARD,
  [THING_KIND.INBOX]: OWN_CARD,
  [THING_KIND.INBOX_ITEM]: (item, at) => <InboxItemChipCard place={item} fallback={at.own} />,
  [THING_KIND.AUTOMATIONS]: OWN_CARD,
  [THING_KIND.AUTOMATION]: AUTOMATION_CARD,
  [THING_KIND.AUTOMATION_RUN]: AUTOMATION_CARD,
  [THING_KIND.SETTINGS]: OWN_CARD,
  // A person hangs their card as the members of the workspace their link names draw them.
  [THING_KIND.PERSON]: (person, at) => (
    <PersonChipCard
      userId={person.userId}
      workspace={at.workspace}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [THING_KIND.ADMIN]: OWN_CARD,
  [THING_KIND.FILE]: (file, at) => (
    <FileCard
      path={file.path}
      repository={at.repository}
      note={linesNote(file.lines) ?? branchNote(at.repository)}
    />
  ),
  [THING_KIND.FOLDER]: OWN_CARD,
  [THING_KIND.SERVER]: SERVER_CARD,
  [THING_KIND.TOOL]: SERVER_CARD,
  [THING_KIND.SKILL]: OWN_CARD,
  [THING_KIND.REPOSITORY]: OWN_CARD,
  [THING_KIND.WORKSPACE]: OWN_CARD,
  [THING_KIND.DATE]: OWN_CARD,
};

/** A thing's card drawn through its kind's own entry. */
function cardOf<K extends ThingKind>(kind: K, thing: ThingOf<K>, at: ThingCardAt): ReactNode {
  return THING_CARD[kind](thing, at);
}

/** What a file's or a folder's card says of where it is read with no lines pinned: the repository's default branch, where a repository names it. */
export function branchNote(repository: string | undefined): string | undefined {
  return repository === undefined ? undefined : DEFAULT_BRANCH_WORDS;
}

/** The card a thing hangs, by its kind's entry. */
export function thingCard(thing: Thing, at: ThingCardAt): ReactNode {
  return cardOf(thing.kind, thing, at);
}
