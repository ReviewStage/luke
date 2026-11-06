import {
  AGENT_BOUNDS,
  AGENT_SOURCE,
  type AgentStatus,
  type AgentSummary,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import { dictationKeywords } from "@repo/features/dictation-keywords";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import type { MentionLines } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
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
  ProviderMark,
  SidePanelIcon,
  STATUS_TONE,
  Toolbar,
  type ToolbarPlace,
  useMenu,
} from "@repo/ui";
import { pullRequestAgentOf, repositoryPullRequestOf } from "@repo/ui/pull-request-link";
import { type StripTab, sameTab } from "@repo/ui/tab-strip-model";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FindScope } from "../find-in-tab.js";
import { usePageWorkspace } from "../links-at-hand.js";
import { agentOriginQuery } from "../live-reads.js";
import { MemberDirectory } from "../member-directory.js";
import { HERE } from "../route.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { agentName } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { useChangesPeople } from "../tasks/changes-people.js";
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
  OpenAddressesHere,
  OpenLinkProvider,
  openPullRequestsHere,
  useOpenPlace,
  useReadLinkOpener,
} from "../tasks/use-open-link.js";
import { type PinHolder, PULL_REQUEST_VIEW } from "../tasks/use-side-panel.js";
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
import { PhoneBack, PhoneHead, phoneBar, phoneFindGroups } from "./phone-head.js";
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

const NOT_READ = "This agent could not be read.";

const nothing = (): void => undefined;

const NO_UNREAD: readonly StripTab[] = [];

const ACTIONS_THING = "Agent";

const NAME_LABEL = "Agent name";

const SLACK_PLACE = "Slack";

function slackTrail(agent: Pick<AgentSummary, "source">): readonly ToolbarPlace[] | undefined {
  const { source } = agent;
  if (source?.kind !== AGENT_SOURCE.SLACK || source.url === undefined) return undefined;
  const { url } = source;
  return [
    {
      label: SLACK_PLACE,
      icon: <ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />,
      onPress: () => appPlatform().openWeb(url),
    },
  ];
}

function listedAgent(tasks: TasksControl, agent: AgentSummary): TasklessAgent | undefined {
  if (agent.planId !== null) return undefined;
  const { standing, archived } = tasks.listedAgents;
  return [...standing, ...archived].find((each) => each.id === agent.id);
}

function pagePinOn(tasks: TasksControl, agent: AgentSummary | undefined): PinHolder | undefined {
  if (agent === undefined || agent.archivedAt !== undefined) return undefined;
  if (agent.planId !== null) return { task: agent.planId };
  const standing = tasks.listedAgents.standing.some((each) => each.id === agent.id);
  return standing ? { agent: agent.id } : undefined;
}

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
  trail: readonly ToolbarPlace[] | undefined;
  steps: React.ReactNode;
  terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenLocal">;
  onClose: () => void;
  phone?: AgentPagePhone | undefined;
}): React.JSX.Element {
  const label = agentName(agent, agents.models);
  const actions = useAgentActions(agent, agents, { label, shown, terminals, onDeleted: onClose });
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
  const read =
    listed === undefined
      ? undefined
      : {
          unread: reads.markedUnread(agent.id),
          onMark: (next: boolean) => reads.mark(listed, next),
        };
  const own = listed !== undefined && agent.archivedAt === undefined;
  const agentPin = own
    ? {
        pinned: listed.pinnedAt !== undefined,
        onToggle: () => tasks.onPinAgent(agent.id, listed.pinnedAt === undefined),
      }
    : undefined;
  const section = own
    ? moveToSectionEntry(tasks, { agent: true, id: agent.id }, listed.workspaceId, sectionDialogs)
    : undefined;
  const groups = agentMenuGroups({
    chosen: true,
    ...actions.doors,
    onOpenInSlack: undefined,
    read,
    agentPin,
    section,
  });
  const { rename } = actions;
  const title =
    rename?.editing === true ? (
      <OneLine as={ONE_LINE_ELEMENT.H1} end={ONE_LINE_END.ELLIPSIS} className="ui-toolbar-title">
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
  const drawnMenu =
    menu.drawn === undefined ? null : (
      <ActionMenu
        label={moreLabel(ACTIONS_THING)}
        menu={menu.drawn}
        groups={
          phone === undefined
            ? groups
            : [
                ...phoneFindGroups(),
                ...groups,
                ...(phone.onShowPanel === undefined
                  ? []
                  : [
                      [
                        {
                          label: SHOW_PANEL,
                          icon: <SidePanelIcon />,
                          onSelect: phone.onShowPanel,
                        },
                      ],
                    ]),
              ]
        }
        onClose={menu.close}
      />
    );
  const dialogs = (
    <>
      {drawnMenu}
      {actions.dialog}
      {sectionDialogs.dialog}
    </>
  );
  if (phone !== undefined) {
    return (
      <PhoneHead
        place="agent"
        start={<PhoneBack back={phone.back} />}
        title={title}
        end={
          <>
            <MoreButton thing={ACTIONS_THING} {...menu.trigger()} />
            {dialogs}
          </>
        }
      />
    );
  }
  return (
    <>
      <Toolbar
        title={title}
        trail={trail}
        titleMenu={{ contextMenu: menu.contextMenu(), keyMenu: menu.keyMenu }}
        actions={steps}
      />
      {dialogs}
    </>
  );
}

const AGENT = "Agent";

const SHOW_PANEL = "Show panel";

export interface AgentPagePhone {
  readonly back: TaskHeadBack;
  readonly onShowPanel: (() => void) | undefined;
}

function AgentMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
}

export function DesktopAgentPage({
  tasks,
  agentId,
  away,
}: {
  tasks: TasksControl;
  agentId: string;
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  const [drafting, setDrafting] = useState<{ agentId: string; draftId: string } | undefined>(
    undefined,
  );
  const draftShown = drafting?.agentId === agentId ? drafting.draftId : undefined;
  useAppCommand(
    APP_COMMAND.EXIT_AGENT_PAGE,
    draftShown === undefined ? tasks.agentView.onClose : () => setDrafting(undefined),
  );
  const views = useTabViews();
  const { sidePanel } = tasks;
  const drawing = useSidePanelDrawing(sidePanel);
  const { onArea, focus, setFocus } = useColumnFocus();
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  const openAgents = useMemo(() => [agentId], [agentId]);
  useAppCommand(APP_COMMAND.NEW_TAB, () => {
    setFocus(COLUMN.SIDE);
    sidePanel.onNewTab();
  });
  const { liveAgents } = tasks;
  const listedPage = useMemo(
    () => liveAgents?.find((each) => each.id === agentId),
    [liveAgents, agentId],
  );
  const agents = useAgents({
    taskId: undefined,
    agentId,
    repository: null,
    listedAgents: liveAgents,
    listedPage,
    list: { read: tasks.listRead, failed: tasks.listFailed, onRetry: tasks.onRetryList },
    listedPullRequests: tasks.listedPullRequests,
    modeOf: (planId) => tasks.tasks.find((each) => each.id === planId)?.mode,
    onOpenIntegrations: tasks.agents.onOpenIntegrations,
    onOpenApiKeys: tasks.agents.onOpenApiKeys,
    onStarted: tasks.agentView.onOpen,
    me: tasks.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  const run = useQuery(agentOriginQuery(agent?.automationName === undefined ? undefined : agentId));
  const { onArchive } = agents;
  const toast = useToast();
  const openLink = useReadLinkOpener();
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
  const { workspaceId, agentRepository } = agents;
  usePageWorkspace(agentId, workspaceId);
  const terminalDoors = useAgentTerminalDoors(sidePanel, () => setFocus(COLUMN.SIDE));
  const readMentionAgents = useMentionAgentsReader(workspaceId, tasks.tasks, agents.models);
  const listed = tasks.workspaces.find((each) => each.id === workspaceId);
  const workspace = workspaceId === undefined ? undefined : (listed ?? { id: workspaceId });
  const keywords = useMemo(
    () =>
      dictationKeywords({
        repository: agentRepository ?? null,
        title: agent?.title ?? undefined,
        body: undefined,
      }),
    [agentRepository, agent?.title],
  );
  const control = useSteadyDoors({
    ...agents,
    agents: agent === undefined ? agents.agents : [agent],
    agentIds: agent === undefined ? agents.agentIds : [agent.id],
    models: agents.models ?? tasks.agents.models,
    keywords,
    origin: run.data ?? undefined,
    onUnarchive: agent?.archivedAt === undefined ? undefined : unarchive,
  });
  const tab = useMemo(() => ({ agent: agentId }), [agentId]);
  const draftDoors = useAgentDraftDoors(agents, agent?.archivedAt !== undefined, (draftId) =>
    setDrafting({ agentId, draftId }),
  );
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
  const openPlace = useOpenPlace();
  const openTarget = useSteadyDoor((target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) {
      const { item } = target;
      openPlace?.(
        item === undefined
          ? planId === null
            ? { kind: LINK_PLACE.INBOX }
            : { kind: LINK_PLACE.INBOX, planId }
          : planId === null
            ? { kind: LINK_PLACE.INBOX_ITEM, agentId, itemId: item }
            : { kind: LINK_PLACE.INBOX_ITEM, planId, itemId: item },
      );
    }
    if (target.kind === TOOL_TARGET.TASK) openPlace?.(placeOfTaskTarget(target));
    if (target.kind === TOOL_TARGET.DESCRIPTION && planId !== null) {
      openPlace?.({ kind: LINK_PLACE.TASK, planId });
    }
    if (target.kind === TOOL_TARGET.AGENT) tasks.agentView.onOpen(target.agent);
    if (target.kind === TOOL_TARGET.PAGE) sidePanel.onChoose({ page: target.page });
  });
  const openDelegation = useSteadyDoor(
    (agent: string, callId: string, task: string, status: AgentStatus) => {
      views.onWorkerStatus(callId, status);
      sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
    },
  );
  const openPullRequest = useSteadyDoor((published: string, number?: number) =>
    showPullRequest(sidePanel, control, published, PULL_REQUEST_VIEW.CONVERSATION, number),
  );
  const openPageBeside = useSteadyDoor((page: string, place: PagePlace) =>
    sidePanel.onPreview({ page }, place),
  );
  const { pullRequests, agentIds, heldIds } = control;
  const openHere = useMemo(
    () =>
      openPullRequestsHere(
        { kind: HERE.AGENT, agentId, repository: agentRepository, pullRequests, agentIds, heldIds },
        openPullRequest,
        openPageBeside,
      ),
    [agentId, pullRequests, agentIds, heldIds, openPullRequest, openPageBeside, agentRepository],
  );
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
  const runPlace = useAutomationRunPlace(agent);
  const sideTab = sidePanel.tab;
  const planId = agent?.planId ?? null;
  const planTask = planId === null ? undefined : tasks.tasks.find((each) => each.id === planId);
  const cards = useMemo(
    () =>
      taskCards({
        agents: control,
        held: views.held,
        chosen: (opened) =>
          sameTab(opened, tab) || (sideTab !== undefined && sameTab(opened, sideTab)),
        pages: planId === null ? { agentId } : { taskId: planId },
        task:
          planTask === undefined
            ? undefined
            : {
                name: planTask.name,
                status: planTask.status,
                card: taskCardOf(tasks, planTask, undefined),
              },
      }),
    [control, views.held, tab, sideTab, planId, agentId, planTask, tasks],
  );
  const repositoryPlace = useMemo(
    () =>
      workspaceId === undefined || agentRepository === undefined
        ? undefined
        : { workspaceId, repository: agentRepository },
    [workspaceId, agentRepository],
  );
  const fileReads = useMemo(
    () =>
      repositoryPlace === undefined
        ? undefined
        : { place: repositoryPlace, repository: repositoryPlace.repository },
    [repositoryPlace],
  );
  const openMentionedFile = useSteadyDoor((path: string, lines: MentionLines | undefined) =>
    lines === undefined
      ? sidePanel.onPreviewFile({ path }, undefined, fileReads)
      : sidePanel.onPreviewFile(
          { path, startLine: lines.startLine, endLine: lines.endLine },
          lines.commit,
          fileReads,
        ),
  );
  const openSkill = (skill: { readonly path: string }) => {
    if (fileReads === undefined) return;
    sidePanel.onPreviewFile({ path: skill.path }, undefined, fileReads);
  };
  const changesPeople = useChangesPeople(agentId);
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
      people: peopleOf(changesPeople, pullRequest),
      onOpenAgent: () => setDrafting(undefined),
    });
    return card ?? undefined;
  });
  const mentionWorkspace = listed?.slug ?? workspaceId;
  const { onShowMention } = tasks;
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
        trail={automationTrail(agent, tasks) ?? slackTrail(agent)}
        steps={
          runPlace === undefined ? null : (
            <AutomationRunSteps place={runPlace} onOpenAgent={tasks.agentView.onOpen} />
          )
        }
      />
    );
  if (agent === undefined) {
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
    return (
      <div className="desktop-task relative flex min-h-0 flex-1" data-panel-open="false">
        <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label="Agent">
          {toolbar}
          {agents.listFailed ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.AGENTS_READ)}
              onRetry={agents.onRetryList}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
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
  return (
    <LinkWorkspaceProvider value={listed?.slug ?? workspaceId}>
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
                  <OpenAddressesHere value={openHere}>
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
                      {drawing.panel !== undefined || sidePanel.toggleAsked ? (
                        <SidePanel
                          {...drawing}
                          panel={drawing.panel ?? sidePanel}
                          unread={NO_UNREAD}
                          holder={SIDE_PANEL_HOLDER.AGENT}
                          taskId={agentId}
                          pinOn={pagePinOn(tasks, agent)}
                          repository={agentRepository ?? null}
                          repositoryPlace={repositoryPlace}
                          pages={tasks.agentView.pages}
                          agents={control}
                          openAgents={openAgents}
                          shownAgent={shown ? agentId : undefined}
                          views={views}
                          shown={tasks.shown}
                          focused={sideFocused}
                          onOpenTarget={openTarget}
                          taskOfTab={tasks}
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
                  </OpenAddressesHere>
                </OpenLinkProvider>
              </AgentMentions>
            </SkillFiles>
          </AutomationDirectory>
        </MemberDirectory>
      </WordsWorkspace>
    </LinkWorkspaceProvider>
  );
}
