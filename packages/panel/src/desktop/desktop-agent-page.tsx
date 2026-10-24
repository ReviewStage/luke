import {
  CODING_AGENT_BOUNDS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ConfirmDialog,
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
  SpinnerRegion,
  STATUS_TONE,
  Toolbar,
  useMenu,
} from "@luke/ui";
import { pullRequestAgentOf, repositoryPullRequestOf } from "@luke/ui/pull-request-link";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FindScope } from "../find-in-tab.js";
import { usePageWorkspace } from "../links-at-hand.js";
import { MemberDirectory } from "../member-directory.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { peopleOf } from "../tasks/changes-card.js";
import { agentName } from "../tasks/coding-agent-model.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import { TAB_KIND } from "../tasks/tab-look.js";
import {
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { TerminalCommands } from "../tasks/terminal-commands.js";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { type CodingAgentsControl, useCodingAgents } from "../tasks/use-coding-agents.js";
import { WordsWorkspace } from "../tasks/use-link-standing.js";
import {
  OpenHereProvider,
  OpenLinkProvider,
  openPullRequestsHere,
  useReadLinkOpener,
} from "../tasks/use-open-link.js";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu } from "./action-menu.js";
import {
  type AgentTerminalDoors,
  useAgentActions,
  useAgentCallDoors,
  useAgentDraftDoors,
  useAgentTerminalDoors,
} from "./agent-actions.js";
import { isLuke, LUKE_NAME, useLukeOperator } from "./luke-operator.js";
import { AgentPane } from "./main-tabs.js";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { contentActionGroups, useTabViews } from "./strip-tabs.js";
import { tabCard } from "./tab-card.js";

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
 * its id (`use-coding-agents.ts`'s `agentId`). ⌘F finds in it as in a
 * plan's column. An `@` in its box offers its repository's files, its
 * skills, and the servers, read through its workspace since no plan names
 * them (`tasklessMentions`), and the workspace's agents, Luke's box among
 * them, though he works in no repository; a skill a message names is its
 * chip, which opens the skill's `SKILL.md` on GitHub, as a file it names does, since no
 * File tab reads a repository no plan names; and a dictation listens for its repository and
 * its title. A row of its inbox calls opens the window's Inbox, since the
 * agent's items stand there and no plan's Inbox tab does. Beside it stands
 * the window's side panel, held by the agent while its page stands
 * (`use-plans-tab.ts`): a delegation's row opens its worker there, and its
 * pull request's chip its pull request, as on a task, and its toggle,
 * its width, and its keys are the plan's own; ⌘T opens its "+", the page's
 * one, since the agent's own column opens no tab. Its title names the agent as
 * its tab would, and its ⋯ offers the agent's own actions, the very ones its
 * tab's ⋯ offers on a task (`agent-actions.tsx`): Rename, which turns the
 * title into its name's field, Open terminal, Copy link, the
 * transcript's two copies, and Archive agent, so an agent with no task is
 * acted on as a task's is; ⌘J and New terminal open its terminal as on a
 * task (`terminal-commands.tsx`). An archived agent takes no message, so
 * its composer gives way to its own Unarchive, which its ⋯ offers in
 * Archive's place, and it is not renamed. An agent the service will not hand the reader,
 * deleted or of a workspace they are not in, as a link may name, is not
 * found, and nothing of it is drawn. Whoever sent it a message is read against its
 * workspace's members, as on a plan, and the automation whose run started
 * it against its workspace's automations, so the prompt it opens on names
 * the automation and opens its page. Escape leaves it for wherever it was
 * opened from, and so does any row of the sidebar. Its composer offers Call
 * as its tab's does, through the window's same press (`agent-actions.tsx`'s
 * `useAgentCallDoors`), told the agent's own task, or none, whatever task is
 * open: the call is keyed by the agent, and asks first where it would hang
 * another agent's call up. While its call stands its foot draws the call as
 * its tab's would, and the code Luke shows on a call into an agent with no
 * task lands in its side panel's Code tab, which no task's record holds.
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
 * The page's bar: its title and its ⋯, which offer the agent's own actions as its
 * tab in a task's column does (`agent-actions.tsx`): its title turned into
 * its name's field by Rename, and every action of the tab's ⋯, in the same
 * groups (`strip-tabs.tsx`'s `contentActionGroups`).
 */
function AgentPageBar({
  agent,
  agents,
  shown,
  terminals,
  onClose,
  luke,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  shown: boolean;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal">;
  /** Leaves the page, as Escape does, once the agent is deleted. */
  onClose: () => void;
  /** Whether the agent is Luke, the account's operator, who is named Luke and is neither renamed, archived, nor deleted from here. */
  luke: boolean;
}): React.JSX.Element {
  const label = luke ? LUKE_NAME : agentName(agent, agents.models);
  const actions = useAgentActions(agent, agents, { label, shown, terminals, onDeleted: onClose });
  const menu = useMenu(shown);
  const doors = luke
    ? { ...actions.doors, onRename: undefined, archive: undefined, deletion: undefined }
    : actions.doors;
  const groups = contentActionGroups({
    chosen: true,
    onClose: undefined,
    onCloseOthers: undefined,
    pin: undefined,
    ...doors,
  });
  const rename = luke ? undefined : actions.rename;
  return (
    <Toolbar
      title={
        rename?.editing === true ? (
          <OneLine
            as={ONE_LINE_ELEMENT.H1}
            end={ONE_LINE_END.ELLIPSIS}
            className="luke-toolbar-title"
          >
            <InlineEdit
              value={label}
              label={NAME_LABEL}
              maxLength={CODING_AGENT_BOUNDS.MAX_TITLE_CHARS}
              editing
              onEnd={(edit) => {
                rename.end(edit.value);
              }}
            />
          </OneLine>
        ) : (
          label
        )
      }
      actions={
        <>
          <MoreButton thing={ACTIONS_THING} {...menu.trigger()} />
          {menu.drawn === undefined ? null : (
            <ActionMenu
              label={moreLabel(ACTIONS_THING)}
              menu={menu.drawn}
              groups={groups}
              onClose={menu.close}
            />
          )}
          {actions.dialog}
        </>
      }
    />
  );
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

/**
 * Reads the open task's agents again once the page's agent, an agent of
 * that task, is archived or brought back here. Note that the page reads its
 * one agent apart from the task's list, which is read only as the task
 * opens, so without this an agent brought back on its page would stay out
 * of its task's tabs, and ⌘K would still call it archived.
 */
function useTaskAgentsFollow(
  tasks: TasksControl,
  agentId: string,
  agent: { readonly planId: string | null; readonly archivedAt?: number | undefined } | undefined,
): void {
  const seen = useRef<{ agentId: string; archivedAt: number | undefined } | undefined>(undefined);
  const taskId = agent?.planId ?? null;
  const archivedAt = agent?.archivedAt;
  const drawn = agent !== undefined;
  const { activeTaskId } = tasks;
  const readTaskAgents = tasks.agents.onRetryList;
  useEffect(() => {
    if (!drawn) return;
    const was = seen.current;
    seen.current = { agentId, archivedAt };
    if (was === undefined || was.agentId !== agentId || was.archivedAt === archivedAt) return;
    if (taskId !== null && taskId === activeTaskId) readTaskAgents();
  }, [drawn, agentId, archivedAt, taskId, activeTaskId, readTaskAgents]);
}

/** One agent's page, in the plan's place: the agent read by its id, drawn as the task column's agent pane. */
export function DesktopAgentPage({
  tasks,
  agentId,
}: {
  tasks: TasksControl;
  agentId: string;
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
  // Luke's page is an agent's page in every way but his name and the actions he does not offer.
  const operator = useLukeOperator({ accountId: tasks.me, workspaceId: tasks.workspace?.id });
  const views = useTabViews();
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
  const agents = useCodingAgents({
    acts: { act },
    taskId: undefined,
    agentId,
    repository: null,
    onOpenIntegrations: tasks.agents.onOpenIntegrations,
    onOpenApiKeys: tasks.agents.onOpenApiKeys,
    // An agent a Continue or a Fork started opens on its own page, as a Start's tab opens on a task.
    onStarted: tasks.agentView.onOpen,
    me: tasks.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  // Note that Luke is known by his kind, so one a Reset retired is still drawn as Luke, never as an agent to rename or delete.
  const luke =
    operator !== undefined &&
    (operator.agentId === agentId || (agent !== undefined && isLuke(agent, operator)));
  useTaskAgentsFollow(tasks, agentId, agent);
  // Its Call names the agent's own task, or none, and an archived agent takes none.
  const calls = useAgentCallDoors(tasks.calls, {
    taskId: agent?.planId ?? undefined,
    archived: agent?.archivedAt !== undefined,
  });
  // The code a call into the agent showed, where it has no task to hold it.
  const held = tasks.agentCallCode;
  const shownCode = agent?.planId == null && held?.agentId === agentId ? held.shownCode : undefined;
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
        toast({ words: result.reason, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
      }
    }, nothing);
  // The agent's workspace as the account lists it, whose count reads its members again; by its id alone where the list does not hold it yet.
  const { workspaceId, agentRepository } = agents;
  usePageWorkspace(agentId, workspaceId);
  // Open terminal, ⌘J, and New terminal open the agent's terminals in the side panel, as its tab's do on a task.
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
  // that opens another task, as the sidebar opens it, a worker's opening through its delegation.
  const openTarget = useSteadyDoor((target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) tasks.inboxView.onOpen();
    if (target.kind === TOOL_TARGET.TASK) tasks.onShowTask(target.task);
    // An agent's chip, such as one it was continued or forked to, opens that agent's own page.
    if (target.kind === TOOL_TARGET.AGENT) tasks.agentView.onOpen(target.agent);
    // Code Luke showed on its call opens in the Code tab, its showings' one place on a page no task's File tab reads for.
    if (target.kind === TOOL_TARGET.SHOWN_CODE && shownCode !== undefined)
      sidePanel.onChoose(SIDE_PANEL_TAB.CODE);
    // A page the agent showed on itself opens in the panel beside it, as a task's opens beside its plan.
    if (target.kind === TOOL_TARGET.PAGE) sidePanel.onChoose({ page: target.page });
  });
  // A delegation's row opens its worker in the side panel, and the pull request's chip the pull request, as on a task.
  const openDelegation = useSteadyDoor(
    (agent: string, callId: string, task: string, status: CodingAgentStatus) => {
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
      openPullRequestsHere({ pullRequests, agentIds, heldIds }, openPullRequest, agentRepository),
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
  const sideTab = sidePanel.tab;
  const planId = agent?.planId ?? null;
  const cards = useMemo(
    () =>
      taskCards({
        agents: control,
        held: views.held,
        chosen: (opened) =>
          sameTab(opened, tab) || (sideTab !== undefined && sameTab(opened, sideTab)),
        shownCode: shownCode ?? [],
        // Note that an agent on a task shows its pages on the task, so its rows read them there.
        pages: planId === null ? { agentId } : { taskId: planId },
      }),
    [control, views.held, tab, sideTab, shownCode, planId, agentId],
  );
  // A skill's file opens where a file the agent names does: its page on GitHub.
  const openSkill = (skill: { readonly path: string }) => {
    if (agentRepository === undefined) return;
    const place = { workspace: listed?.slug ?? workspaceId ?? "", repository: agentRepository };
    const url = encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, place);
    appPlatform().openGitHub(url);
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
  const mentions = useMemo(
    () =>
      workspaceId === undefined || mentionWorkspace === undefined
        ? undefined
        : tasklessMentions(
            { workspace: mentionWorkspace, workspaceId, repository: agentRepository ?? null },
            onShowMention,
            readMentionAgents,
            pullRequestCard,
          ),
    [
      workspaceId,
      mentionWorkspace,
      agentRepository,
      onShowMention,
      readMentionAgents,
      pullRequestCard,
    ],
  );
  const toolbar =
    agent === undefined ? (
      <Toolbar />
    ) : (
      <AgentPageBar
        agent={agent}
        agents={control}
        shown={tasks.shown}
        terminals={terminalDoors}
        onClose={tasks.agentView.onClose}
        luke={luke}
      />
    );
  if (agent === undefined) {
    // A page the service would not hand the reader keeps its bar over the words saying so.
    if (agents.listMissing) return <NotFound thing={NOT_FOUND_THING.AGENT} bar={{}} />;
    return (
      <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label="Agent">
        {toolbar}
        {agents.listFailed ? (
          <ErrorState onRetry={agents.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {NOT_READ}
          </ErrorState>
        ) : (
          <SpinnerRegion delay label="Loading agent" />
        )}
      </Fill>
    );
  }
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
                      className="desktop-task"
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
                        <FindScope
                          className="desktop-task-column"
                          active={tasks.shown && !sideFocused}
                          subject={tab}
                        >
                          <AgentPane
                            call={calls}
                            label={luke ? LUKE_NAME : agentName(agent, control.models)}
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
                          repository={agentRepository ?? null}
                          board={undefined}
                          shownCode={shownCode}
                          codeFailed={undefined}
                          pages={tasks.agentView.pages}
                          agents={control}
                          openAgents={openAgents}
                          shownAgent={shown ? agentId : undefined}
                          views={views}
                          shown={tasks.shown}
                          focused={sideFocused}
                          onOpenTarget={openTarget}
                        />
                      ) : null}
                    </div>
                    {/* The second call's question, which a Call press here asks over another agent's call. */}
                    <ConfirmDialog
                      confirm={tasks.secondCall.confirm}
                      question={tasks.secondCall.question}
                    />
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
