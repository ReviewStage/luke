import { CODING_AGENT_BOUNDS, type TasklessAgent } from "@luke/features/coding-agent-wire";
import {
  ArchiveIcon,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  PencilIcon,
  PinIcon,
  UnarchiveIcon,
  UnpinIcon,
  useMenu,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, teammateCreator } from "@luke/ui/actor-model";
import { agentRow, taskRowName } from "@luke/ui/task-list-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useDraftedAgents } from "../composer-drafts.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
import { FadingWords } from "../fading-words.js";
import { useMemberDirectory } from "../member-directory.js";
import { AgentCard, tasklessRowSubject } from "../tasks/agent-ref.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { type CodingAgentsControl, readAgentById } from "../tasks/use-coding-agents.js";
import { RowHint, RowHintOptions } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { useAgentReadMarks } from "./agent-read-marks.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { type RowMark, RowMarks } from "./task-actions.js";

/**
 * sidebar-agent.tsx -- an agent an automation started with no task, as a row among the sidebar's tasks.
 *
 * The row is a task's row in every way it can be (`task-actions.tsx`'s
 * `SidebarTask`): its name, its repository where its group does not say
 * it, and its time, under the same view. What tells it apart leads it: the
 * agent's harness mark, as its tab wears it, giving way to the working mark
 * while it works. Its end wears who started it, the automation's clock, or a
 * teammate's face where it ran on no automation, the Draft pencil while a
 * draft waits in its box and its page is not the one open, and the failed
 * mark once its turn failed. Pin and Archive, or Unarchive once it is archived, stand
 * in place of all of that while the row is hovered or reached from the
 * keyboard (`RowMarks`), as on a task's row, and rested on, the row hangs the
 * agent's card beside it, as its tab does on a task (`agent-ref.tsx`). A
 * press opens the agent's own page, and it reads in semibold while it ended
 * unseen, as its tab does, or while it is marked unread by hand. A right-click offers its actions where the
 * pointer is, in a task's row's groups: Copy link and Rename, which turns
 * the row into its name's field until the edit ends, with Mark as unread
 * or Mark as read between them, through a task's marks (`agent-read-marks.ts`); then Pin or Unpin,
 * the reader's own, and Archive agent, asked first while the agent works
 * (`agent-archive.tsx`), or Unarchive. An archived agent offers neither a
 * pin nor a rename, as an archived task. Note that the agent is read again
 * by its own id before it is archived unasked, because the row's status is
 * the list's and the task open's agents never hold it.
 */

/** What the row's menu is called, as the agent page's ⋯ is. */
const ACTIONS_LABEL = "Agent actions";

/** Who started the agent, as its row's end wears them: its automation, or a teammate's face where it has none and `face` allows it. */
function starterOf(
  agent: TasklessAgent,
  face: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
): Actor | undefined {
  if (agent.automationName !== undefined) {
    return { kind: ACTOR_KIND.AUTOMATION, name: agent.automationName, state: ACTOR_STATE.REST };
  }
  if (!face) return undefined;
  return teammateCreator({ createdBy: agent.startedBy, ownerId: agent.startedBy?.userId }, reader);
}

/** Pin or Unpin, whichever the agent is not yet, as a task's row offers them. */
function pinItem(agent: TasklessAgent, onPin: (pinned: boolean) => void): MenuAction {
  return agent.pinnedAt === undefined
    ? { label: "Pin", icon: <PinIcon />, onSelect: () => onPin(true) }
    : { label: "Unpin", icon: <UnpinIcon />, onSelect: () => onPin(false) };
}

/**
 * The agent's card, as its tab hangs it on a task (`agent-ref.tsx`): its
 * name, where it stands and when it last moved, who started it, and its
 * pull request, read from the list's row as a task's row's card is. Note
 * that it is a component of its own, so what the card reads is worked out
 * only once the card is drawn, never on a render of the row.
 */
function SidebarAgentCard({
  agent,
  agents,
}: {
  agent: TasklessAgent;
  agents: CodingAgentsControl;
}): React.JSX.Element {
  return <AgentCard subject={tasklessRowSubject(agent, agents)} models={agents.models} />;
}

/** One agent with no task among the sidebar's tasks. */
export function SidebarAgent({
  agent,
  agents,
  current,
  unread,
  now,
  at,
  repository,
  face = true,
  shown,
  onOpen,
  onPin,
}: {
  agent: TasklessAgent;
  /** The window's agent control, whose archive and rename act on any agent by its id. */
  agents: CodingAgentsControl;
  /** Whether this agent's page is the one standing. */
  current: boolean;
  /** Whether its turn ended while the developer was not looking at it: main's unseen dot, which a mark by hand adds to. */
  unread: boolean;
  /** The time the row's time is counted back from. */
  now: number;
  /** The time the row shows, which the list's order chooses. */
  at: number;
  /** The repository's name the row says, muted before its time, where its group does not say it. */
  repository?: string | undefined;
  /** Whether a teammate's agent wears their face, which a group by creator says instead. */
  face?: boolean;
  /** Whether the sidebar is on screen and in sight, which the row's menu does not outlive. */
  shown: boolean;
  onOpen: () => void;
  /** Pins the agent for the reader or unpins it; none for an archived agent, which offers no pin. */
  onPin?: ((pinned: boolean) => void) | undefined;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const name = taskRowName(agentRow(agent));
  const starter = starterOf(agent, face, reader);
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control.
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const menu = useMenu(shown);
  const place = useRowPlace();
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  const { act } = useAct();
  const reads = useAgentReadMarks();
  const isUnread = unread || reads.markedUnread(agent.id);
  const archive = useAgentArchive(
    agent,
    { ...agents, readAgent: (agentId) => readAgentById(act, agentId) },
    shown,
  );
  const unarchive = useAgentUnarchive(agent.id, agents);
  const archived = agent.archivedAt !== undefined;
  // A draft waiting in its box wears the pencil while its page is not the one open, as a task's row does.
  const drafted = useDraftedAgents().includes(agent.id) && !current;
  const rename = useInlineRename(agent.id, agents.onRename);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  const renameItem: MenuAction = { label: "Rename", icon: <PencilIcon />, onSelect: rename.begin };
  const pin = onPin === undefined ? undefined : pinItem(agent, onPin);
  const put = archived ? unarchive : archive.action;
  const groups = [
    [
      ...(copyLink === undefined ? [] : [copyLink]),
      markReadItem({ unread: isUnread, onMark: (next) => reads.mark(agent, next) }),
      ...(archived ? [] : [renameItem]),
    ],
    [...(pin === undefined ? [] : [pin]), put],
  ].filter((group) => group.length > 0);
  // Note that the row's buttons say Pin and Archive as a task's do, running what the menu's items run.
  const pinned = agent.pinnedAt !== undefined;
  const marks: RowMark[] = [
    ...(onPin === undefined
      ? []
      : [
          {
            key: "pin",
            label: pinned ? "Unpin" : "Pin",
            icon: pinned ? <UnpinIcon /> : <PinIcon />,
            onSelect: () => onPin(!pinned),
          },
        ]),
    archived
      ? { key: "unarchive", label: "Unarchive", icon: <UnarchiveIcon />, onSelect: put.onSelect }
      : { key: "archive", label: "Archive", icon: <ArchiveIcon />, onSelect: put.onSelect },
  ];
  const card = useMemo(() => <SidebarAgentCard agent={agent} agents={agents} />, [agent, agents]);
  return (
    <>
      <RowHintOptions card={card} cardBeside cardRegion={item}>
        <ListRow
          ref={hold}
          density={LIST_DENSITY.DENSE}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={
            <span className="sidebar-agent-glyph">
              <AgentGlyph agent={agent} />
            </span>
          }
          title={
            rename.editing ? (
              <InlineEdit
                value={name}
                label="Agent name"
                maxLength={CODING_AGENT_BOUNDS.MAX_TITLE_CHARS}
                editing
                onEnd={(edit) => {
                  refocus.current = edit.byKey;
                  rename.end(edit.value);
                }}
              />
            ) : (
              <>
                {name}
                {isUnread ? <span className="luke-visually-hidden">(unread)</span> : null}
              </>
            )
          }
          meta={
            rename.editing ? null : (
              <span className="sidebar-task-time">
                {repository === undefined ? null : (
                  <FadingWords className="sidebar-task-repository" words={repository} />
                )}
                {starter === undefined ? null : (
                  <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />
                )}
                {drafted ? <DraftMark /> : null}
                {agentEndMark(agent, false)}
                <RelativeTime at={at} now={now} hint={false} />
              </span>
            )
          }
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={isUnread}
          menuOpen={menu.open !== undefined}
          hint={rename.editing ? undefined : { Hint: RowHint, label: name }}
          onPress={
            rename.editing
              ? undefined
              : () => {
                  menu.close(false);
                  onOpen();
                }
          }
          contextMenu={rename.editing ? undefined : menu.contextMenu(row)}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={rename.editing ? null : <RowMarks marks={marks} />}
        />
      </RowHintOptions>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ACTIONS_LABEL}
          menu={menu.drawn}
          groups={withRowMoves(groups, place)}
          onClose={menu.close}
        />
      )}
      {archive.dialog}
    </>
  );
}
