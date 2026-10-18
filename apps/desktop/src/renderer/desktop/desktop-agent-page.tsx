import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { useAct } from "@luke/panel/act";
import { appPlatform } from "@luke/panel/app-platform";
import { WordsWorkspace } from "@luke/panel/tasks/use-link-standing";
import { OpenHereProvider, openPullRequestsHere } from "@luke/panel/tasks/use-open-link";
import { useExperiment } from "@luke/panel/use-app-state";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { EllipsisIcon, ERROR_STATE_PLACEMENT, ErrorState, IconButton, useMenu } from "@luke/ui";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppCommand } from "../app-commands";
import { AutomationDirectory } from "../automation-directory";
import { agentPlace, LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item";
import { FindScope } from "../find-in-tab";
import { usePageWorkspace } from "../links-at-hand";
import { MemberDirectory } from "../member-directory";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { SpinnerRegion } from "../spinner";
import { agentTabLabel } from "../tasks/coding-agent-model";
import { SkillFiles } from "../tasks/skill-chip";
import {
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model";
import { useCodingAgents } from "../tasks/use-coding-agents";
import { PULL_REQUEST_VIEW } from "../tasks/use-side-panel";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { ActionMenu } from "./action-menu";
import { AgentPane } from "./main-tabs";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel";
import { useTabViews } from "./strip-tabs";

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
 * its tab would, and its ⋯ offers its Copy link. An archived agent takes no message, so its composer gives
 * way to its own Unarchive. An agent the service will not hand the reader,
 * deleted or of a workspace they are not in, as a link may name, is not
 * found, and nothing of it is drawn. Whoever sent it a message is read against its
 * workspace's members, as on a plan, and the automation whose run started
 * it against its workspace's automations, so the prompt it opens on names
 * the automation and opens its page. Escape leaves it for wherever it was
 * opened from, and so does any row of the sidebar.
 */

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** Nothing to do, for the doors a task's column opens and this page does not have. */
const nothing = (): void => undefined;

/** No tab arrived anything: arrivals are a plan's. */
const NO_UNREAD: readonly StripTab[] = [];

/** What the panel says of calls on an agent's page: none, there being no plan to call about. */
const NO_CALLS = {
  region: { kind: TRANSCRIPT_REGION.EMPTY },
  onRetry: nothing,
} as const;

/** What the page's ⋯ is called. */
const ACTIONS_LABEL = "Agent actions";

/** The page's ⋯, offering the agent's Copy link. */
function AgentPageActions({
  agent,
  shown,
}: {
  agent: { readonly id: string; readonly planId: string | null };
  shown: boolean;
}): React.JSX.Element | null {
  const menu = useMenu(shown);
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  if (copyLink === undefined) return null;
  return (
    <>
      <Tooltip label={ACTIONS_LABEL}>
        <IconButton icon={<EllipsisIcon />} label={ACTIONS_LABEL} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ACTIONS_LABEL}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
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
}: {
  tasks: TasksControl;
  agentId: string;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AGENT_PAGE, tasks.agentView.onClose);
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
    onStarted: nothing,
    me: tasks.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  useTaskAgentsFollow(tasks, agentId, agent);
  // Note that the models come from the open task's agents where this page has not read them, so
  // the agent is named alike in both; and that an archived agent, which takes no message, is
  // brought back by its own Unarchive, there being no task to bring back with it.
  const { onArchive } = agents;
  const toast = useToast();
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
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  // Note that an inbox call is the one row of a coding agent's own that opens a tab, a worker's opening through its delegation.
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) tasks.inboxView.onOpen();
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
  const openPullRequest = (published: string) =>
    showPullRequest(sidePanel, control, published, PULL_REQUEST_VIEW.CONVERSATION);
  // A link in the agent's words to the pull request it opened opens that same tab rather than GitHub, as on a task.
  const openHere = openPullRequestsHere(control, openPullRequest);
  const shown = tasks.shown && !sidePanel.fullScreen;
  const cards = taskCards({
    agents: control,
    workRows: [],
    held: views.held,
    chosen: (opened) =>
      sameTab(opened, tab) || (sidePanel.tab !== undefined && sameTab(opened, sidePanel.tab)),
    shownCode: [],
  });
  // An agent's workers are its delegations, read through its own transcript, so the panel's plan's work is none.
  const work = {
    conversation: undefined,
    callLive: false,
    onLoadEarlier: () => Promise.resolve(),
    readWorker: control.readTranscript,
  };
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
      <div className="desktop-toolbar-heading">
        {agent === undefined ? null : (
          <h1 className="desktop-toolbar-title">{agentTabLabel(agent, control.models)}</h1>
        )}
      </div>
      {agent === undefined ? null : (
        <div className="desktop-toolbar-actions">
          <AgentPageActions agent={agent} shown={tasks.shown} />
        </div>
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
            on={automationsOn}
            wanted={agent.automationId !== undefined}
            onOpen={openAutomation}
          >
            <SkillFiles source={control.readSkills} onOpen={openSkill}>
              <AgentMentions value={mentions}>
                <OpenHereProvider value={openHere}>
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
                        <AgentPane
                          label={agentTabLabel(agent, control.models)}
                          tabbed={false}
                          tab={tab}
                          agents={control}
                          shown={shown}
                          views={views}
                          onOpenDelegation={openDelegation}
                          onOpenPullRequest={openPullRequest}
                          onOpenTarget={openTarget}
                          cards={cards}
                        />
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
                        shownCode={undefined}
                        codeFailed={undefined}
                        pages={undefined}
                        transcript={NO_CALLS}
                        work={work}
                        agents={control}
                        openAgents={openAgents}
                        shownAgent={shown ? agentId : undefined}
                        views={views}
                        shown={tasks.shown}
                        focused={sideFocused}
                        onOpenTarget={openTarget}
                        cards={cards}
                      />
                    ) : null}
                  </div>
                </OpenHereProvider>
              </AgentMentions>
            </SkillFiles>
          </AutomationDirectory>
        </MemberDirectory>
      </WordsWorkspace>
    </LinkWorkspaceProvider>
  );
}
