import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_KIND,
  type AgentStatus,
  type AgentSummary,
  type TasklessAgent,
} from "@luke/features/agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import type { MentionLines } from "@luke/features/mention-link";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { readingWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  InlineEdit,
  MoreButton,
  moreLabel,
  NOT_FOUND_THING,
  NotFound,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  OneLine,
  SidePanelIcon,
  STATUS_TONE,
  Toolbar,
  type ToolbarPlace,
  useMenu,
  useMinute,
} from "@luke/ui";
import { pullRequestAgentOf, repositoryPullRequestOf } from "@luke/ui/pull-request-link";
import { isAgentTab, type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FindScope } from "../find-in-tab.js";
import { usePageWorkspace } from "../links-at-hand.js";
import { MemberDirectory } from "../member-directory.js";
import { HERE } from "../route.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { agentName } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { UNREAD_FILE } from "../tasks/inbox-code-card.js";
import { agentHolder, inboxAgentOf, taskHolder } from "../tasks/inbox-model.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import { TAB_KIND } from "../tasks/tab-look.js";
import {
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { TerminalCommands } from "../tasks/terminal-commands.js";
import { placeOfTaskTarget, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import { type AgentsControl, useAgents } from "../tasks/use-agents.js";
import { WordsWorkspace } from "../tasks/use-link-standing.js";
import {
  OpenHereProvider,
  OpenLinkProvider,
  openPullRequestsHere,
  useOpenPlace,
  useReadLinkOpener,
} from "../tasks/use-open-link.js";
import { type PinHolder, PULL_REQUEST_VIEW, SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { useTaskInbox } from "../tasks/use-task-inbox.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu } from "./action-menu.js";
import {
  type AgentTerminalDoors,
  agentMenuGroups,
  useAgentActions,
  useAgentDraftDoors,
  useAgentTerminalDoors,
} from "./agent-actions.js";
import { useAgentReadMarks } from "./agent-read-marks.js";
import {
  AutomationRunSteps,
  AutomationRunStrip,
  automationTrail,
  useAutomationRunPlace,
} from "./automation-agent-run.js";
import { AgentPane } from "./main-tabs.js";
import { PhoneBack, PhoneHead, phoneBar } from "./phone-head.js";
import { type InboxItemAsk, SideInboxTab } from "./side-inbox-tab.js";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { moveToSectionEntry, useSectionDialogs } from "./sidebar-sections.js";
import { useTabViews } from "./strip-tabs.js";
import { tabCard } from "./tab-card.js";
import { taskCardOf } from "./task-card.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";
import { PlaceToolbar } from "./title-bar.js";

/**
 * desktop-agent-page.tsx -- one agent's page: an agent an automation started with no plan, drawn in the plan's place as the task column draws an agent's tab.
 *
 * An agent an automation's run starts belongs to the workspace rather than
 * to a task, so there is no task's column for its tab to stand in. Its page
 * stands where the task would, beside the sidebar, as the Inbox does, and
 * draws the task column's own agent pane (`main-tabs.tsx`'s `AgentPane`):
 * its transcript, its composer, its model and servers, and what it
 * published, at the document's reading width, each through the same
 * control a plan's agents are driven by, here holding the one agent read by
 * its id (`use-agents.ts`'s `agentId`). ⌘F finds in it as in a
 * plan's column. An `@` in its box offers its repository's files, its
 * skills, and the servers, read through its workspace since no plan names
 * them (`tasklessMentions`), the pages the agent showed and the pull request
 * it opened, and the workspace's agents, Luke's box among
 * them, though he works in no repository; a skill a message names is its
 * chip, which opens the skill's `SKILL.md` on GitHub, as a file it names does, since no
 * File tab reads a repository no plan names; and a dictation listens for its repository and
 * its title. A row of its inbox calls opens the panel's Inbox tab, which
 * lists the agent's own items as a task's lists its agents'. Beside it stands
 * the window's side panel, held by the agent while its page stands
 * (`use-plans-tab.ts`): a delegation's row opens its worker there, and its
 * pull request's chip its pull request, as on a task, and its toggle,
 * its width, and its keys are the plan's own; ⌘T opens its "+", the page's
 * one, since the agent's own column opens no tab. Its title names the agent as
 * its tab would, and its ⋯ offers the agent's one menu, the very one its
 * tab's ⋯ offers on a task (`agent-actions.tsx`'s `agentMenuGroups`): Copy
 * link and the transcript's two copies, Rename, which turns the title into
 * its name's field, Show terminal, Archive, and Permanently delete, so an
 * agent with no task is acted on as a task's is; and, since such an agent
 * has a row of its own among the sidebar's tasks, what that row offers too:
 * Mark as unread or Mark as read, through a task's marks
 * (`agent-read-marks.ts`), and Pin or Unpin and Move to section, the
 * reader's own, while the agent is not archived, and never for Luke, who
 * has a row of his own kind; ⌘J and New terminal open its terminal as on a
 * task (`terminal-commands.tsx`). An archived agent takes no message, so
 * its composer gives way to its own Unarchive, which its ⋯ offers in
 * Archive's place, and it is not renamed. An agent the service will not hand the reader,
 * deleted or of a workspace they are not in, as a link may name, is not
 * found, and nothing of it is drawn. Whoever sent it a message is read against its
 * workspace's members, as on a plan, and the automation whose run started
 * it against its workspace's automations, so the prompt it opens on names
 * the automation and opens its page. An agent an automation's run started
 * leads its bar with the path to that automation, says under it what fired
 * the run, and steps through the automation's other runs' agents from the
 * bar's end (`automation-agent-run.tsx`). Escape leaves it for wherever it was
 * opened from, and so does any row of the sidebar.
 */

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** Nothing to do, for the doors a task's column opens and this page does not have. */
const nothing = (): void => undefined;

/** No tab arrived anything: arrivals are a plan's. */
const NO_UNREAD: readonly StripTab[] = [];

/** What the page's ⋯ is called. */
const ACTIONS_THING = "Agent";

/** What the title's field is called for a reader, as an agent's tab calls its own. */
const NAME_LABEL = "Agent name";

/**
 * The row the sidebar lists the agent by among its tasks, whose pin, read
 * marks, and section are the page's too: for an agent with no task, as the
 * listed workspace's agents hold it; none for an agent on a task, or one the
 * list does not hold, whose page then offers neither.
 */
function listedAgent(tasks: TasksControl, agent: AgentSummary): TasklessAgent | undefined {
  if (agent.planId !== null) return undefined;
  const { standing, archived } = tasks.listedAgents;
  return [...standing, ...archived].find((each) => each.id === agent.id);
}

/**
 * What a tab of the agent's page is pinned on: the agent while the sidebar
 * lists it standing, which is where the pin is drawn, or the task of an
 * agent on one, whose panel holds the same tab; none for an archived agent,
 * or one not read yet, which the sidebar draws no pin of.
 */
function pagePinOn(tasks: TasksControl, agent: AgentSummary | undefined): PinHolder | undefined {
  if (agent === undefined || agent.archivedAt !== undefined) return undefined;
  if (agent.planId !== null) return { task: agent.planId };
  const standing = tasks.listedAgents.standing.some((each) => each.id === agent.id);
  return standing ? { agent: agent.id } : undefined;
}

/**
 * The page's bar: its title and its ⋯, which offer the agent's one menu as
 * its tab in a task's column does (`agent-actions.tsx`'s
 * `agentMenuGroups`): its title turned into its name's field by Rename, and,
 * for an agent with no task, its sidebar row's own read mark, Pin, and
 * Move to section beside the tab's actions.
 */
function AgentPageBar({
  tasks,
  agent,
  agents,
  shown,
  terminals,
  onClose,
  phone,
  trail,
  steps,
}: {
  tasks: TasksControl;
  agent: AgentSummary;
  agents: AgentsControl;
  shown: boolean;
  /** The places above the page, an automation's agent's alone: Automations and its automation (`automation-agent-run.tsx`). */
  trail: readonly ToolbarPlace[] | undefined;
  /** What stands before the ⋯: the arrows through its automation's runs, an automation's agent's alone. */
  steps: React.ReactNode;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal">;
  /** Leaves the page, as Escape does, once the agent is deleted. */
  onClose: () => void;
  /** A phone's head (`phone-head.tsx`): its way back, and the panel its ⋯ opens; none elsewhere. */
  phone?: AgentPagePhone | undefined;
}): React.JSX.Element {
  const label = agentName(agent, agents.models);
  const actions = useAgentActions(agent, agents, { label, shown, terminals, onDeleted: onClose });
  // The page's agent's ⌥⌘C, ⇧⌥⌘C, and ⌘⌫, as its ⋯'s items run them.
  const { onCopy, deletion } = actions.doors;
  const copies = shown ? onCopy : undefined;
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    copies === undefined ? undefined : () => copies(TRANSCRIPT_COPY.CONCISE),
  );
  useAppCommand(
    APP_COMMAND.COPY_FULL_TRANSCRIPT,
    copies === undefined ? undefined : () => copies(TRANSCRIPT_COPY.FULL),
  );
  useAppCommand(
    APP_COMMAND.DELETE,
    shown && deletion !== undefined && deletion.disabled !== true ? deletion.onSelect : undefined,
  );
  const menu = useMenu(shown);
  const listed = listedAgent(tasks, agent);
  const reads = useAgentReadMarks();
  const sectionDialogs = useSectionDialogs(tasks, shown);
  // The agent's read mark is its sidebar row's: main's unseen dot, which a mark by hand adds to.
  const unseen = tasks.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === agent.id);
  const read =
    listed === undefined
      ? undefined
      : {
          unread: unseen || reads.markedUnread(agent.id),
          onMark: (next: boolean) => reads.mark(listed, next),
        };
  // Note that an archived agent offers neither a pin nor a section, as an archived task, and Luke never does.
  const own =
    listed !== undefined && agent.archivedAt === undefined && agent.kind !== AGENT_KIND.OPERATOR;
  const agentPin = own
    ? {
        pinned: listed.pinnedAt !== undefined,
        onToggle: () => tasks.onPinAgent(agent.id, listed.pinnedAt === undefined),
      }
    : undefined;
  const section = own
    ? moveToSectionEntry(
        tasks,
        { agent: true, id: agent.id },
        listed.workspaceId,
        sectionDialogs.askNew,
      )
    : undefined;
  const groups = agentMenuGroups({ chosen: true, ...actions.doors, read, agentPin, section });
  const { rename } = actions;
  const title =
    rename?.editing === true ? (
      <OneLine as={ONE_LINE_ELEMENT.H1} end={ONE_LINE_END.ELLIPSIS} className="luke-toolbar-title">
        <InlineEdit
          value={rename.asked ?? label}
          label={NAME_LABEL}
          maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
          editing
          onEnd={(edit) => {
            rename.end(edit.value);
          }}
        />
      </OneLine>
    ) : (
      label
    );
  const more = (
    <>
      <MoreButton thing={ACTIONS_THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(ACTIONS_THING)}
          menu={menu.drawn}
          groups={
            phone?.onShowPanel === undefined
              ? groups
              : [
                  ...groups,
                  [{ label: SHOW_PANEL, icon: <SidePanelIcon />, onSelect: phone.onShowPanel }],
                ]
          }
          onClose={menu.close}
        />
      )}
      {actions.dialog}
      {sectionDialogs.dialog}
    </>
  );
  if (phone !== undefined) {
    return (
      <PhoneHead place="agent" start={<PhoneBack back={phone.back} />} title={title} end={more} />
    );
  }
  // The page's name stands in the window's title bar where one stands, the bar under it keeping the page's acts.
  return (
    <PlaceToolbar
      title={title}
      trail={trail}
      actions={
        <>
          {steps}
          {more}
        </>
      }
    />
  );
}

/** What a phone's way back out of a draft calls the agent, before the agent is read. */
const AGENT = "Agent";

/** What Show panel is called in a phone's ⋯, where the title bar's toggle is not drawn. */
const SHOW_PANEL = "Show panel";

/** What a phone's agent page heads itself with (`phone-head.tsx`): its way back, and the panel its ⋯ shows, while it is shut. */
export interface AgentPagePhone {
  readonly back: TaskHeadBack;
  readonly onShowPanel: (() => void) | undefined;
}

/** The page's mentions, once there are any to hand; until then the box takes an `@` as the letter it is. */
function AgentMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
}

/** One agent's page, in the plan's place: the agent read by its id, drawn as the task column's agent pane. */
export function DesktopAgentPage({
  tasks,
  agentId,
  away,
}: {
  tasks: TasksControl;
  agentId: string;
  /** A phone's way back out of the page, to the page it was opened from (`WindowHistory`'s `onLeave`), which heads it as a phone's page (`phone-head.tsx`); none elsewhere. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  // The draft a Fork or a Continue opened on the page, by its key, which the pane shows in the agent's place.
  const [drafting, setDrafting] = useState<{ agentId: string; draftId: string } | undefined>(
    undefined,
  );
  const draftShown = drafting?.agentId === agentId ? drafting.draftId : undefined;
  // Escape leaves a draft for the agent it was opened from, its words kept, and the page otherwise.
  useAppCommand(
    APP_COMMAND.EXIT_AGENT_PAGE,
    draftShown === undefined ? tasks.agentView.onClose : () => setDrafting(undefined),
  );
  const { act } = useAct();
  const views = useTabViews();
  // The item an inbox call's row asked the panel's Inbox tab for, until the tab opens it.
  const [inboxAsk, setInboxAsk] = useState<InboxItemAsk | undefined>(undefined);
  const inboxAsked = useCallback(() => setInboxAsk(undefined), []);
  const { sidePanel } = tasks;
  const drawing = useSidePanelDrawing(sidePanel);
  const { onArea, focus, setFocus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the page.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  const openAgents = useMemo(() => [agentId], [agentId]);
  // ⌘T opens the panel's "+", the page's one, handing it the keys: the agent's own column opens no tab of its own.
  useAppCommand(APP_COMMAND.NEW_TAB, () => {
    setFocus(COLUMN.SIDE);
    sidePanel.onNewTab();
  });
  const agents = useAgents({
    acts: { act },
    taskId: undefined,
    agentId,
    repository: null,
    listedAgents: tasks.liveAgents,
    // An agent of a task, an archived one opened here among them, offers what that task's mode lets it.
    modeOf: (planId) => tasks.tasks.find((each) => each.id === planId)?.mode,
    onOpenIntegrations: tasks.agents.onOpenIntegrations,
    onOpenApiKeys: tasks.agents.onOpenApiKeys,
    // An agent a Continue or a Fork started opens on its own page, as a Start's tab opens on a task.
    onStarted: tasks.agentView.onOpen,
    me: tasks.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  // Note that the models come from the open task's agents where this page has not read them, so
  // the agent is named alike in both; and that an archived agent, which takes no message, is
  // brought back by its own Unarchive, there being no task to bring back with it.
  const { onArchive } = agents;
  const toast = useToast();
  const openLink = useReadLinkOpener();
  // An Unarchive refused says why, as any other refusal of the agent's does.
  // Note that it settles once the answer is said, so the note's Unarchive shows busy till then.
  const unarchive = () =>
    onArchive(agentId, false).then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({
          words: result.reason,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.AGENT_ARCHIVE, cause: result, about: { agentId } },
        });
      }
    }, nothing);
  // The agent's workspace as the account lists it, whose count reads its members again; by its id alone where the list does not hold it yet.
  const { workspaceId, agentRepository } = agents;
  usePageWorkspace(agentId, workspaceId);
  // Show terminal, ⌘J, and New terminal open the agent's terminals in the side panel, as its tab's do on a task.
  const terminalDoors = useAgentTerminalDoors(sidePanel, agentRepository, () =>
    setFocus(COLUMN.SIDE),
  );
  // The workspace's agents an `@` offers, named by the tasks the window lists.
  const readMentionAgents = useMentionAgentsReader(workspaceId, tasks.tasks, agents.models);
  const listed = tasks.workspaces.find((each) => each.id === workspaceId);
  const workspace = workspaceId === undefined ? undefined : (listed ?? { id: workspaceId });
  // The words a dictation into the agent's box listens for: its repository and its title.
  const keywords = useMemo(
    () =>
      dictationKeywords({
        repository: agentRepository ?? null,
        title: agent?.title ?? undefined,
        body: undefined,
      }),
    [agentRepository, agent?.title],
  );
  // The pane draws the agent as the column's tab would: archived or not, it is the list's one agent.
  // Note that what the pane is handed stands while it says the same, because the pane holds while it does (`memo`), and every row of the transcript with it.
  const control = useSteadyDoors({
    ...agents,
    agents: agent === undefined ? agents.agents : [agent],
    agentIds: agent === undefined ? agents.agentIds : [agent.id],
    models: agents.models ?? tasks.agents.models,
    keywords,
    onUnarchive: agent?.archivedAt === undefined ? undefined : unarchive,
  });
  const tab = useMemo(() => ({ agent: agentId }), [agentId]);
  // A Fork or a Continue opens the page's draft in the agent's place, through the same doors a task's column opens its own by.
  const draftDoors = useAgentDraftDoors(agents, agent?.archivedAt !== undefined, (draftId) =>
    setDrafting({ agentId, draftId }),
  );
  // The draft stands in the pane while it is the one the page opened, and the agent again once it starts or is let go.
  const draftTab =
    draftShown !== undefined && agents.draft?.id === draftShown ? draftShown : undefined;
  const paneTab = useMemo(
    () => (draftTab === undefined ? tab : { draft: draftTab }),
    [draftTab, tab],
  );
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  // Note that an inbox call and a page are the rows of a coding agent's own that open a tab, and a task's archive the one
  // that opens another task, as a link to it opens (`route.ts`), a worker's opening through its delegation.
  const openPlace = useOpenPlace();
  const openTarget = useSteadyDoor((target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) {
      if (target.key !== undefined) setInboxAsk({ taskId: agentId, key: target.key, agentId });
      sidePanel.onChoose(SIDE_PANEL_TAB.INBOX);
      setFocus(COLUMN.SIDE);
    }
    if (target.kind === TOOL_TARGET.TASK) openPlace?.(placeOfTaskTarget(target));
    // An agent's chip, such as one it was continued or forked to, opens that agent's own page.
    if (target.kind === TOOL_TARGET.AGENT) tasks.agentView.onOpen(target.agent);
    // A page the agent showed on itself opens in the panel beside it, as a task's opens beside its plan.
    if (target.kind === TOOL_TARGET.PAGE) sidePanel.onChoose({ page: target.page });
  });
  // A delegation's row opens its worker in the side panel, and the pull request's chip the pull request, as on a task.
  const openDelegation = useSteadyDoor(
    (agent: string, callId: string, task: string, status: AgentStatus) => {
      views.onWorkerStatus(callId, status);
      sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
    },
  );
  const openPullRequest = useSteadyDoor((published: string, number?: number) =>
    showPullRequest(sidePanel, control, published, PULL_REQUEST_VIEW.CONVERSATION, number),
  );
  // A link in the agent's words to the pull request it opened opens that same tab rather than GitHub, as on a task,
  // and one to any other pull request of its repository a Pull request tab by its number.
  // Note that the three openers handed to the transcript stand while what they read does, because every link and chip in it is drawn again with each new one.
  const { pullRequests, agentIds, heldIds } = control;
  const openHere = useMemo(
    () =>
      openPullRequestsHere(
        { kind: HERE.AGENT, repository: agentRepository, pullRequests, agentIds, heldIds },
        openPullRequest,
      ),
    [pullRequests, agentIds, heldIds, openPullRequest, agentRepository],
  );
  // A link to the page's own agent, as a fork's chip opens its source, leaves the page's draft for the agent.
  const openLinkHere = useMemo(
    () =>
      openLink === undefined
        ? undefined
        : (link: ReadLink) => {
            const { place } = link;
            const own =
              (place.kind === LINK_PLACE.AGENT || place.kind === LINK_PLACE.MESSAGE) &&
              place.agentId === agentId;
            if (own) setDrafting(undefined);
            openLink(link);
          },
    [openLink, agentId],
  );
  const shown = tasks.shown && !sidePanel.fullScreen;
  // An agent an automation's run started: its run among the automation's, followed live.
  const runPlace = useAutomationRunPlace(agent);
  const sideTab = sidePanel.tab;
  const planId = agent?.planId ?? null;
  const cards = useMemo(
    () =>
      taskCards({
        agents: control,
        held: views.held,
        chosen: (opened) =>
          sameTab(opened, tab) || (sideTab !== undefined && sameTab(opened, sideTab)),
        // Note that an agent on a task shows its pages on the task, so its rows read them there.
        pages: planId === null ? { agentId } : { taskId: planId },
      }),
    [control, views.held, tab, sideTab, planId, agentId],
  );
  // The agent's repository, which the panel beside it reads a file of by its workspace, once the read named both.
  const repositoryPlace = useMemo(
    () =>
      workspaceId === undefined || agentRepository === undefined
        ? undefined
        : { workspaceId, repository: agentRepository },
    [workspaceId, agentRepository],
  );
  // The agent's own Inbox, followed by its own scope while the page stands, as a task's is by its plan's, which the panel's Inbox tab draws.
  const inbox = useTaskInbox({
    taskId: agentId,
    kind: INBOX_SCOPE_KIND.AGENT,
    draftTask: agent?.planId ?? null,
    shown: tasks.shown,
    onScreen: tasks.inboxShown === agentId,
    waiting: false,
    readerId: tasks.me,
    agents: control,
  });
  // The panel is told what waits once each read lands, so an item the reader has not seen opens the Inbox tab, as on a task.
  const waiting = useMemo(() => inbox.board.open.map((item) => item.id), [inbox.board.open]);
  const { onInboxRead } = sidePanel;
  useEffect(() => {
    if (inbox.read) onInboxRead(agentId, waiting);
  }, [agentId, inbox.read, waiting, onInboxRead]);
  const now = useMinute();
  // A file a mention names opens in the panel beside the agent, its lines at the commit the mention pins them to.
  const openMentionedFile = useSteadyDoor((path: string, lines: MentionLines | undefined) =>
    lines === undefined
      ? sidePanel.onPreviewFile({ path })
      : sidePanel.onPreviewFile(
          { path, startLine: lines.startLine, endLine: lines.endLine },
          lines.commit,
        ),
  );
  // A skill's file opens where a file the agent names does: in the panel beside it.
  const openSkill = (skill: { readonly path: string }) => {
    if (repositoryPlace === undefined) return;
    sidePanel.onPreviewFile({ path: skill.path });
  };
  // A link to the pull request the agent opened, or a page under it, hangs its Pull request tab's card, as on a task.
  const pullRequestCard = useSteadyDoor((url: string) => {
    const pullRequest = control.pullRequests.get(agentId);
    if (pullRequest === undefined) return undefined;
    const number = repositoryPullRequestOf(url, agentRepository);
    const own =
      pullRequestAgentOf(url, [{ agentId, url: pullRequest.url }]) !== undefined ||
      (number !== undefined &&
        repositoryPullRequestOf(pullRequest.url, agentRepository) === number);
    if (!own) return undefined;
    const card = tabCard({
      kind: TAB_KIND.CHANGES,
      subject: agentSubject(control, agentId, views.held, false),
      models: control.models,
      pullRequest,
      people: peopleOf(control.changesPeople.get(agentId), pullRequest),
      onOpenAgent: () => setDrafting(undefined),
    });
    return card ?? undefined;
  });
  // What an `@` offers once the read named the agent's workspace, and its repository's files where it has one: Luke works in none.
  const mentionWorkspace = listed?.slug ?? workspaceId;
  const { onShowMention } = tasks;
  // An agent on no task offers the pages it showed and the pull request it opened, as a task offers its own.
  const ownPages = tasks.agentView.pages;
  const ownPullRequest = control.pullRequests.get(agentId);
  const ownName = agent === undefined ? undefined : agentName(agent, control.models);
  const holds = useMemo(
    () =>
      planId !== null
        ? undefined
        : {
            agentId,
            pages: ownPages,
            pullRequests:
              ownPullRequest === undefined ? [] : [{ ...ownPullRequest, agent: ownName }],
          },
    [planId, agentId, ownPages, ownPullRequest, ownName],
  );
  const mentions = useMemo(
    () =>
      workspaceId === undefined || mentionWorkspace === undefined
        ? undefined
        : tasklessMentions(
            { workspace: mentionWorkspace, workspaceId, repository: agentRepository ?? null },
            onShowMention,
            readMentionAgents,
            {
              pullRequestOf: pullRequestCard,
              onOpenFile: repositoryPlace === undefined ? undefined : openMentionedFile,
            },
            holds,
          ),
    [
      workspaceId,
      mentionWorkspace,
      agentRepository,
      onShowMention,
      readMentionAgents,
      pullRequestCard,
      repositoryPlace,
      openMentionedFile,
      holds,
    ],
  );
  // A phone's way back leaves a draft for the agent it was opened from first, as Escape does, and the page then.
  const phoneHead: AgentPagePhone | undefined =
    away === undefined
      ? undefined
      : {
          back:
            draftShown === undefined
              ? away
              : {
                  label: agent === undefined ? AGENT : agentName(agent, control.models),
                  onPress: () => setDrafting(undefined),
                },
          onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle,
        };
  const toolbar =
    agent === undefined ? (
      phoneHead === undefined ? (
        <Toolbar />
      ) : (
        <PhoneHead
          place="agent"
          start={<PhoneBack back={phoneHead.back} />}
          title={null}
          end={null}
        />
      )
    ) : (
      <AgentPageBar
        tasks={tasks}
        agent={agent}
        agents={control}
        shown={tasks.shown}
        terminals={terminalDoors}
        onClose={tasks.agentView.onClose}
        phone={phoneHead}
        trail={automationTrail(agent, tasks)}
        steps={
          runPlace === undefined ? null : (
            <AutomationRunSteps place={runPlace} onOpenAgent={tasks.agentView.onOpen} />
          )
        }
      />
    );
  if (agent === undefined) {
    // A page the service would not hand the reader keeps its bar over the words saying so.
    // On a phone the bar keeps the page's way back, the drawer and the places bar out of reach.
    if (agents.listMissing) {
      return (
        <NotFound
          thing={NOT_FOUND_THING.AGENT}
          bar={
            phoneHead === undefined
              ? {}
              : phoneBar({ place: "agent", start: <PhoneBack back={phoneHead.back} />, end: null })
          }
        />
      );
    }
    // In the page's own frame, so its row and sheet stand where the read page's will.
    return (
      <div className="desktop-task relative flex min-h-0 flex-1" data-panel-open="false">
        <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label="Agent">
          {toolbar}
          {agents.listFailed ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.AGENTS_READ)}
              onRetry={agents.onRetryList}
              placement={ERROR_STATE_PLACEMENT.CENTRED}
            >
              {NOT_READ}
            </ErrorState>
          ) : (
            <Fill className="desktop-task-column">
              <AgentTabSkeleton label={readingWords("the agent")} />
            </Fill>
          )}
        </Fill>
      </div>
    );
  }
  // The Inbox tab lists the agent's items under its task where the window lists it, as the task's own tab would, and under the agent otherwise.
  const inboxTask = planId === null ? undefined : tasks.tasks.find((each) => each.id === planId);
  const inboxHolder =
    inboxTask === undefined
      ? agentHolder(inboxAgentOf({ ...agent, repository: agentRepository, workspaceId }))
      : taskHolder(inboxTask);
  const inboxAutomation = agent.automationId ?? null;
  const inboxBody = (
    <SideInboxTab
      holder={inboxHolder}
      workspaceId={workspaceId}
      inbox={inbox}
      agents={control}
      readerId={tasks.me}
      shown={tasks.shown && sidePanel.open}
      ask={inboxAsk?.taskId === agentId ? inboxAsk : undefined}
      onAsked={inboxAsked}
      doors={{
        // The holder's crumb opens the agent's task, or the automation that started it.
        onOpenHolder:
          inboxTask !== undefined
            ? () => tasks.onShowTask(inboxTask.id)
            : inboxAutomation === null
              ? undefined
              : () => openAutomation(inboxAutomation),
        taskCard: inboxTask === undefined ? undefined : taskCardOf(tasks, inboxTask, now),
        // The page's own agent stands in its column already, leaving a draft shown there for it.
        onOpenAgent: (other) =>
          other === agentId ? setDrafting(undefined) : tasks.agentView.onOpen(other),
        // A code card reads its lines through the agent's repository and opens its file as the panel's preview.
        code:
          repositoryPlace === undefined
            ? { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined }
            : {
                repository: repositoryPlace.repository,
                readFile: (window) => act(ACT_KIND.TASKS_FILE, { ...repositoryPlace, ...window }),
                onOpenFile: sidePanel.onPreviewFile,
              },
      }}
    />
  );
  return (
    <LinkWorkspaceProvider value={listed?.slug ?? workspaceId}>
      {/* Note that the words are of the agent's workspace by its id, because one with no slug is named by its id in the slug's place, which no chip's provider read can find it by. */}
      <WordsWorkspace value={workspaceId}>
        <MemberDirectory workspace={workspace} readerId={tasks.me}>
          <AutomationDirectory
            workspace={listed}
            wanted={agent.automationId !== undefined}
            onOpen={openAutomation}
          >
            <SkillFiles source={control.readSkills} onOpen={openSkill}>
              <AgentMentions value={mentions}>
                <OpenLinkProvider value={openLinkHere}>
                  <OpenHereProvider value={openHere}>
                    {/* An archived agent's sandbox takes no shell, so ⌘J and New terminal stand only while it does not. */}
                    {terminalDoors.terminals && agent.archivedAt === undefined ? (
                      <TerminalCommands
                        here={agentId}
                        agents={control}
                        sidePanel={sidePanel}
                        onShown={() => setFocus(COLUMN.SIDE)}
                      />
                    ) : null}
                    <div
                      ref={onArea}
                      className="desktop-task relative flex min-h-0 flex-1"
                      data-panel-open={String(sidePanel.open)}
                    >
                      {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
                      <Fill
                        as={FILL_ELEMENT.SECTION}
                        className="agent-page"
                        aria-label="Agent"
                        hidden={sidePanel.fullScreen}
                      >
                        {toolbar}
                        {runPlace === undefined ? null : (
                          <AutomationRunStrip place={runPlace} status={agent.status} />
                        )}
                        <FindScope
                          className="desktop-task-column"
                          active={tasks.shown && !sideFocused}
                          subject={tab}
                        >
                          <AgentPane
                            label={agentName(agent, control.models)}
                            tabbed={false}
                            tab={paneTab}
                            agents={control}
                            shown={shown}
                            views={views}
                            onOpenDelegation={openDelegation}
                            onOpenPullRequest={openPullRequest}
                            onOpenTarget={openTarget}
                            cards={cards}
                            onFork={draftDoors.onFork}
                            onContinue={draftDoors.onContinue}
                          />
                        </FindScope>
                      </Fill>
                      {drawing.panel ? (
                        <SidePanel
                          {...drawing}
                          panel={drawing.panel}
                          unread={NO_UNREAD}
                          holder={SIDE_PANEL_HOLDER.AGENT}
                          taskId={agentId}
                          pinOn={pagePinOn(tasks, agent)}
                          repository={agentRepository ?? null}
                          repositoryPlace={repositoryPlace}
                          pages={tasks.agentView.pages}
                          inbox={{ body: inboxBody, board: inbox.board, drafted: inbox.drafted }}
                          agents={control}
                          openAgents={openAgents}
                          shownAgent={shown ? agentId : undefined}
                          views={views}
                          shown={tasks.shown}
                          focused={sideFocused}
                          onOpenTarget={openTarget}
                          phone={
                            away === undefined || agent === undefined
                              ? undefined
                              : {
                                  back: agentName(agent, control.models),
                                  onBack: sidePanel.onToggle,
                                }
                          }
                        />
                      ) : null}
                    </div>
                  </OpenHereProvider>
                </OpenLinkProvider>
              </AgentMentions>
            </SkillFiles>
          </AutomationDirectory>
        </MemberDirectory>
      </WordsWorkspace>
    </LinkWorkspaceProvider>
  );
}
