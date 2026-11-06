import {
  AGENT_BOUNDS,
  type AgentPullRequest,
  type AgentSummary,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@repo/features/task-wire";
import {
  BUTTON_SIZE,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  type ListRowNest,
  RowHint,
  RowHintOptions,
  Tooltip,
  VisuallyHidden,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { isAgentTab, isChangesTab, isFileTab, pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useCallback, useRef } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { agentName, RENAME_FAILED } from "../tasks/agent-model.js";
import { agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import type { PullRequestMarked } from "../tasks/pull-request-mark.js";
import { pullRequestOfTab } from "../tasks/pull-request-number.js";
import { PlanGlyph, TAB_KIND, type TabSubject, tabLook } from "../tasks/tab-look.js";
import { useListedPullRequest } from "../tasks/use-agent-pull-request.js";
import type { HeldPeople } from "../tasks/use-agents.js";
import { isAgentPin, type SidebarPin } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuAction, type MenuEntry, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { tabCard } from "./tab-card.js";
import { PullRequestLine, RepositoryDetail } from "./task-card.js";

const UNPIN = commandHead(PANEL_COMMAND.UNPIN_TAB);

const GONE_NOTE = "No longer on this task";

export type PinnedOn = { readonly task: TaskSummary } | { readonly agent: TasklessAgent };

function pinTaskId(pin: SidebarPin): string | undefined {
  return "task" in pin ? pin.task : undefined;
}

function pinGone(pin: SidebarPin, tasks: TasksControl): boolean {
  if (pinTaskId(pin) !== tasks.activeTaskId) return false;
  const agentId = pinAgentId(pin);
  if (agentId === undefined) return false;
  const { agents } = tasks.agents;
  return agents !== undefined && !agents.some((agent) => agent.id === agentId);
}

function pinSubject(
  pin: SidebarPin,
  on: PinnedOn,
  agent: TaskAgentLine | undefined,
  pullRequest: PinnedPullRequest | undefined,
): TabSubject {
  if (isAgentPin(pin)) {
    return { kind: TAB_KIND.AGENT, name: pin.label, agent: agent ?? { model: pin.model } };
  }
  const { tab } = pin;
  if (isChangesTab(tab)) return { kind: TAB_KIND.CHANGES, pullRequest };
  if (isFileTab(tab)) return { kind: TAB_KIND.FILE, path: tab.file };
  const plan = "task" in on ? { name: on.task.name, status: on.task.status } : undefined;
  return { kind: TAB_KIND.PANEL, tab, plan };
}

type PinnedPullRequest = PullRequestMarked & Pick<AgentPullRequest, "title">;

function repositoryOfLine(line: TaskPullRequestLine): string | undefined {
  return line.url?.replace(/\/pull\/\d+.*$/u, "");
}

function openPullRequestOf(pin: SidebarPin, tasks: TasksControl): AgentPullRequest | undefined {
  const { tab } = pin;
  if (!isChangesTab(tab) || pinTaskId(pin) !== tasks.activeTaskId) return undefined;
  return pullRequestOfTab(tasks.agents, tab);
}

function pinPullRequest(
  pin: SidebarPin,
  on: PinnedOn,
  tasks: TasksControl,
): PinnedPullRequest | undefined {
  const { tab } = pin;
  if (!isChangesTab(tab)) return undefined;
  if ("agent" in on) {
    const { pullRequest } = on.agent;
    return tab.changes === on.agent.id && tab.number === undefined ? pullRequest : undefined;
  }
  const own = openPullRequestOf(pin, tasks);
  if (own !== undefined) return own;
  const lines = on.task.agents?.pullRequests ?? [];
  if (tab.number !== undefined) {
    const sameRepository = new Set(lines.map(repositoryOfLine)).size <= 1;
    return sameRepository ? lines.find((line) => line.number === tab.number) : undefined;
  }
  return lines.find((line) => line.agentId === tab.changes);
}

function namedPin<Pin extends SidebarPin>(
  pin: Pin,
  agent: TaskAgentLine | undefined,
  pullRequest: PinnedPullRequest | undefined,
  models: readonly CatalogModel[] | undefined,
): Pin {
  if (agent !== undefined) return { ...pin, label: agentName(agent, models) };
  return pullRequest === undefined ? pin : { ...pin, label: pullRequestLabelOf(pullRequest) };
}

function pinAgentId({ tab }: SidebarPin): string | undefined {
  if (isAgentTab(tab)) return tab.agent;
  return isChangesTab(tab) ? tab.changes : undefined;
}

function unpinItem(onUnpin: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.UNPIN_TAB, onUnpin, false);
}

function openAgentOf(pin: SidebarPin, tasks: TasksControl): AgentSummary | undefined {
  if (!isAgentPin(pin) || pin.task !== tasks.activeTaskId) return undefined;
  return tasks.agents.agents?.find((each) => each.id === pin.tab.agent);
}

function pinAgent(pin: SidebarPin, on: PinnedOn, tasks: TasksControl): TaskAgentLine | undefined {
  if (!isAgentPin(pin) || !("task" in on)) return undefined;
  const open = pin.task === tasks.activeTaskId ? tasks.agents.agents : undefined;
  return (open ?? on.task.agents?.agents)?.find((agent) => agent.id === pin.tab.agent);
}

function PinPullRequest({ agentId }: { agentId: string }): React.JSX.Element | null {
  const pullRequest = useListedPullRequest(agentId);
  return pullRequest === undefined ? null : (
    <>
      <HoverCardRule />
      <HoverCardList label="Pull request">
        <PullRequestLine pullRequest={pullRequest} />
      </HoverCardList>
    </>
  );
}

function pinChangesCard(
  pin: SidebarPin,
  tasks: TasksControl,
  gone: boolean,
  people: HeldPeople | undefined,
  onOpenAgent: (agentId: string) => void,
): React.JSX.Element | null {
  const { tab } = pin;
  const pullRequest = openPullRequestOf(pin, tasks);
  if (gone || !isChangesTab(tab) || pullRequest === undefined) return null;
  const { agents } = tasks;
  return tabCard({
    kind: TAB_KIND.CHANGES,
    subject: agentSubject(agents, tab.changes, NOTHING_HELD, false),
    models: agents.models,
    pullRequest,
    people: peopleOf(people, pullRequest),
    onOpenAgent: () => onOpenAgent(tab.changes),
  });
}

function pinnedOnLook(on: PinnedOn, models: readonly CatalogModel[] | undefined) {
  if ("task" in on) return { glyph: <PlanGlyph status={on.task.status} />, label: on.task.name };
  const label = agentName(on.agent, models);
  return { glyph: tabLook({ kind: TAB_KIND.AGENT, name: label, agent: on.agent }).icon, label };
}

function PinnedTabCard({
  pin,
  on,
  agent,
  pullRequest,
  gone,
  tasks,
  onOpenHolder,
}: {
  pin: SidebarPin;
  on: PinnedOn;
  agent: TaskAgentLine | undefined;
  pullRequest: PinnedPullRequest | undefined;
  gone: boolean;
  tasks: TasksControl;
  onOpenHolder: () => void;
}): React.JSX.Element {
  const agentId = pinAgentId(pin);
  const repository = "task" in on ? on.task.repository : on.agent.repository;
  const { openGitHub, pictures } = tasks.repositories;
  const holder = pinnedOnLook(on, tasks.agents.models);
  return (
    <HoverCard data-pinned-tab-card="">
      <HoverCardHead
        glyph={tabLook(pinSubject(pin, on, agent, pullRequest)).icon}
        name={pin.label}
      />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={holder.glyph}
        label={holder.label}
        onPress={onOpenHolder}
      />
      {repository === null ? null : (
        <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={openGitHub} />
      )}
      {gone ? <HoverCardNote>{GONE_NOTE}</HoverCardNote> : null}
      {agentId === undefined ? null : <PinPullRequest agentId={agentId} />}
    </HoverCard>
  );
}

interface PinnedRowDrawn {
  pin: SidebarPin;
  nest: ListRowNest | undefined;
  place: VirtualRowPlace | undefined;
  card: React.ReactNode;
  glyph: React.JSX.Element;
  gone: boolean;
  current: boolean;
  inSight: boolean;
  tasks: TasksControl;
  onOpen: () => void;
  onUnpin: () => void;
}

function PinnedTabRow({
  drawn,
  groups,
  editor,
  description,
  rowRef,
}: {
  drawn: PinnedRowDrawn;
  groups: readonly (readonly MenuEntry[])[];
  editor?: React.ReactNode;
  description?: React.ReactNode;
  rowRef?: ((press: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const { pin, nest, place, card, glyph, gone, current, inSight, tasks, onOpen, onUnpin } = drawn;
  const rowPlace = useRowPlace();
  const coarse = useCoarsePointer();
  const editing = editor !== undefined;
  return (
    <RowHintOptions card={card}>
      <ListRow
        ref={rowRef}
        nest={nest}
        place={place}
        density={LIST_DENSITY.DENSE}
        ink={LIST_ROW_INK.SIDEBAR}
        leading={
          <span className="sidebar-pinned-tab-glyph flex [&_.state-glyph]:[--state-glyph-size:var(--spacing-ui-16)] [&_svg]:size-ui-16">
            <ReplayMask>{glyph}</ReplayMask>
          </span>
        }
        title={
          editing ? (
            editor
          ) : gone ? (
            <span className="sidebar-pinned-tab-gone opacity-55">
              <ReplayMask>{pin.label}</ReplayMask>
              <VisuallyHidden>(unavailable)</VisuallyHidden>
            </span>
          ) : (
            <ReplayMask>{pin.label}</ReplayMask>
          )
        }
        description={description}
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        hint={editing ? undefined : { Hint: RowHint, label: pin.label }}
        onPress={
          editing
            ? undefined
            : () => {
                if (!gone) onOpen();
              }
        }
        menu={
          editing
            ? undefined
            : rowMenu("Pinned tab", withRowMoves(groups, rowPlace), tasks.shown && inSight, true)
        }
        more={!coarse}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        actions={
          editing || coarse ? null : (
            <Tooltip label={UNPIN.label}>
              <IconButton
                icon={UNPIN.icon}
                label={`${UNPIN.label} ${pin.label}`}
                size={BUTTON_SIZE.COMPACT}
                onClick={onUnpin}
              />
            </Tooltip>
          )
        }
      />
    </RowHintOptions>
  );
}

function PinnedAgentRow({
  agent,
  drawn,
}: {
  agent: AgentSummary;
  drawn: PinnedRowDrawn;
}): React.JSX.Element {
  const { pin, tasks, onUnpin } = drawn;
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
  }, []);
  const actions = useAgentActions(agent, tasks.agents, {
    label: pin.label,
    shown: tasks.shown,
    terminals: { onOpenTerminal: undefined },
  });
  const { rename } = actions;
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, row);
  const groups = [
    [unpinItem(onUnpin)],
    ...agentMenuGroups({ ...rowDoors(actions.doors), onCopy: actions.doors.onCopy }),
  ];
  return (
    <>
      <PinnedTabRow
        drawn={drawn}
        groups={groups}
        rowRef={hold}
        editor={
          editing && rename !== undefined ? (
            <InlineEdit
              value={rename.asked ?? pin.label}
              label="Agent name"
              maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
              editing
              onEnd={(edit) => {
                endedByKey(edit.byKey);
                rename.end(edit.value);
              }}
            />
          ) : undefined
        }
        description={rename?.refused === true ? <span>{RENAME_FAILED}</span> : undefined}
      />
      {actions.dialog}
    </>
  );
}

export function SidebarPinnedTab({
  tasks,
  pin: kept,
  on,
  nest,
  place,
  current,
  inSight,
  onOpen,
  onOpenHolder,
  onUnpin,
}: {
  tasks: TasksControl;
  pin: SidebarPin;
  current: boolean;
  on: PinnedOn;
  nest?: ListRowNest | undefined;
  place?: VirtualRowPlace | undefined;
  inSight: boolean;
  onOpen: () => void;
  onOpenHolder: () => void;
  onUnpin: () => void;
}): React.JSX.Element {
  const livePullRequest = pinPullRequest(kept, on, tasks);
  const agent = pinAgent(kept, on, tasks);
  const pin = namedPin(kept, agent, livePullRequest, tasks.agents.models);
  const gone = pinGone(pin, tasks);
  const taskId = pinTaskId(pin);
  const changesPeople = useChangesPeople(isChangesTab(pin.tab) ? pin.tab.changes : undefined);
  const changesCard = pinChangesCard(pin, tasks, gone, changesPeople, (agentId) => {
    if (taskId !== undefined) tasks.onShowAgent(taskId, agentId);
  });
  const copyLink = useCopyLinkItem();
  const drawn: PinnedRowDrawn = {
    pin,
    nest,
    place,
    card:
      changesCard !== null ? (
        changesCard
      ) : (
        <PinnedTabCard
          pin={pin}
          on={on}
          agent={agent}
          pullRequest={livePullRequest}
          gone={gone}
          tasks={tasks}
          onOpenHolder={onOpenHolder}
        />
      ),
    glyph: tabLook(pinSubject(pin, on, agent, livePullRequest)).icon,
    gone,
    current,
    inSight,
    tasks,
    onOpen,
    onUnpin,
  };
  const open = openAgentOf(pin, tasks);
  if (open !== undefined) return <PinnedAgentRow agent={open} drawn={drawn} />;
  const link = isAgentPin(pin) ? copyLink(agentPlace(pin.tab.agent)) : undefined;
  return (
    <PinnedTabRow
      drawn={drawn}
      groups={[[unpinItem(onUnpin)], ...(link === undefined ? [] : [[link]])]}
    />
  );
}
