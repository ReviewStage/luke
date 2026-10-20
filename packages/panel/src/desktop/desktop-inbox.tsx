import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { EmptyState } from "@luke/ui";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "@luke/ui/inbox-panel-link";
import type { StripTab } from "@luke/ui/tab-strip-model";
import { TASK_MARK } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { InboxIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { INBOX_COLUMNS, useInboxColumns } from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, ItemMark } from "../tasks/inbox-list.js";
import {
  anyUnread,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  itemWorkspaceId,
  listedItems,
  NEEDS_YOU,
} from "../tasks/inbox-model.js";
import { inboxNext, useInboxPager } from "../tasks/inbox-pager.js";
import { InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import {
  type TasklessPlace,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { useMinute } from "../tasks/task-time.js";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { type InboxListing, useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { type OpenHere, OpenHereProvider, useOpenLink } from "../tasks/use-open-link.js";
import { PULL_REQUEST_VIEW, type SidePanelControl } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  showPullRequest,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { type TabViews, useTabViews } from "./strip-tabs.js";
import { taskCardOf } from "./task-card.js";

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every task of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the task's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each task of the
 * workspace the sidebar lists that main says holds one (the switcher counts
 * what waits in the others), needing the developer or settled, each task read whole
 * as main says it changed (`use-inbox-items.ts`), under its task, its
 * person, its status, or in one run, the latest first or the longest
 * waiting first, what needs them, what is unread, every open item, or
 * everything, of everyone's, theirs, or one teammate's, as the developer
 * last chose; Needs
 * you is the Inbox's one name for an item not yet answered
 * (`inbox-model.ts`'s `NEEDS_YOU`), and the sidebar's Inbox row counts the
 * same items. An archived task's items are put away with it rather than
 * dropped: no other tab lists or counts them, and the Archived tab beside
 * the others lists them, read only while it is shown and counted by main's
 * word of each task, each drawn as it stood but answered no longer, the
 * pane's box giving way to Unarchive, which brings the task back and its
 * items with it as they stood. A press on a row chooses it, and the pane beside the
 * list (`inbox-pane.tsx`) shows it as a thread, answered in place, on its
 * task's own held read, which stands in for the list's read of that task
 * so an answer shows at once. With nothing chosen, the first item listed
 * that waits stands chosen, else the first listed. The pane's crumbs open
 * the task or the agent's tab, leaving the Inbox; what the item opens that
 * a task's side panel draws opens in that panel beside it instead, standing
 * for the chosen item's task (`use-tasks-tab.ts`): a code block's Open its
 * file, and a link naming a file of the task's repository, one of its
 * pages, or one of its agents' pull requests (`inbox-panel-link.ts`). The
 * panel's toggle, its width, and its keys are a task's own, and ⌘F finds in
 * the panel while it holds the keys, as on a task. With nothing listed, it says so under the Inbox's
 * glyph (`@luke/ui`'s `EmptyState`); with its tab leaving out every item, the list
 * says so and offers the tab beside it, while the pane goes on showing the item
 * chosen, answered, though the list draws it no row. Escape never leaves it, a stray press
 * being no reason to lose the item being read; any row of the sidebar does, and so does Back. Too narrow for the list and the item
 * side by side, it shows one at a time (`inbox-columns.ts`): the chosen
 * item, whose way back, Back's chord, or Escape gives the list, and a press
 * on a row there the item again. K and J, and the pager where the
 * item stands alone, step through the list (`inbox-pager.tsx`). Everything in it that names a
 * person, an answer and an agent's starter, reads them against the listed
 * workspace's members (`member-directory.tsx`). The chosen item's box
 * mentions what its repository and workspace hold (`answerPlace`), and
 * its skills are read through its holder and drawn as chips that open
 * their `SKILL.md` on GitHub.
 *
 * Its items are read and listed by `use-inbox-listing.ts`. While the account
 * has the inbox-first sidebar on, the shell reads them once and hands the
 * listing to the sidebar, which lists them (`sidebar-inbox.tsx`), and here,
 * where the chosen item then stands alone across the place, with no list of
 * its own and no way back to one, the list being always in sight.
 */

/** What leads back to the list from a missing item's notice, where the Inbox shows one column. */
const BACK_TO_INBOX = "Back to Inbox";

/** A taskless item's code reads no file, there being no task whose repository it reads through. */
const UNREAD_FILE = (): Promise<TasksFileAnswer> =>
  Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });

const nothing = (): void => undefined;

/** No tab of the Inbox's panel is drawn in semibold: what arrives on a task arrives on its page. */
const NO_UNREAD: readonly StripTab[] = [];

/** What the Inbox's panel says of calls: none, its task's calls being its page's. */
const NO_CALLS = {
  region: { kind: TRANSCRIPT_REGION.EMPTY },
  onRetry: nothing,
} as const;

/** No agent's tab stands open beside the Inbox, so no worker's tab stands in its panel. */
const NO_OPEN_AGENTS: readonly string[] = [];

/** The window's Inbox, in the task's place: every task's items and every automation's, and the chosen one read beside them. */
export function DesktopInbox({
  tasks,
  listing,
}: {
  tasks: TasksControl;
  /** The Inbox as the inbox-first sidebar lists it, where the sidebar holds the list and the page shows the chosen item alone; none where the page reads and lists it itself. */
  listing?: InboxListing | undefined;
}): React.JSX.Element {
  return listing === undefined ? (
    <ListedInbox tasks={tasks} />
  ) : (
    <InboxShown tasks={tasks} listing={listing} paneOnly />
  );
}

/** The Inbox page reading its own items, its list and the chosen item side by side. */
function ListedInbox({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const listing = useInboxListing(tasks);
  return <InboxShown tasks={tasks} listing={listing} paneOnly={false} />;
}

/**
 * The Inbox as read: its list and the chosen item beside it, or, where the
 * sidebar lists it (`paneOnly`), the chosen item alone across the place,
 * with no way back to a list that is always in sight.
 */
function InboxShown({
  tasks,
  listing,
  paneOnly,
}: {
  tasks: TasksControl;
  listing: InboxListing;
  paneOnly: boolean;
}): React.JSX.Element {
  const {
    view,
    act,
    choices,
    folds,
    openAutomation,
    read,
    archivedRead,
    taskless,
    showArchived,
    asked,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    named,
    marks,
    standing,
    counts,
    list,
    steps,
    chosen,
    filteredOut,
    missing,
    reading,
    choose,
    closeItem,
    onRetry,
  } = listing;
  const openLink = useOpenLink();
  const now = useMinute();
  // A missing item's pane stands where its item would, so a narrow Inbox shows the notice rather than the list.
  // Note that the window keeps whether the list was asked for, so its history can go back to it.
  const { listed, onListed, onSingle } = view;
  const pageColumns = useInboxColumns(
    chosen?.item.id ?? (missing ? asked?.itemId : undefined),
    !paneOnly,
    { asked: listed, onAsk: onListed, onSingle: paneOnly ? undefined : onSingle },
  );
  // Note that the Inbox reports one column only once an item stands, since its list lives in the sidebar and a list step would show nothing new.
  const itemStands = chosen !== undefined;
  useLayoutEffect(() => {
    if (paneOnly) onSingle?.(itemStands);
  }, [paneOnly, onSingle, itemStands]);
  // Note that with the list in the sidebar the place shows the item alone, measured by nothing, with no way back to a list that stays in sight.
  const columns = paneOnly
    ? { ...pageColumns, ref: undefined, shown: INBOX_COLUMNS.ITEM, onBack: undefined }
    : pageColumns;
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const { onMark: markItem } = marks;
  const pager = useInboxPager(steps, list, chosen?.item.id, choose, {
    shown: tasks.shown,
    folded: folds.folded,
  });
  const next = inboxNext(
    steps,
    chosen,
    ({ holder, item }) => (
      <ItemMark holder={holder} agentId={item.agentId} models={named.models} readerId={tasks.me} />
    ),
    open,
    folds.folded,
  );
  // A choice that asks for its item opens it once, the one column the Inbox shows being the
  // item's; Back from it then stands on the list, the choice taken already.
  const opensItem = asked?.opened === true && chosen?.item.id === asked.itemId;
  const taken = useRef<InboxChoice | undefined>(undefined);
  const openColumn = columns.onOpen;
  useEffect(() => {
    if (!opensItem || asked === undefined || taken.current === asked) return;
    taken.current = asked;
    openColumn(asked.itemId);
  }, [opensItem, asked, openColumn]);
  // Where the chosen item's words are read: its plan's workspace and repository, or, with no plan, its agent's own.
  const place = chosen === undefined ? undefined : answerPlace(chosen, agents, tasks);
  // Where the chosen item's links are written: under its own workspace, by slug once the workspaces are read.
  const chosenWorkspaceId =
    chosen === undefined
      ? undefined
      : chosen.holder.kind === INBOX_HOLDER.TASK
        ? chosen.holder.task.workspaceId
        : (agents.workspaceId ?? itemWorkspaceId(chosen.holder, chosen.item.agentId));
  const chosenLinkWorkspace =
    chosenWorkspaceId === undefined
      ? (tasks.workspace?.slug ?? tasks.workspace?.id)
      : (tasks.workspaces.find((each) => each.id === chosenWorkspaceId)?.slug ?? chosenWorkspaceId);
  // What the chosen item's box offers an `@`, read under that workspace and repository.
  const mentionTasks = useMemo(
    () => [...tasks.tasks, ...tasks.archived],
    [tasks.tasks, tasks.archived],
  );
  const readMentionAgents = useMentionAgentsReader(place?.workspaceId, mentionTasks, named.models);
  const mentions =
    place === undefined
      ? undefined
      : tasklessMentions(place, tasks.onShowMention, readMentionAgents);
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the Inbox.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The item shown is read as it opens, and U marks it, only while the Inbox holds the keys and the panel does not cover it.
  const opened =
    tasks.shown && !sidePanel.fullScreen && columns.shown !== INBOX_COLUMNS.LIST
      ? chosen
      : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: tasks.shown && !sideFocused,
    onMark: markItem,
  });
  // A notice of the reader's own is acknowledged as it opens, on the same terms, once its holder's held read holds it.
  useNodOnOpen({ shown: opened, readerId: tasks.me, control: live });
  // The panel stands for the item asked for, by its task, or its agent where it has none (`use-tasks-tab.ts`).
  const panelFor = taskId ?? chosenAgentId;
  const pullRequests = [...named.pullRequests].map(([agentId, opened]) => ({
    agentId,
    url: opened.url,
  }));
  const { pages, onRereadPages } = view;
  // The panel's state is held to the task's agents this Inbox read, whose Pull request tabs alone the panel draws.
  const { onTaskAgents } = view;
  const taskAgents = agents.agents;
  useEffect(() => {
    if (taskId === undefined || taskAgents === undefined) return;
    onTaskAgents(
      taskId,
      taskAgents.map((agent) => agent.id),
    );
  }, [taskId, taskAgents, onTaskAgents]);
  const openHere: OpenHere = (href) => {
    const target = inboxPanelTarget(href, {
      taskId,
      repository: chosenTask?.repository ?? null,
      pullRequests,
      agentIds: named.agentIds,
    });
    if (target === undefined || panelFor === undefined) return false;
    switch (target.kind) {
      case INBOX_PANEL_TARGET.FILE: {
        const { path, lines } = target;
        if (lines === undefined) sidePanel.onOpenFile({ path });
        else
          sidePanel.onOpenFile(
            { path, startLine: lines.startLine, endLine: lines.endLine },
            lines.commit,
          );
        return true;
      }
      case INBOX_PANEL_TARGET.PAGE:
        // A page an agent showed since the pages were read, or whose read did not answer, stands once they are read again.
        if (pages?.some((page) => page.id === target.pageId) !== true) onRereadPages();
        sidePanel.onChoose({ page: target.pageId });
        return true;
      case INBOX_PANEL_TARGET.CHANGES:
        sidePanel.onChoose({ changes: target.agentId });
        return true;
      case INBOX_PANEL_TARGET.PULL_REQUEST:
        showPullRequest(
          sidePanel,
          named,
          target.agentId,
          PULL_REQUEST_VIEW.CONVERSATION,
          target.number,
        );
        return true;
    }
  };
  const openItemLink = (href: string) => {
    if (!openHere(href)) openLink(href);
  };
  return (
    <LinkWorkspaceProvider value={listedWorkspace?.slug ?? listedWorkspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationDirectory workspace={tasks.workspace} wanted onOpen={openAutomation}>
          <div ref={onArea} className="desktop-task" data-panel-open={String(sidePanel.open)}>
            {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className="inbox-view" ref={columns.ref} data-columns={columns.shown}>
                {paneOnly ? null : (
                  <InboxList
                    view={list}
                    chosen={chosen?.item.id}
                    columns={columns.shown}
                    rows={columns.rows}
                    head={{
                      shown: tasks.shown,
                      show: choices,
                      counts,
                      view: { choices, folds },
                      // Note that Mark all as read marks what the service's own mark reaches, which leaves the archived tasks' items be.
                      readAll: {
                        unread: anyUnread(standing),
                        onMarkAll: () => marks.onMarkAll(standing.flatMap(({ items }) => items)),
                      },
                    }}
                    models={named.models}
                    readerId={tasks.me}
                    note={
                      <InboxListNote
                        failed={showArchived ? archivedRead.failed : read.failed || taskless.failed}
                        reading={reading}
                        empty={listedItems(list).length === 0}
                        alone={columns.shown === INBOX_COLUMNS.LIST}
                        filteredOut={filteredOut ? choices : undefined}
                        counts={counts}
                        onList={columns.onList}
                        onRetry={onRetry}
                      />
                    }
                    onChoose={open}
                    onMark={(listed, unread) => markItem(listed.item, unread)}
                    onClose={closeItem}
                  />
                )}
                {chosen === undefined ? (
                  <section
                    className="inbox-view-items"
                    aria-label="Inbox"
                    // Note that with the list in the sidebar this is the whole place, so its empty state and its missing item's notice always stand.
                    hidden={
                      paneOnly
                        ? false
                        : missing
                          ? columns.shown === INBOX_COLUMNS.LIST
                          : columns.shown !== INBOX_COLUMNS.BOTH
                    }
                  >
                    <header className="desktop-toolbar" />
                    {missing ? (
                      <NotFound
                        thing={NOT_FOUND_THING.INBOX_ITEM}
                        action={
                          columns.onBack === undefined
                            ? undefined
                            : { label: BACK_TO_INBOX, onClick: columns.onBack }
                        }
                      />
                    ) : reading || filteredOut ? null : (
                      // Note that the list says what the filter left out, so the pane beside it stands bare.
                      <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>
                    )}
                  </section>
                ) : (
                  <OpenHereProvider value={openHere}>
                    <SkillFiles
                      source={agents.readSkills}
                      onOpen={(skill) => {
                        // Note that a skill's file opens on GitHub, as off any plan's page, since the panel beside the Inbox opens only what the item names.
                        if (place === undefined) return;
                        const url = encodeMention(
                          { kind: MENTION_KIND.FILE, path: skill.path },
                          place,
                        );
                        appPlatform().openGitHub(url);
                      }}
                    >
                      {/* The item's links are written under its own workspace, which a link may open outside the one listed. */}
                      <LinkWorkspaceProvider value={chosenLinkWorkspace}>
                        <InboxPane
                          holder={chosen.holder}
                          item={chosen.item}
                          control={live}
                          agents={named}
                          hidden={columns.shown === INBOX_COLUMNS.LIST}
                          onBack={columns.onBack}
                          pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
                          next={next}
                          mentions={mentions}
                          doors={{
                            ...paneDoors(tasks, chosen.holder, {
                              act,
                              openLink: openItemLink,
                              now,
                              panelFor,
                            }),
                            onMark: markItem,
                            onClose: closeItem,
                          }}
                        />
                      </LinkWorkspaceProvider>
                    </SkillFiles>
                  </OpenHereProvider>
                )}
              </div>
            </PageFind>
            {drawing.panel ? (
              <InboxSidePanel
                tasks={tasks}
                drawing={{ ...drawing, panel: drawing.panel }}
                focused={sideFocused}
                taskId={taskId}
                panelFor={panelFor}
                repository={chosenTask?.repository ?? agents.agentRepository ?? null}
                pages={pages}
                agents={named}
                views={views}
              />
            ) : null}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

/**
 * Where the chosen item's words are read in the window's Inbox, which
 * stands on no plan's page: its plan's workspace, by its slug, and
 * repository, or, for an agent with no plan, the agent's own as its read
 * names them, never its group's, which agents of other repositories share
 * and which an agent a link reached stands under with none. Its box
 * mentions what that repository and workspace hold, as the page of an
 * agent no plan holds does (`tasklessMentions`), and its skills' files
 * open there. None until both are known.
 */
function answerPlace(
  chosen: InboxListed,
  agents: CodingAgentsControl,
  tasks: TasksControl,
): TasklessPlace | undefined {
  const { holder, item } = chosen;
  const workspaceId =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.workspaceId
      : (agents.workspaceId ?? itemWorkspaceId(holder, item.agentId));
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : agents.agentRepository;
  if (workspaceId === undefined || repository === undefined || repository === null) {
    return undefined;
  }
  const workspace = tasks.workspaces.find((each) => each.id === workspaceId)?.slug ?? workspaceId;
  return { workspace, workspaceId, repository };
}

/**
 * The side panel beside the Inbox, standing for the chosen item's task, or
 * its agent where it has none (`use-tasks-tab.ts`): what the item opened
 * there, and what the task's "+" offers of it. A row of its tabs that
 * opens what it names opens it as the item's crumbs and links do: an
 * agent's tab leaves for it, a page stands in the panel, and the task's
 * own tabs leave for the task.
 */
function InboxSidePanel({
  tasks,
  drawing,
  focused,
  taskId,
  panelFor,
  repository,
  pages,
  agents,
  views,
}: {
  tasks: TasksControl;
  drawing: SidePanelDrawing & { panel: SidePanelControl };
  focused: boolean;
  /** The chosen item's task, none for an item of an agent with no task. */
  taskId: string | undefined;
  panelFor: string | undefined;
  repository: string | null;
  pages: TasksControl["inboxView"]["pages"];
  agents: CodingAgentsControl;
  views: TabViews;
}): React.JSX.Element {
  const { panel } = drawing;
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.PAGE) return panel.onChoose({ page: target.page });
    if (target.kind === TOOL_TARGET.TASK) return tasks.onShowTask(target.task);
    if (target.kind === TOOL_TARGET.AGENT) {
      return taskId === undefined
        ? tasks.agentView.onOpen(target.agent)
        : tasks.onShowAgent(taskId, target.agent);
    }
    if (target.kind !== TOOL_TARGET.INBOX && taskId !== undefined) tasks.onShowTask(taskId);
  };
  // The task's agents' workers are their delegations, read through their own transcripts, so the panel's work is none.
  const work = {
    conversation: undefined,
    onLoadEarlier: () => Promise.resolve(),
    readWorker: agents.readTranscript,
  };
  return (
    <SidePanel
      {...drawing}
      unread={NO_UNREAD}
      holder={SIDE_PANEL_HOLDER.INBOX}
      taskId={panelFor ?? ""}
      repository={repository}
      board={undefined}
      shownCode={undefined}
      codeFailed={undefined}
      pages={pages}
      transcript={NO_CALLS}
      work={work}
      agents={agents}
      openAgents={NO_OPEN_AGENTS}
      shownAgent={undefined}
      views={views}
      shown={tasks.shown}
      focused={focused}
      onOpenTarget={openTarget}
    />
  );
}

/**
 * The pane's doors for what holds its item: a task's open the task, its
 * agents' tabs, and its files, a file in the panel beside the Inbox where
 * the panel stands for the task; an automation's open its page where the
 * Automations experiment is on, its agents' own pages, and no file, there
 * being no task whose repository a file is read through.
 */
function paneDoors(
  tasks: TasksControl,
  holder: InboxHolder,
  seams: {
    act: ReturnType<typeof useAct>["act"];
    openLink: (url: string) => void;
    now: number;
    /** The task, or the agent, the panel beside the Inbox stands for. */
    panelFor: string | undefined;
  },
): InboxPaneDoors {
  if (holder.kind === INBOX_HOLDER.TASK) {
    const { task } = holder;
    return {
      onOpenHolder: () => tasks.onShowTask(task.id),
      taskCard: taskCardOf(tasks, task, seams.now),
      onOpenAgent: (agentId) => tasks.onShowAgent(task.id, agentId),
      openLink: seams.openLink,
      onUnarchive:
        task.archivedAt === undefined
          ? undefined
          : () => tasks.onMarkTask(task.id, TASK_MARK.UNARCHIVE),
      code: {
        repository: task.repository,
        readFile: (window) => seams.act(ACT_KIND.TASKS_FILE, { taskId: task.id, ...window }),
        onOpenFile: (ref, commit) =>
          seams.panelFor === task.id
            ? tasks.sidePanel.onOpenFile(ref, commit)
            : tasks.onShowFile(task.id, ref, commit),
      },
    };
  }
  const { automationId } = holder;
  return {
    onOpenHolder:
      automationId !== null
        ? () => tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    taskCard: undefined,
    onOpenAgent: (agentId) => tasks.agentView.onOpen(agentId),
    openLink: seams.openLink,
    code: { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined },
  };
}
