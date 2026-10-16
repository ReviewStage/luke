import { sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { DocumentIcon } from "@luke/ui";
import { HashIcon, InboxIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { AutomationCard, actorCard } from "../actor-ref";
import { AutomationDirectory, useAutomation } from "../automation-directory";
import { CardHead, CardNote, HoverCard } from "../hover-card";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory";
import { useAppState, useExperiment } from "../use-app-state";
import { useMentionedReader } from "./mentioned-agent-card";
import { PageCard } from "./page-card";
import { usePlanMentions } from "./plan-mentions";
import { RelativeTime } from "./relative-time";
import { useMinute } from "./task-time";

/**
 * chip-cards.tsx -- the cards the chips of places in Luke hang, each the card the window already hangs for what the chip names, read from what the window holds.
 *
 * A chip names a place (`mention-chip.tsx`), and its card is the one every
 * other place naming the same thing hangs, so a plan reads alike from its
 * sidebar row and from a chip in an agent's words: a plan's is the plan's
 * card (`../desktop/task-card.tsx`), and a section's or a version's the
 * same card's head with the section's heading or the version under it in
 * the agents' stead; a page's is its tab's, its title, its version, and
 * when it last moved over a preview of it (`page-card.tsx`); a person's is their card (`../actor-ref.tsx`); an Inbox item's is
 * its question and that it waits on the team, and when it was asked; an
 * automation's is its card, the workspace's automations read as the card is
 * first hung where no directory around it reads them yet. Everything else
 * is read from main's document and the directories around the chip, so a
 * chip asks nothing as it is drawn. A place the window does not hold, a
 * plan of another account's or a page of a plan not open, keeps the chip's
 * own card, its glyph and name.
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

/** What an Inbox item still waiting says of where it stands. */
const WAITING_WORDS = "Waiting for an answer";

/**
 * The heading a section's anchor names in a plan the window holds the
 * words of: the plan's page's, or the open plan's; none where it holds
 * neither, or no heading spells the anchor.
 */
function useSectionHeading(taskId: string, anchor: string): string | undefined {
  const page = usePlanMentions();
  const opened = useAppState()?.tasks?.document.task;
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

/** A page's card, its tab's, previewing it, where the window holds the page, one of the open plan's; else `fallback`. */
export function PageChipCard({
  pageId,
  fallback,
}: {
  pageId: string;
  fallback: ReactNode;
}): ReactNode {
  const tasks = useAppState()?.tasks;
  const page = tasks?.pages?.find((each) => each.id === pageId);
  const taskId = tasks?.activeTaskId;
  if (page === undefined || taskId === undefined) return fallback;
  return <PageCard taskId={taskId} page={page} />;
}

/** The workspace a link was written under, by its slug, or its id where it has none, as the account holds it; none where it holds no such workspace. */
function useLinkWorkspace(written: string): Workspace | undefined {
  return useAppState()?.tasks?.workspaces.find(
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

/** An Inbox item's card: its question, that it waits for an answer, and when it was asked, where the window holds it waiting; else `fallback`. */
export function InboxItemChipCard({
  itemId,
  fallback,
}: {
  itemId: string;
  fallback: ReactNode;
}): ReactNode {
  const inbox = useAppState()?.inbox;
  const now = useMinute();
  const item = [
    ...(inbox?.waiting ?? []).flatMap((plan) => plan.items),
    ...(inbox?.taskless ?? []),
  ].find((each) => each.id === itemId);
  if (item === undefined) return fallback;
  return (
    <HoverCard data-inbox-item-card="">
      <CardHead
        glyph={<InboxIcon aria-hidden="true" />}
        name={item.title}
        corner={<RelativeTime at={item.postedAt} now={now} hint={false} />}
      />
      <CardNote>{WAITING_WORDS}</CardNote>
    </HoverCard>
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
 * else the one the words are of; `fallback` while the read is out,
 * with the experiment off, or where the workspace lists no such automation.
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
  const on = useExperiment(EXPERIMENT.AUTOMATIONS);
  const named = useLinkWorkspace(slug);
  const words = useAppState()?.tasks?.workspaces.find((each) => each.id === wordsWorkspaceId);
  const workspace = named ?? words;
  return (
    <AutomationDirectory workspace={workspace} on={on} wanted onOpen={OPEN_NOTHING}>
      <KnownAutomationCard automationId={automationId} fallback={fallback} />
    </AutomationDirectory>
  );
}
