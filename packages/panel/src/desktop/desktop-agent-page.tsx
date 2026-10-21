import {
  CODING_AGENT_BOUNDS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ConfirmDialog,
  EllipsisIcon,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  InlineEdit,
  useMenu,
} from "@luke/ui";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FADING_ELEMENT, FadingWords } from "../fading-words.js";
import { FindScope } from "../find-in-tab.js";
import { usePageWorkspace } from "../links-at-hand.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { SpinnerRegion } from "../spinner.js";
import { CallNotice } from "../tasks/agent-call.js";
import { agentTabLabel } from "../tasks/coding-agent-model.js";
import { SkillFiles } from "../tasks/skill-chip.js";
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
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu } from "./action-menu.js";
import {
  type AgentTerminalDoors,
  useAgentActions,
  useAgentCallDoors,
  useAgentDraftDoors,
  useAgentTerminalDoors,
} from "./agent-actions.js";
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
 * them (`tasklessMentions`); a skill a message names is its chip, which
 * opens the skill's `SKILL.md` on GitHub, as a file it names does, since no
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
const ACTIONS_LABEL = "Agent actions";

/** What the title's field is called for a reader, as an agent's tab calls its own. */
const NAME_LABEL = "Agent name";

/**
 * The page's title and its ⋯, which offer the agent's own actions as its
 * tab in a task's column does (`agent-actions.tsx`): its title turned into
 * its name's field by Rename, and every action of the tab's ⋯, in the same
 * groups (`strip-tabs.tsx`'s `contentActionGroups`).
 */
function AgentPageHeading({
  agent,
  agents,
  shown,
  terminals,
  onClose,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  shown: boolean;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal">;
  /** Leaves the page, as Escape does, once the agent is deleted. */
  onClose: () => void;
}): React.JSX.Element {
  const label = agentTabLabel(agent, agents.models);
  const actions = useAgentActions(agent, agents, { label, shown, terminals, onDeleted: onClose });
  const menu = useMenu(shown);
  const groups = contentActionGroups({
    chosen: true,
    onClose: undefined,
    onCloseOthers: undefined,
    pin: undefined,
    ...actions.doors,
  });
  const { rename } = actions;
  return (
    <>
      <div className="desktop-toolbar-heading">
        {rename?.editing === true ? (
          <h1 className="desktop-toolbar-title">
            <InlineEdit
              value={label}
              label={NAME_LABEL}
              maxLength={CODING_AGENT_BOUNDS.MAX_TITLE_CHARS}
              editing
              onEnd={(edit) => {
                rename.end(edit.value);
              }}
            />
          </h1>
        ) : (
          <FadingWords as={FADING_ELEMENT.H1} className="desktop-toolbar-title" words={label} />
        )}
      </div>
      <div className="desktop-toolbar-actions">
        <Tooltip label={ACTIONS_LABEL}>
          <IconButton icon={<EllipsisIcon />} label={ACTIONS_LABEL} {...menu.trigger()} />
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu
            label={ACTIONS_LABEL}
            menu={menu.drawn}
            groups={groups}
            onClose={menu.close}
          />
        )}
        {actions.dialog}
      </div>
    </>
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
  notice,
}: {
  tasks: TasksControl;
  agentId: string;
  /** The voice's notice line, while it rides the foot of the page's agent's call. */
  notice?: React.ReactNode;
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
    archived: false,
    onUnarchive: nothing,
    onOpenIntegrations: tasks.agents.onOpenIntegrations,
    onOpenApiKeys: tasks.agents.onOpenApiKeys,
    // An agent a Continue or a Fork started opens on its own page, as a Start's tab opens on a task.
    onStarted: tasks.agentView.onOpen,
    me: tasks.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
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
  const unarchive = () => {
    onArchive(agentId, false).then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({ words: result.reason, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      }
    }, nothing);
  };
  // The agent's workspace as the account lists it, whose count reads its members again; by its id alone where the list does not hold it yet.
  const { workspaceId, agentRepository } = agents;
  usePageWorkspace(agentId, workspaceId);
  // Open terminal, ⌘J, and New terminal open the agent's terminals in the side panel, as its tab's do on a task.
  const terminalDoors = useAgentTerminalDoors(sidePanel, agentRepository, () =>
    setFocus(COLUMN.SIDE),
  );
  // The workspace's agents an `@` offers, named by the tasks the window lists.
  const mentionTasks = useMemo(
    () => [...tasks.tasks, ...tasks.archived],
    [tasks.tasks, tasks.archived],
  );
  const readMentionAgents = useMentionAgentsReader(workspaceId, mentionTasks, agents.models);
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
  const control = {
    ...agents,
    agents: agent === undefined ? agents.agents : [agent],
    agentIds: agent === undefined ? agents.agentIds : [agent.id],
    models: agents.models ?? tasks.agents.models,
    keywords,
    onUnarchive: agent?.archivedAt === undefined ? undefined : unarchive,
  };
  const tab = { agent: agentId };
  // A Fork or a Continue opens the page's draft in the agent's place, through the same doors a task's column opens its own by.
  const draftDoors = useAgentDraftDoors(agents, agent?.archivedAt !== undefined, (draftId) =>
    setDrafting({ agentId, draftId }),
  );
  // The draft stands in the pane while it is the one the page opened, and the agent again once it starts or is let go.
  const paneTab =
    draftShown !== undefined && agents.draft?.id === draftShown ? { draft: draftShown } : tab;
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  // Note that an inbox call and a page are the rows of a coding agent's own that open a tab, and a task's archive the one
  // that opens another task, as the sidebar opens it, a worker's opening through its delegation.
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) tasks.inboxView.onOpen();
    if (target.kind === TOOL_TARGET.TASK) tasks.onShowTask(target.task);
    // An agent's chip, such as one it was continued or forked to, opens that agent's own page.
    if (target.kind === TOOL_TARGET.AGENT) tasks.agentView.onOpen(target.agent);
    // Code Luke showed on its call opens in the Code tab, its showings' one place on a page no task's File tab reads for.
    if (target.kind === TOOL_TARGET.SHOWN_CODE && shownCode !== undefined)
      sidePanel.onChoose(SIDE_PANEL_TAB.CODE);
    // A page the agent showed on itself opens in the panel beside it, as a task's opens beside its plan.
    if (target.kind === TOOL_TARGET.PAGE) sidePanel.onChoose({ page: target.page });
  };
  // A delegation's row opens its worker in the side panel, and the pull request's chip the pull request, as on a task.
  const openDelegation = (
    agent: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
  };
  const openPullRequest = (published: string, number?: number) =>
    showPullRequest(sidePanel, control, published, PULL_REQUEST_VIEW.CONVERSATION, number);
  // A link in the agent's words to the pull request it opened opens that same tab rather than GitHub, as on a task,
  // and one to any other pull request of its repository a Pull request tab by its number.
  const openHere = openPullRequestsHere(control, openPullRequest, agentRepository);
  // A link to the page's own agent, as a fork's chip opens its source, leaves the page's draft for the agent.
  const openLinkHere =
    openLink === undefined
      ? undefined
      : (link: ReadLink) => {
          const { place } = link;
          const own =
            (place.kind === LINK_PLACE.AGENT || place.kind === LINK_PLACE.MESSAGE) &&
            place.agentId === agentId;
          if (own) setDrafting(undefined);
          openLink(link);
        };
  const shown = tasks.shown && !sidePanel.fullScreen;
  const cards = taskCards({
    agents: control,
    held: views.held,
    chosen: (opened) =>
      sameTab(opened, tab) || (sidePanel.tab !== undefined && sameTab(opened, sidePanel.tab)),
    shownCode: shownCode ?? [],
  });
  // A skill's file opens where a file the agent names does: its page on GitHub.
  const openSkill = (skill: { readonly path: string }) => {
    if (agentRepository === undefined) return;
    const place = { workspace: listed?.slug ?? workspaceId ?? "", repository: agentRepository };
    const url = encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, place);
    appPlatform().openGitHub(url);
  };
  // What an `@` offers once the read named the agent's workspace and repository, which its files are read through.
  const mentions =
    workspaceId === undefined || agentRepository === undefined
      ? undefined
      : tasklessMentions(
          { workspace: listed?.slug ?? workspaceId, workspaceId, repository: agentRepository },
          tasks.onShowMention,
          readMentionAgents,
        );
  const toolbar = (
    <header className="desktop-toolbar">
      {agent === undefined ? (
        <div className="desktop-toolbar-heading" />
      ) : (
        <AgentPageHeading
          agent={agent}
          agents={control}
          shown={tasks.shown}
          terminals={terminalDoors}
          onClose={tasks.agentView.onClose}
        />
      )}
    </header>
  );
  if (agent === undefined) {
    return (
      <section className="agent-page" aria-label="Agent">
        {toolbar}
        {agents.listMissing ? (
          <NotFound thing={NOT_FOUND_THING.AGENT} />
        ) : agents.listFailed ? (
          <ErrorState onRetry={agents.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {NOT_READ}
          </ErrorState>
        ) : (
          <SpinnerRegion label="Loading agent" />
        )}
      </section>
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
                      <section
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
                          <CallNotice.Provider value={notice}>
                            <AgentPane
                              call={calls}
                              label={agentTabLabel(agent, control.models)}
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
                          </CallNotice.Provider>
                        </FindScope>
                      </section>
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
