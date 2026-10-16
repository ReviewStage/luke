import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { EllipsisIcon } from "@luke/ui";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useCallback, useMemo } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { AutomationDirectory } from "../automation-directory";
import { agentPlace, LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item";
import { FindScope } from "../find-in-tab";
import { usePageWorkspace } from "../links-at-hand";
import { MemberDirectory } from "../member-directory";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { agentTabLabel } from "../planning/coding-agent-model";
import { PlanMentions, type PlanMentionsValue, planlessMentions } from "../planning/plan-mentions";
import { SkillFiles } from "../planning/skill-chip";
import { TOOL_TARGET, type ToolTarget } from "../planning/tool-call-model";
import { useCodingAgents } from "../planning/use-coding-agents";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
import { ReadFailure } from "../read-failure";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { ActionMenu, useActionMenu } from "./action-menu";
import { AgentPane } from "./main-tabs";
import {
  COLUMN,
  changesTabOf,
  planCards,
  pullRequestTabOf,
  SIDE_PANEL_HOLDER,
  SidePanel,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel";
import { useTabViews } from "./strip-tabs";

/**
 * desktop-agent-page.tsx -- one agent's page: an agent an automation started with no plan, drawn in the plan's place as the task column draws an agent's tab.
 *
 * An agent an automation's run starts belongs to the workspace rather than
 * to a plan, so there is no plan's column for its tab to stand in. Its page
 * stands where the plan would, beside the sidebar, as the Inbox does, and
 * draws the task column's own agent pane (`main-tabs.tsx`'s `AgentPane`):
 * its transcript, its composer, its model and servers, and what it
 * published, at the document's reading width, each through the same
 * control a plan's agents are driven by, here holding the one agent read by
 * its id (`use-coding-agents.ts`'s `agentId`). ⌘F finds in it as in a
 * plan's column. An `@` in its box offers its repository's files, its
 * skills, and the servers, read through its workspace since no plan names
 * them (`planlessMentions`); a skill a message names is its chip, which
 * opens the skill's `SKILL.md` on GitHub, as a file it names does, since no
 * File tab reads a repository no plan names; and a dictation listens for its repository and
 * its title. A row of its inbox calls opens the window's Inbox, since the
 * agent's items stand there and no plan's Inbox tab does. Beside it stands
 * the window's side panel, held by the agent while its page stands
 * (`use-plans-tab.ts`): a delegation's row opens its worker there, and its
 * Changes chip its pull request's changes, as on a task, and its toggle,
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

/** Nothing to do, for the doors a plan's column opens and this page does not have. */
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
  const menu = useActionMenu(shown);
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  if (copyLink === undefined) return null;
  return (
    <>
      <Tooltip label={ACTIONS_LABEL}>
        <button
          type="button"
          className="icon-button"
          aria-label={ACTIONS_LABEL}
          {...menu.trigger()}
        >
          <EllipsisIcon />
        </button>
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
  value: PlanMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <PlanMentions value={value}>{children}</PlanMentions>;
}

/** One agent's page, in the plan's place: the agent read by its id, drawn as the task column's agent pane. */
export function DesktopAgentPage({
  plans,
  agentId,
}: {
  plans: PlansControl;
  agentId: string;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AGENT_PAGE, plans.agentView.onClose);
  const { act, tell } = useAct();
  const views = useTabViews();
  const { sidePanel } = plans;
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
    planId: undefined,
    agentId,
    repository: null,
    archived: false,
    onUnarchive: nothing,
    onOpenIntegrations: plans.agents.onOpenIntegrations,
    onOpenApiKeys: plans.agents.onOpenApiKeys,
    onStarted: nothing,
    me: plans.me,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  // Note that the models come from the open plan's agents where this page has not read them, so
  // the agent is named alike in both; and that an archived agent, which takes no message, is
  // brought back by its own Unarchive, there being no plan to bring back with it.
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
  const listed = plans.workspaces.find((each) => each.id === workspaceId);
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
    models: agents.models ?? plans.agents.models,
    keywords,
    onUnarchive: agent?.archivedAt === undefined ? undefined : unarchive,
  };
  const tab = { agent: agentId };
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const { onOpen: onOpenAutomations } = plans.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  // Note that an inbox call is the one row of a coding agent's own that opens a tab, a worker's opening through its delegation.
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.INBOX) plans.inboxView.onOpen();
  };
  // A delegation's row opens its worker in the side panel, and the Changes chip the pull request's changes, as on a task.
  const openDelegation = (
    agent: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
  };
  const openChanges = (changed: string) =>
    sidePanel.onChoose(changesTabOf(control, changed, sidePanel.changes));
  const openPullRequest = (published: string) =>
    sidePanel.onChoose(pullRequestTabOf(control, published, sidePanel.pullRequests));
  const shown = plans.shown && !sidePanel.fullScreen;
  const cards = planCards({
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
    tell(ACT_KIND.GITHUB_OPEN, { url });
  };
  // What an `@` offers once the read named the agent's workspace and repository, which its files are read through.
  const mentions =
    workspaceId === undefined || agentRepository === undefined
      ? undefined
      : planlessMentions(
          { workspace: listed?.slug ?? workspaceId, workspaceId, repository: agentRepository },
          plans.onShowMention,
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
          <AgentPageActions agent={agent} shown={plans.shown} />
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
          <div className="agent-page-note">
            <ReadFailure line={NOT_READ} onRetry={agents.onRetryList} />
          </div>
        ) : (
          <Spinner label="Loading agent" size={SPINNER_SIZE.INLINE} />
        )}
      </section>
    );
  }
  return (
    <LinkWorkspaceProvider value={listed?.slug ?? workspaceId}>
      <MemberDirectory workspace={workspace} readerId={plans.me}>
        <AutomationDirectory
          workspace={listed}
          on={automationsOn}
          wanted={agent.automationId !== undefined}
          onOpen={openAutomation}
        >
          <SkillFiles source={control.readSkills} onOpen={openSkill}>
            <AgentMentions value={mentions}>
              <div ref={onArea} className="desktop-plan" data-panel-open={String(sidePanel.open)}>
                {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
                <section className="agent-page" aria-label="Agent" hidden={sidePanel.fullScreen}>
                  {toolbar}
                  <FindScope
                    className="desktop-plan-column"
                    active={plans.shown && !sideFocused}
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
                      onOpenChanges={openChanges}
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
                    planId={agentId}
                    repository={agentRepository ?? null}
                    board={undefined}
                    shownCode={undefined}
                    pages={undefined}
                    transcript={NO_CALLS}
                    work={work}
                    agents={control}
                    openAgents={openAgents}
                    shownAgent={shown ? agentId : undefined}
                    views={views}
                    shown={plans.shown}
                    focused={sideFocused}
                    onOpenTarget={openTarget}
                    cards={cards}
                  />
                ) : null}
              </div>
            </AgentMentions>
          </SkillFiles>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}
