import { LIVE_READ } from "@repo/features/live-wire";
import { sectionAnchors } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { descriptionSections } from "@repo/features/description-document";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { DocumentIcon, HoverCard, HoverCardHead, HoverCardNote, useMinute } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { HashIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { AutomationCard, actorCard } from "../actor-ref.js";
import {
  AutomationDirectory,
  useAutomation,
  useAutomationsLanded,
} from "../automation-directory.js";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { HOST_READ_STATUS, useHeldRows, useHostRead } from "../use-host-read.js";
import { holderTaskId } from "./mention-holder.js";
import { useMentionedReader } from "./mentioned-place.js";
import { PageCard } from "./page-card.js";
import { useTaskMentions } from "./task-mentions.js";

/**
 * chip-cards.tsx -- the cards the chips of places in the app hang, each the card the window already hangs for what the chip names, read from what the window holds.
 *
 * A chip names a place (`mention-chip.tsx`), and its card is the one every
 * other place naming the same thing hangs, so a plan reads alike from its
 * sidebar row and from a chip in an agent's words: a plan's is the plan's
 * card (`../desktop/task-card.tsx`), and a section's or a version's the
 * same card's head with the section's heading or the version under it in
 * the agents' stead; a page's is its tab's, its title, its version, when
 * it last moved, and who showed it over a preview of it (`page-card.tsx`),
 * from the pages its plan or its agent on no task holds, held as the card
 * is first hung (`PageChipCard`); a person's is their card (`../actor-ref.tsx`); an Inbox item's is
 * its Inbox row's own card (`inbox-item-chip.tsx`); an
 * automation's is its card, the workspace's automations read as the card is
 * first hung where no directory around it reads them yet. Everything else
 * is read from main's document and the directories around the chip, so a
 * chip asks nothing as it is drawn. A place the window does not hold, a
 * plan of another account's, keeps the chip's own card, its glyph and
 * name, as does a page the read does not find, the page of a plan or an
 * agent the reader cannot reach among them.
 */

/** What a plan's card is made from where a chip hangs it: the window's plans, as the shell holds them. */
interface ChipCardsPlace {
  /** The plan's card, counted back from `now`, with the place within it the card is hung for; none where the window lists no such plan. */
  readonly taskCard: (
    taskId: string,
    now: number,
    focus: TaskFocus | undefined,
  ) => ReactNode | undefined;
}

/** A place within a plan a card is hung for: its glyph and its words. */
export interface TaskFocus {
  readonly glyph: ReactNode;
  readonly words: ReactNode;
}

const ChipCardsContext = createContext<ChipCardsPlace | undefined>(undefined);

/** Hands every chip under it the window's plans' cards. */
export const ChipCards = ChipCardsContext.Provider;

/** What a version's line says of it. */
function versionWords(revision: number): string {
  return `Version ${revision}`;
}

/** What an automation's card opens: nothing, since the chip it hangs from opens the automation. */
const OPEN_NOTHING = (): void => undefined;

/** What a page's card says where its page cannot be read: deleted, or on a plan or an agent the reader cannot reach. */
const PAGE_UNREAD = "Can't read this page.";

/** A page's card where its page cannot be read: the chip's glyph and name, and a note saying so. */
export function UnreadPageCard({ glyph, name }: { glyph: ReactNode; name: string }): ReactNode {
  return (
    <HoverCard data-page-card="">
      <HoverCardHead glyph={glyph} name={name} />
      <HoverCardNote>{PAGE_UNREAD}</HoverCardNote>
    </HoverCard>
  );
}

/**
 * The heading a section's anchor names in a plan the window holds the
 * words of: the plan's page's, or one the host holds for a window that
 * opened it (`LIVE_READ.DESCRIPTION_DOCUMENT`); none where it holds neither, no
 * heading spells the anchor, or no plan is asked for.
 */
export function useSectionHeading(taskId: string | undefined, anchor: string): string | undefined {
  const page = useTaskMentions();
  const held = useHeldRows(LIVE_READ.DESCRIPTION_DOCUMENT, taskId);
  const text =
    taskId === undefined
      ? undefined
      : holderTaskId(page?.holder) === taskId
        ? page?.text()
        : held !== undefined && "task" in held
          ? held.task.document.body
          : undefined;
  if (text === undefined) return undefined;
  const headings = descriptionSections(text).map((section) => section.heading);
  return headings[sectionAnchors(headings).indexOf(anchor)];
}

/** A plan's card, with the place within it the card is hung for, or `fallback` where the window lists no such plan. */
export function TaskChipCard({
  taskId,
  focus,
  fallback,
}: {
  taskId: string;
  focus?: TaskFocus | undefined;
  fallback: ReactNode;
}): ReactNode {
  return useTaskCard(taskId, focus) ?? fallback;
}

/** A plan's card, with the place within it the card is hung for, as `TaskChipCard` hangs it; none for no plan, or where the window lists no such plan. */
export function useTaskCard(
  taskId: string | undefined,
  focus?: TaskFocus | undefined,
): ReactNode | undefined {
  const place = useContext(ChipCardsContext);
  const now = useMinute();
  return taskId === undefined ? undefined : place?.taskCard(taskId, now, focus);
}

/** A section's card: its plan's card's head, and the heading the anchor names, or the name it was written with; where the plan no longer holds it, that said. */
export function SectionChipCard({
  taskId,
  anchor,
  name,
  gone,
  fallback,
}: {
  taskId: string;
  anchor: string;
  name: string;
  /** What the card says of a section the plan no longer holds; none while it holds it. */
  gone: string | undefined;
  fallback: ReactNode;
}): ReactNode {
  const heading = useSectionHeading(taskId, anchor) ?? name;
  const words = gone === undefined ? heading : `${heading} · ${gone}`;
  return (
    <TaskChipCard
      taskId={taskId}
      focus={{ glyph: <HashIcon aria-hidden="true" />, words }}
      fallback={fallback}
    />
  );
}

/** A version's card: its plan's card's head, and the version. */
export function VersionChipCard({
  taskId,
  revision,
  fallback,
}: {
  taskId: string;
  revision: number;
  fallback: ReactNode;
}): ReactNode {
  return (
    <TaskChipCard
      taskId={taskId}
      focus={{ glyph: <DocumentIcon />, words: versionWords(revision) }}
      fallback={fallback}
    />
  );
}

/**
 * A page's card, its tab's, previewing it: the page among the pages of the
 * plan the link names it on, or of the agent on no task, held as the card
 * is first hung and never as the chip is drawn (`LIVE_READ.PAGES`), so
 * words full of chips ask nothing until one is looked at, and a page of the
 * open plan, which the window holds already, hangs at once; `reading` while
 * that read is out, which is `fallback` where none is given, and `fallback`
 * where it failed or holds no such page.
 */
export function PageChipCard({
  place,
  pageId,
  reading,
  fallback,
}: {
  /** The plan the link names the page on, or the agent on no task. */
  place: PagePlace;
  pageId: string;
  reading?: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const read = useHostRead(LIVE_READ.PAGES, place);
  if (read.status === HOST_READ_STATUS.LOADING) return reading ?? fallback;
  const page = read.rows?.find((each) => each.id === pageId);
  if (page === undefined) return fallback;
  return <PageCard place={place} page={page} />;
}

/** The workspace a link was written under, by its slug, one it stood under before, or its id where it has none, as the account holds it; none where it holds no such workspace. */
function useLinkWorkspace(written: string): Workspace | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  return workspaces === undefined ? undefined : workspaceOfSlug(workspaces, written);
}

/**
 * The members of the workspace given around a card, so a person it names
 * is read as that workspace holds them: the directory standing around the
 * chip where it is that workspace's, else the workspace's own, read as the
 * card is hung.
 */
export function WorkspaceDirectory({
  workspace,
  children,
}: {
  workspace: Pick<Workspace, "id" | "memberCount">;
  children: ReactNode;
}): ReactNode {
  const around = useMemberDirectory();
  const reader = useMentionedReader();
  if (around.workspaceId === workspace.id) return children;
  return (
    <MemberDirectory workspace={workspace} readerId={around.readerId ?? reader}>
      {children}
    </MemberDirectory>
  );
}

/** A member's card, as the directory around it holds them; `reading` while it is read, and `fallback` where it holds no one of the id. */
function MemberCard({
  userId,
  reading,
  fallback,
}: {
  userId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const directory = useMemberDirectory();
  const { members, former } = directory;
  const name = [...(members ?? []), ...(former ?? [])].find((each) => each.userId === userId)?.name;
  const actor = usePerson({ userId, name: name ?? "" });
  if (name === undefined) return directory.reading ? reading : fallback;
  return actorCard(actor) ?? fallback;
}

/**
 * A member's card, as every place naming them hangs it, read against the
 * members of the workspace the link names, since their role and whether
 * they left are that workspace's; `reading` while those are read, and
 * `fallback` where the account holds no such workspace, or it lists no one
 * of the id.
 */
export function PersonChipCard({
  userId,
  workspace,
  reading,
  fallback,
}: {
  userId: string;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const named = useLinkWorkspace(workspace);
  if (named === undefined) return fallback;
  return (
    <WorkspaceDirectory workspace={named}>
      <MemberCard userId={userId} reading={reading} fallback={fallback} />
    </WorkspaceDirectory>
  );
}

/** An automation's card, as the directory around the chip knows it; `reading` while its automations are read, else `fallback`. */
function KnownAutomationCard({
  automationId,
  reading,
  fallback,
}: {
  automationId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const known = useAutomation(automationId);
  const landed = useAutomationsLanded();
  if (known === undefined) return landed ? fallback : reading;
  return <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />;
}

/**
 * The automations of the workspace a link was written under, read around
 * its chip as it is drawn, so the chip calls the automation by its name now
 * and wears its tile as its row in the `@` list does; shared with a
 * directory around it that already reads them. A link of a workspace the
 * account holds none of reads nothing.
 */
export function LinkAutomations({
  workspace: slug,
  children,
}: {
  /** The slug of the workspace the link was written under. */
  workspace: string;
  children: ReactNode;
}): ReactNode {
  const workspace = useLinkWorkspace(slug);
  if (workspace === undefined) return children;
  return (
    <AutomationDirectory workspace={workspace} wanted onOpen={OPEN_NOTHING}>
      {children}
    </AutomationDirectory>
  );
}

/**
 * An automation's card, the workspace's automations read as it is first
 * hung where no directory around the chip reads them yet, and shared with
 * one that does (`AutomationDirectory`), of the workspace the link names,
 * else the one the words are of; `reading` while the read is out, and
 * `fallback` where it failed, no workspace is known, or the workspace
 * lists no such automation.
 */
export function AutomationChipCard({
  automationId,
  workspace: slug,
  wordsWorkspaceId,
  reading,
  fallback,
}: {
  automationId: string;
  /** The slug of the workspace the link was written under, whose automations are read. */
  workspace: string;
  /** The workspace the words are of, read where the account holds none of the link's slug. */
  wordsWorkspaceId: string | undefined;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const named = useLinkWorkspace(slug);
  const words = useQuery({ ...appStateQuery, select: selectWorkspaces }).data?.find(
    (each) => each.id === wordsWorkspaceId,
  );
  const workspace = named ?? words;
  if (workspace === undefined) return fallback;
  // Note that its maker is named by the members of its own workspace, as a member's chip under the link is.
  return (
    <WorkspaceDirectory workspace={workspace}>
      <AutomationDirectory workspace={workspace} wanted onOpen={OPEN_NOTHING}>
        <KnownAutomationCard automationId={automationId} reading={reading} fallback={fallback} />
      </AutomationDirectory>
    </WorkspaceDirectory>
  );
}
