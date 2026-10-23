import { useAtomValue } from "@effect/atom-react";
import { sectionAnchors } from "@luke/features/mention-link";
import type { PageLine, PagePlace } from "@luke/features/page-wire";
import { planSections } from "@luke/features/plan-document";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DocumentIcon, useMinute } from "@luke/ui";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { HashIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { askAct } from "../act.js";
import { AutomationCard, actorCard } from "../actor-ref.js";
import { AutomationDirectory, useAutomation } from "../automation-directory.js";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { useMentionedReader } from "./mentioned-agent-card.js";
import { PageCard } from "./page-card.js";
import { useTaskMentions } from "./task-mentions.js";

/**
 * chip-cards.tsx -- the cards the chips of places in Luke hang, each the card the window already hangs for what the chip names, read from what the window holds.
 *
 * A chip names a place (`mention-chip.tsx`), and its card is the one every
 * other place naming the same thing hangs, so a plan reads alike from its
 * sidebar row and from a chip in an agent's words: a plan's is the plan's
 * card (`../desktop/task-card.tsx`), and a section's or a version's the
 * same card's head with the section's heading or the version under it in
 * the agents' stead; a page's is its tab's, its title, its version, and
 * when it last moved over a preview of it (`page-card.tsx`), a plan's page
 * read from what the window holds where the plan is open, and the page of
 * any other plan or of an agent on no task, which the window holds nothing
 * of, read as the card is first hung (`ReadPageChipCard`); a person's is their card (`../actor-ref.tsx`); an Inbox item's is
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

/**
 * The heading a section's anchor names in a plan the window holds the
 * words of: the plan's page's, or the open plan's; none where it holds
 * neither, or no heading spells the anchor.
 */
function useSectionHeading(taskId: string, anchor: string): string | undefined {
  const page = useTaskMentions();
  const opened = useAppSlice(APP_SLICE.TASKS)?.document.task;
  const text =
    page?.taskId === taskId
      ? page.text()
      : opened?.id === taskId
        ? opened.document.body
        : undefined;
  if (text === undefined) return undefined;
  const headings = planSections(text).map((section) => section.heading);
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
  const place = useContext(ChipCardsContext);
  const now = useMinute();
  return place?.taskCard(taskId, now, focus) ?? fallback;
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

/** The pages of a plan or of an agent on no task as the service answered them; nothing where it refused, or the place is not the reader's to reach. */
function placePages(place: PagePlace): Effect.Effect<readonly PageLine[] | undefined> {
  return Effect.promise(() =>
    askAct(ACT_KIND.TASKS_PAGES, place).then(
      (answer) => ("pages" in answer ? answer.pages : undefined),
      () => undefined,
    ),
  );
}

/** One agent's pages, read once for every card hung of it while one stands. */
const agentPagesAtom = Atom.family((agentId: string) =>
  rendererRuntime.atom(placePages({ agentId })),
);

/** One plan's pages where the window does not hold them, read once for every card hung of it while one stands. */
const taskPagesAtom = Atom.family((taskId: string) => rendererRuntime.atom(placePages({ taskId })));

/** A page among pages read as its card is hung; `fallback` while the read is out, and where it failed or holds no such page. */
function ReadPageChipCard({
  place,
  read,
  pageId,
  fallback,
}: {
  place: PagePlace;
  read: AsyncResult.AsyncResult<readonly PageLine[] | undefined>;
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  const page = AsyncResult.isSuccess(read)
    ? read.value?.find((each) => each.id === pageId)
    : undefined;
  if (page === undefined) return fallback;
  return <PageCard place={place} page={page} />;
}

/**
 * The card of a page of an agent on no task, the page's own card as a
 * plan's page hangs it, read by the agent's pages (`ACT_KIND.TASKS_PAGES`)
 * as it is first hung and never as the chip is drawn, so words full of
 * chips ask nothing until one is looked at.
 */
function AgentPageChipCard({
  agentId,
  pageId,
  fallback,
}: {
  agentId: string;
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  const read = useAtomValue(agentPagesAtom(agentId));
  return <ReadPageChipCard place={{ agentId }} read={read} pageId={pageId} fallback={fallback} />;
}

/** The card of a page of a plan not open, read by the plan's pages as it is first hung, as an agent's page is. */
function ReadTaskPageChipCard({
  taskId,
  pageId,
  fallback,
}: {
  taskId: string;
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  const read = useAtomValue(taskPagesAtom(taskId));
  return <ReadPageChipCard place={{ taskId }} read={read} pageId={pageId} fallback={fallback} />;
}

/**
 * A page of a plan's card: the open plan's from the pages the window holds,
 * live as they move, and any other plan's read as it is first hung, so a
 * page's bar in an Inbox item or another task's transcript hangs the card
 * its tab hangs; `fallback` where neither finds the page.
 */
function TaskPageChipCard({
  taskId,
  pageId,
  fallback,
}: {
  taskId: string;
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  const tasks = useAppSlice(APP_SLICE.TASKS);
  if (tasks?.activeTaskId !== taskId) {
    return <ReadTaskPageChipCard taskId={taskId} pageId={pageId} fallback={fallback} />;
  }
  const page = tasks.pages?.find((each) => each.id === pageId);
  if (page === undefined) return fallback;
  return <PageCard place={{ taskId }} page={page} />;
}

/** A page's card, its tab's, previewing it: a plan's page's as the window holds it, an agent's read as it is hung; else `fallback`. */
export function PageChipCard({
  place,
  pageId,
  fallback,
}: {
  /** The plan the link names the page on, or the agent on no task. */
  place: PagePlace;
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  return "taskId" in place ? (
    <TaskPageChipCard taskId={place.taskId} pageId={pageId} fallback={fallback} />
  ) : (
    <AgentPageChipCard agentId={place.agentId} pageId={pageId} fallback={fallback} />
  );
}

/** The workspace a link was written under, by its slug, or its id where it has none, as the account holds it; none where it holds no such workspace. */
function useLinkWorkspace(written: string): Workspace | undefined {
  return useAppSlice(APP_SLICE.TASKS)?.workspaces.find(
    (each) => each.slug === written || each.id === written,
  );
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

/** A member's card, as the directory around it holds them; `fallback` where it holds no one of the id, or while it is read. */
function MemberCard({ userId, fallback }: { userId: string; fallback: ReactNode }): ReactNode {
  const { members, former } = useMemberDirectory();
  const name = [...(members ?? []), ...(former ?? [])].find((each) => each.userId === userId)?.name;
  const actor = usePerson({ userId, name: name ?? "" });
  return name === undefined ? fallback : (actorCard(actor) ?? fallback);
}

/**
 * A member's card, as every place naming them hangs it, read against the
 * members of the workspace the link names, since their role and whether
 * they left are that workspace's; `fallback` where the account holds no
 * such workspace, or it lists no one of the id.
 */
export function PersonChipCard({
  userId,
  workspace,
  fallback,
}: {
  userId: string;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  fallback: ReactNode;
}): ReactNode {
  const named = useLinkWorkspace(workspace);
  if (named === undefined) return fallback;
  return (
    <WorkspaceDirectory workspace={named}>
      <MemberCard userId={userId} fallback={fallback} />
    </WorkspaceDirectory>
  );
}

/** An automation's card, as the directory around the chip knows it; else `fallback`. */
function KnownAutomationCard({
  automationId,
  fallback,
}: {
  automationId: string;
  fallback: ReactNode;
}): ReactNode {
  const known = useAutomation(automationId);
  if (known === undefined) return fallback;
  return <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />;
}

/**
 * An automation's card, the workspace's automations read as it is first
 * hung where no directory around the chip reads them yet, and shared with
 * one that does (`AutomationDirectory`), of the workspace the link names,
 * else the one the words are of; `fallback` while the read is out, or
 * where the workspace lists no such automation.
 */
export function AutomationChipCard({
  automationId,
  workspace: slug,
  wordsWorkspaceId,
  fallback,
}: {
  automationId: string;
  /** The slug of the workspace the link was written under, whose automations are read. */
  workspace: string;
  /** The workspace the words are of, read where the account holds none of the link's slug. */
  wordsWorkspaceId: string | undefined;
  fallback: ReactNode;
}): ReactNode {
  const named = useLinkWorkspace(slug);
  const words = useAppSlice(APP_SLICE.TASKS)?.workspaces.find(
    (each) => each.id === wordsWorkspaceId,
  );
  const workspace = named ?? words;
  return (
    <AutomationDirectory workspace={workspace} wanted onOpen={OPEN_NOTHING}>
      <KnownAutomationCard automationId={automationId} fallback={fallback} />
    </AutomationDirectory>
  );
}
