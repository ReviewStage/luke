import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxParams,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { EmptyState, ErrorState } from "@luke/ui";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "@luke/ui/inbox-panel-link";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAct } from "../act";
import { appPlatform } from "../app-platform";
import { AutomationDirectory } from "../automation-directory";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { FIND_PAGE, PageFind } from "../find-in-tab";
import { MemberDirectory } from "../member-directory";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { INBOX_COLUMNS, useInboxColumns } from "../tasks/inbox-columns";
import { InboxList, ItemMark, NeedsYouEmpty } from "../tasks/inbox-list";
import {
  anyNeedsYou,
  firstChoice,
  INBOX_HOLDER,
  type InboxGroup,
  type InboxHolder,
  type InboxListed,
  inboxList,
  itemWorkspaceId,
  listedItems,
  NEEDS_YOU,
  type TasklessInboxAgent,
  taskHolder,
  tasklessGroups,
} from "../tasks/inbox-model";
import { inboxNext, useInboxPager } from "../tasks/inbox-pager";
import { InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane";
import { SkillFiles } from "../tasks/skill-chip";
import {
  type TasklessPlace,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions";
import { useMinute } from "../tasks/task-time";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model";
import { type CodingAgentsControl, useCodingAgents } from "../tasks/use-coding-agents";
import { useInboxItems } from "../tasks/use-inbox-items";
import { type OpenHere, OpenHereProvider, useOpenLink } from "../tasks/use-open-link";
import { PULL_REQUEST_VIEW, type SidePanelControl } from "../tasks/use-side-panel";
import { useTaskInbox } from "../tasks/use-task-inbox";
import { useTasklessInboxItems } from "../tasks/use-taskless-inbox-items";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab";
import { useExperiment } from "../use-app-state";
import { type InboxWaitingOnly, useInboxTaskFolds, useInboxViewChoices } from "./folded-groups";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel";
import { type TabViews, useTabViews } from "./strip-tabs";
import { taskCardOf } from "./task-card";

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every task of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the task's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each task of the
 * workspace the sidebar lists that main says holds one (the switcher counts
 * what waits in the others), needing the developer or settled, each task read whole
 * as main says it changed (`use-inbox-items.ts`), under its task or newest
 * first, all or only what needs them, as the developer last chose; Needs
 * you is the Inbox's one name for an item not yet answered
 * (`inbox-model.ts`'s `NEEDS_YOU`), and the sidebar's Inbox row counts the
 * same items. A press on a row chooses it, and the pane beside the
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
 * glyph (`@luke/ui`'s `EmptyState`); with Needs you leaving out every item, the list
 * says so and offers Show all, while the pane goes on showing the item
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
 */

/** What leads back to the list from a missing item's notice, where the Inbox shows one column. */
const BACK_TO_INBOX = "Back to Inbox";

/** What the list says where a task's read did not answer. */
const NOT_READ = "Some items could not be read.";

/** The tasks the list holds items of, in main's order: each holding one that the listed workspace's list holds, so an archived task, one not yet read, or another workspace's is listed nowhere. */
function listedHoldings(
  holdings: TasksControl["inboxTasks"],
  listed: TasksControl["tasks"],
): readonly AppInboxTaskHolding[] {
  return holdings.filter((holding) => listed.some((task) => task.id === holding.taskId));
}

/** What stands under the list's rows: a read that did not answer, the spinner while nothing is read, Needs you's empty state where it leaves out every item, or the empty line, the Inbox's empty state where the list stands alone. */
function ListNote({
  failed,
  reading,
  empty,
  alone,
  filteredOut,
  onList,
  onRetry,
}: {
  failed: boolean;
  reading: boolean;
  empty: boolean;
  /** Whether the list stands alone, the Inbox too narrow for the pane beside it. */
  alone: boolean;
  /** Needs you, where it leaves out every item the Inbox holds, for its empty state to turn off. */
  filteredOut: InboxWaitingOnly | undefined;
  /** Asks for the list, so Show all leaves it standing. */
  onList: () => void;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (failed) {
    return (
      <div className="sidebar-note">
        <ErrorState onRetry={onRetry}>{NOT_READ}</ErrorState>
      </div>
    );
  }
  if (!empty) return null;
  if (reading) return <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />;
  if (filteredOut !== undefined) return <NeedsYouEmpty needsYou={filteredOut} onList={onList} />;
  // Note that the list standing alone is the whole Inbox, so it says so as the hidden pane would.
  if (alone) return <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>;
  return <p className="sidebar-note">{NEEDS_YOU.NONE}</p>;
}

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
export function DesktopInbox({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const view = tasks.inboxView;
  const { act } = useAct();
  const openLink = useOpenLink();
  const now = useMinute();
  const choices = useInboxViewChoices();
  const folds = useInboxTaskFolds();
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  // Note that the Inbox reads the automations whenever it stands, because the items of agents with no task it lists are every one an automation's.
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inboxTasks, tasks: listedTasks } = tasks.listed;
  const holdings = useMemo(
    () => listedHoldings(inboxTasks, listedTasks),
    [inboxTasks, listedTasks],
  );
  const read = useInboxItems({ holdings, readInbox });
  const taskless = useTasklessInboxItems(tasks.inboxTaskless);
  const asked = view.chosen;
  const chosenTask =
    asked !== undefined && "taskId" in asked
      ? tasks.tasks.find((task) => task.id === asked.taskId)
      : undefined;
  const taskId = chosenTask?.id;
  const chosenAgentId = asked !== undefined && "agentId" in asked ? asked.agentId : undefined;
  const agents = useCodingAgents({
    acts: { act },
    taskId,
    ...(chosenAgentId === undefined ? undefined : { agentId: chosenAgentId }),
    repository: chosenTask?.repository ?? null,
    archived: false,
    onUnarchive: () => undefined,
    // The Inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
    me: tasks.me,
  });
  const readAgentInbox = useCallback(
    (after: string) =>
      chosenAgentId === undefined
        ? Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const)
        : act(ACT_KIND.CODING_AGENTS_AGENT_INBOX, { agentId: chosenAgentId, after }),
    [act, chosenAgentId],
  );
  // Note that an agent with no task holds its own read, by its id, as a task's is held by the task's.
  const live = useTaskInbox({
    taskId: taskId ?? chosenAgentId,
    ...(chosenAgentId === undefined ? undefined : { reader: readAgentInbox }),
    shown: tasks.shown,
    waiting:
      tasks.inbox.some((each) => each.taskId === taskId) ||
      tasks.inboxTaskless.some((each) => each.agentId === chosenAgentId),
    agents,
  });
  // Note that the models come from the open task's agents where this task's have not read them, so an agent is named alike in both.
  const named = { ...agents, models: agents.models ?? tasks.agents.models };
  // The chosen holder's own held read stands in for the list's once it answered, so an answer shows
  // at once, and only while it holds, since one that failed stops hearing what changed.
  const liveItems: readonly InboxItem[] = [...live.board.open, ...live.board.settled];
  const holdsLive = live.read && !live.failed;
  const taskEntries: InboxGroup[] = holdings.flatMap((holding) => {
    const task = tasks.tasks.find((each) => each.id === holding.taskId);
    if (task === undefined) return [];
    const items =
      holdsLive && holding.taskId === taskId ? liveItems : read.items.get(holding.taskId);
    return [{ holder: taskHolder(task), items: items ?? [] }];
  });
  const tasklessRead =
    holdsLive && chosenAgentId !== undefined
      ? new Map(taskless.items).set(chosenAgentId, liveItems)
      : taskless.items;
  // An agent with no plan that a link names, none of whose items waits any longer, is grouped by its own read, which the account's list of waiting agents leaves out, in its own workspace's list alone.
  const pageAgent = agents.agents?.[0] ?? agents.archived?.[0];
  const settledAgent: TasklessInboxAgent[] =
    chosenAgentId !== undefined &&
    holdsLive &&
    pageAgent !== undefined &&
    !tasks.inboxTaskless.some((each) => each.agentId === chosenAgentId)
      ? [
          {
            agentId: pageAgent.id,
            agentTitle: pageAgent.title,
            agentModel: pageAgent.model,
            automationId: pageAgent.automationId ?? null,
            automationName: null,
            repository: "",
            ...(agents.workspaceId === undefined ? undefined : { workspaceId: agents.workspaceId }),
          },
        ]
      : [];
  const entries = [
    ...taskEntries,
    ...tasklessGroups([...tasks.inboxTaskless, ...settledAgent], tasklessRead, tasks.workspace?.id),
  ];
  const filter = {
    grouping: choices.grouping,
    waitingOnly: choices.waitingOnly,
    readerId: tasks.me,
  };
  // The rows hold what the filter lists alone, while the steps keep the item the pane shows in its place.
  const list = inboxList(entries, { ...filter, chosen: undefined });
  const steps = inboxList(entries, { ...filter, chosen: asked?.itemId });
  const chosen = listedItems(steps).find(({ item }) => item.id === asked?.itemId);
  // Note that Needs you leaving out every item listed is said apart from an Inbox holding none.
  const filteredOut =
    choices.waitingOnly &&
    listedItems(list).length === 0 &&
    entries.some(({ items }) => items.length > 0);
  // Note that a chosen item whose task or agent is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose task left the list, archived elsewhere, gives way.
  // A holder whose agents' read answered none, or that it is not there, holds no Inbox to read;
  // one whose agents are not read yet may still hold the item, until its Inbox's own read answers.
  const holderEmpty = agents.listMissing || agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined && !agents.listFailed && !agents.listMissing;
  // Note that a plan's items read before main's latest word of it may lack the item asked for, so only a current read settles it.
  const chosenWaits =
    (taskId !== undefined &&
      !read.current.has(taskId) &&
      !live.read &&
      (holdings.some((holding) => holding.taskId === taskId) || agentsUnread)) ||
    (chosenAgentId !== undefined &&
      !taskless.current.has(chosenAgentId) &&
      !live.read &&
      !agents.listMissing);
  const reading =
    holdings.some((holding) => !read.items.has(holding.taskId)) ||
    tasks.inboxTaskless.some((each) => !taskless.items.has(each.agentId));
  // An item asked for by a link or a notification that no read holds once every read has landed is
  // not there for the reader, whether it was deleted or is of a task they cannot read, and its pane
  // says so rather than giving way to the first item.
  // Note that only the asked holder's own reads are waited on, since another's that failed says nothing of this item.
  const holderRead =
    taskId !== undefined
      ? read.current.has(taskId) || live.read || holderEmpty
      : chosenAgentId !== undefined
        ? live.read || taskless.current.has(chosenAgentId) || holderEmpty
        : true;
  const missing = asked?.opened === true && chosen === undefined && !chosenWaits && holderRead;
  // Note that an item a link or a notification asked for is never given way to, found or not, because the reader asked for that one.
  const standIn =
    chosen === undefined && !chosenWaits && !missing && asked?.opened !== true
      ? firstChoice(list)
      : undefined;
  const { onChoose } = view;
  const choose = useCallback(
    ({ holder, item }: InboxListed) =>
      onChoose(
        holder.kind === INBOX_HOLDER.TASK
          ? { taskId: holder.task.id, itemId: item.id }
          : { agentId: item.agentId, itemId: item.id },
      ),
    [onChoose],
  );
  useEffect(() => {
    if (standIn !== undefined) choose(standIn);
  }, [standIn, choose]);
  // A missing item's pane stands where its item would, so a narrow Inbox shows the notice rather than the list.
  const columns = useInboxColumns(chosen?.item.id ?? (missing ? asked?.itemId : undefined), true);
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    choose(listed);
    columns.onOpen(listed.item.id);
  };
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
  const onRetry = () => {
    read.onRetry();
    taskless.onRetry();
  };
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the Inbox.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The panel stands for the item asked for, by its task, or its agent where it has none (`use-tasks-tab.ts`).
  const panelFor = taskId ?? chosenAgentId;
  const pullRequests = [...named.pullRequests].map(([agentId, opened]) => ({
    agentId,
    url: opened.url,
  }));
  const { pages, onRereadPages } = view;
  const openHere: OpenHere = (href) => {
    const target = inboxPanelTarget(href, {
      taskId,
      repository: chosenTask?.repository ?? null,
      pullRequests,
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
        showPullRequest(sidePanel, named, target.agentId, PULL_REQUEST_VIEW.CONVERSATION);
        return true;
    }
  };
  const openItemLink = (href: string) => {
    if (!openHere(href)) openLink(href);
  };
  return (
    <LinkWorkspaceProvider value={listedWorkspace?.slug ?? listedWorkspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationDirectory
          workspace={tasks.workspace}
          on={automationsOn}
          wanted
          onOpen={openAutomation}
        >
          <div ref={onArea} className="desktop-task" data-panel-open={String(sidePanel.open)}>
            {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className="inbox-view" ref={columns.ref} data-columns={columns.shown}>
                <InboxList
                  view={list}
                  chosen={chosen?.item.id}
                  columns={columns.shown}
                  rows={columns.rows}
                  head={{
                    shown: tasks.shown,
                    needsYou: choices,
                    view: { choices, folds },
                    waiting: anyNeedsYou(entries, tasks.me),
                  }}
                  models={named.models}
                  readerId={tasks.me}
                  note={
                    <ListNote
                      failed={read.failed || taskless.failed}
                      reading={reading}
                      empty={listedItems(list).length === 0}
                      alone={columns.shown === INBOX_COLUMNS.LIST}
                      filteredOut={filteredOut ? choices : undefined}
                      onList={columns.onList}
                      onRetry={onRetry}
                    />
                  }
                  onChoose={open}
                />
                {chosen === undefined ? (
                  <section
                    className="inbox-view-items"
                    aria-label="Inbox"
                    hidden={
                      missing
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
                        doors={paneDoors(tasks, chosen.holder, {
                          act,
                          openLink: openItemLink,
                          now,
                          automationsOn,
                          panelFor,
                        })}
                      />
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
    if (target.kind === TOOL_TARGET.AGENT) {
      return taskId === undefined
        ? tasks.agentView.onOpen(target.agent)
        : tasks.onShowAgent(taskId, target.agent);
    }
    if (target.kind !== TOOL_TARGET.INBOX && taskId !== undefined) tasks.onShowTask(taskId);
  };
  const cards = taskCards({
    agents,
    workRows: [],
    held: views.held,
    chosen: (opened) => panel.tab !== undefined && sameTab(opened, panel.tab),
    shownCode: [],
  });
  // The task's agents' workers are their delegations, read through their own transcripts, so the panel's work is none.
  const work = {
    conversation: undefined,
    callLive: false,
    onLoadEarlier: () => Promise.resolve(),
    readWorker: agents.readTranscript,
  };
  return (
    <SidePanel
      {...drawing}
      unread={NO_UNREAD}
      holder={SIDE_PANEL_HOLDER.INBOX}
      planId={panelFor ?? ""}
      repository={repository}
      board={undefined}
      shownCode={undefined}
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
      cards={cards}
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
    automationsOn: boolean;
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
      seams.automationsOn && automationId !== null
        ? () => tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    taskCard: undefined,
    onOpenAgent: (agentId) => tasks.agentView.onOpen(agentId),
    openLink: seams.openLink,
    code: { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined },
  };
}
