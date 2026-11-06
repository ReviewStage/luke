import { AGENT_BOUNDS, AGENT_SOURCE, type TasklessAgent } from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { automationRun } from "@repo/features/model-label";
import {
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  type ListRowNest,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  RowHint,
  RowHintOptions,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, teammateCreator } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { agentRow, taskRowName } from "@repo/ui/task-list-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useDraftedAgents } from "../composer-drafts.js";
import { leftMark } from "../draft-mark.js";
import { useMemberDirectory } from "../member-directory.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import { AgentCard, tasklessRowSubject } from "../tasks/agent-ref.js";
import { useFailedAgents } from "../tasks/failed-lines.js";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { type AgentsControl, readAgentById } from "../tasks/use-agents.js";
import { agentReadsUnread } from "../tasks/use-task-looks.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuEntry, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { useAgentReadMarks } from "./agent-read-marks.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { type RowMark, RowMarks, useFocusedRowKeys } from "./task-actions.js";
import { SIDEBAR_ROW_REPOSITORY, SIDEBAR_ROW_TIME } from "./task-card.js";

const FROM_SLACK = "(from Slack)";

function starterOf(
  agent: TasklessAgent,
  face: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
): Actor | undefined {
  const name = automationRun(agent)?.name;
  if (name !== undefined) return { kind: ACTOR_KIND.AUTOMATION, name, state: ACTOR_STATE.REST };
  if (!face) return undefined;
  return teammateCreator({ createdBy: agent.startedBy, ownerId: agent.startedBy?.userId }, reader);
}

function SidebarAgentCard({
  agent,
  agents,
}: {
  agent: TasklessAgent;
  agents: AgentsControl;
}): React.JSX.Element {
  return <AgentCard subject={tasklessRowSubject(agent, agents)} models={agents.models} />;
}

export function SidebarAgent({
  agent,
  agents,
  current,
  now,
  at,
  repository,
  face = true,
  nest,
  place,
  shown,
  onOpen,
  onPin,
  section,
  onDeleted,
}: {
  agent: TasklessAgent;
  agents: AgentsControl;
  current: boolean;
  now: number;
  at: number;
  repository?: React.ReactNode;
  face?: boolean;
  nest?: ListRowNest | undefined;
  place?: VirtualRowPlace | undefined;
  shown: boolean;
  onOpen: () => void;
  onPin?: ((pinned: boolean) => void) | undefined;
  section?: MenuEntry | undefined;
  onDeleted: () => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const name = taskRowName(agentRow(agent));
  const starter = starterOf(agent, face, reader);
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const rowPlace = useRowPlace();
  const coarse = useCoarsePointer();
  const queryClient = useQueryClient();
  const reads = useAgentReadMarks();
  const isUnread = agent.markedUnread === true || (!current && agentReadsUnread(agent));
  const actions = useAgentActions(
    agent,
    { ...agents, readAgent: (agentId) => readAgentById(queryClient, agentId) },
    { label: name, shown, terminals: { onOpenTerminal: undefined }, onDeleted },
  );
  const { archive } = actions.doors;
  const archived = agent.archivedAt !== undefined;
  const drafted = useDraftedAgents().includes(agent.id) && !current;
  const sendFailed = useFailedAgents().includes(agent.id) && !current;
  const { rename } = actions;
  const editing = rename?.editing ?? false;
  const endedByKey = useRefocusAfterEdit(editing, row);
  const pinned = agent.pinnedAt !== undefined;
  useFocusedRowKeys(
    item,
    () => reads.mark(agent, !isUnread),
    onPin === undefined ? undefined : () => onPin(!pinned),
  );
  const groups: MenuEntry[][] = agentMenuGroups({
    ...rowDoors(actions.doors),
    read: { unread: isUnread, onMark: (next) => reads.mark(agent, next) },
    agentPin: onPin === undefined ? undefined : { pinned, onToggle: () => onPin(!pinned) },
    section,
    rowKeys: true,
  });
  const marks: RowMark[] = [
    ...(onPin === undefined
      ? []
      : [
          {
            key: "pin",
            ...commandHead(pinned ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.PIN_AGENT),
            onSelect: () => onPin(!pinned),
          },
        ]),
    ...(archive === undefined
      ? []
      : [
          archived
            ? {
                key: "unarchive",
                ...commandHead(PANEL_COMMAND.UNARCHIVE_AGENT),
                onSelect: archive.onSelect,
              }
            : {
                key: "archive",
                ...commandHead(PANEL_COMMAND.ARCHIVE_AGENT),
                onSelect: archive.onSelect,
              },
        ]),
  ];
  const card = useMemo(() => <SidebarAgentCard agent={agent} agents={agents} />, [agent, agents]);
  return (
    <>
      <RowHintOptions card={card}>
        <ListRow
          ref={hold}
          motionKey={agent.id}
          nest={nest}
          place={place}
          density={LIST_DENSITY.DENSE}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={
            <span className="sidebar-agent-glyph inline-flex [--state-glyph-size:var(--spacing-ui-16)]">
              <ReplayMask>{tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon}</ReplayMask>
            </span>
          }
          title={
            editing && rename !== undefined ? (
              <InlineEdit
                value={rename.asked ?? name}
                label="Agent name"
                maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
                editing
                onEnd={(edit) => {
                  endedByKey(edit.byKey);
                  rename.end(edit.value);
                }}
              />
            ) : (
              <>
                <OneLine words={name}>
                  <ReplayMask>{name}</ReplayMask>
                </OneLine>
                {isUnread ? <VisuallyHidden>(unread)</VisuallyHidden> : null}
              </>
            )
          }
          description={rename?.refused === true ? <span>{RENAME_FAILED}</span> : undefined}
          meta={
            editing ? null : (
              <span className={SIDEBAR_ROW_TIME}>
                {repository === undefined ? null : (
                  <span className={SIDEBAR_ROW_REPOSITORY}>
                    <ReplayMask>{repository}</ReplayMask>
                  </span>
                )}
                {agent.source?.kind === AGENT_SOURCE.SLACK ? (
                  <>
                    <ProviderMark
                      provider={INTEGRATION_PROVIDER.SLACK}
                      size={PROVIDER_MARK_SIZE.CAPTION}
                    />
                    <VisuallyHidden>{FROM_SLACK}</VisuallyHidden>
                  </>
                ) : null}
                {starter === undefined ? null : (
                  <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />
                )}
                {leftMark(sendFailed, drafted)}
                {agentEndMark(agent, false)}
                <Time at={at} now={now} hint={false} />
              </span>
            )
          }
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={isUnread}
          hint={editing ? undefined : { Hint: RowHint, label: name }}
          onPress={editing ? undefined : onOpen}
          menu={editing ? undefined : rowMenu("Agent", withRowMoves(groups, rowPlace), shown, true)}
          more={!coarse}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={editing || coarse ? null : <RowMarks marks={marks} />}
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}
