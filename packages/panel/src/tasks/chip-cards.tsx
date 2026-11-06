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
import { pagesQuery, descriptionDocumentQuery } from "../live-reads.js";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { holderTaskId } from "./mention-holder.js";
import { useMentionedReader } from "./mentioned-place.js";
import { PageCard } from "./page-card.js";
import { useTaskMentions } from "./task-mentions.js";

interface ChipCardsPlace {
  readonly taskCard: (
    taskId: string,
    now: number,
    focus: TaskFocus | undefined,
  ) => ReactNode | undefined;
}

export interface TaskFocus {
  readonly glyph: ReactNode;
  readonly words: ReactNode;
}

const ChipCardsContext = createContext<ChipCardsPlace | undefined>(undefined);

export const ChipCards = ChipCardsContext.Provider;

function versionWords(revision: number): string {
  return `Version ${revision}`;
}

const OPEN_NOTHING = (): void => undefined;

const PAGE_UNREAD = "Can't read this page.";

export function UnreadPageCard({ glyph, name }: { glyph: ReactNode; name: string }): ReactNode {
  return (
    <HoverCard data-page-card="">
      <HoverCardHead glyph={glyph} name={name} />
      <HoverCardNote>{PAGE_UNREAD}</HoverCardNote>
    </HoverCard>
  );
}

export function useSectionHeading(taskId: string | undefined, anchor: string): string | undefined {
  const page = useTaskMentions();
  const held = useQuery({ ...descriptionDocumentQuery(taskId), enabled: false }).data;
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

export function useTaskCard(
  taskId: string | undefined,
  focus?: TaskFocus | undefined,
): ReactNode | undefined {
  const place = useContext(ChipCardsContext);
  const now = useMinute();
  return taskId === undefined ? undefined : place?.taskCard(taskId, now, focus);
}

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

export function PageChipCard({
  place,
  pageId,
  reading,
  fallback,
}: {
  place: PagePlace;
  pageId: string;
  reading?: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const read = useQuery(pagesQuery(place));
  if (read.isPending) return reading ?? fallback;
  const page = read.data?.find((each) => each.id === pageId);
  if (page === undefined) return fallback;
  return <PageCard place={place} page={page} />;
}

function useLinkWorkspace(written: string): Workspace | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  return workspaces === undefined ? undefined : workspaceOfSlug(workspaces, written);
}

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

export function PersonChipCard({
  userId,
  workspace,
  reading,
  fallback,
}: {
  userId: string;
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

export function LinkAutomations({
  workspace: slug,
  children,
}: {
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

export function AutomationChipCard({
  automationId,
  workspace: slug,
  wordsWorkspaceId,
  reading,
  fallback,
}: {
  automationId: string;
  workspace: string;
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
  return (
    <WorkspaceDirectory workspace={workspace}>
      <AutomationDirectory workspace={workspace} wanted onOpen={OPEN_NOTHING}>
        <KnownAutomationCard automationId={automationId} reading={reading} fallback={fallback} />
      </AutomationDirectory>
    </WorkspaceDirectory>
  );
}
