import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  PinIcon,
  UnpinIcon,
  useMenu,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, teammateCreator } from "@luke/ui/actor-model";
import { agentRow, taskRowName } from "@luke/ui/task-list-model";
import { useCallback, useRef } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { FadingWords } from "../fading-words.js";
import { useMemberDirectory } from "../member-directory.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import { type CodingAgentsControl, readAgentById } from "../tasks/use-coding-agents.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";

/**
 * sidebar-agent.tsx -- an agent an automation started with no task, as a row among the sidebar's tasks.
 *
 * The row is a task's row in every way it can be: its name, its repository
 * where its group does not say it, and its time, under the same view. What
 * tells it apart leads it: the agent's harness mark, as its tab wears it,
 * giving way to the working mark while it works. Its end wears who started
 * it, the automation's clock, or a teammate's face where it ran on no
 * automation, and the failed mark once its turn failed. A press opens the
 * agent's own page, and it reads in semibold while it ended unseen, as its
 * tab does. A right-click offers its actions where the pointer is, as a
 * task's row does: Copy link, the agent's own, as its page's ⋯ copies it,
 * then Pin or Unpin, the reader's own, which moves the row in or out of
 * Pinned at once; an archived agent offers no pin, as an archived task.
 * Last stands Archive agent, as a task's agent's tab offers it, asked first
 * while the agent works (`agent-archive.tsx`), or Unarchive once it is
 * archived. Note that the agent is read again by its own id before it is
 * archived unasked, because the row's status is the list's and the task
 * open's agents never hold it.
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
  /** The window's agent control, whose archive acts on any agent by its id. */
  agents: CodingAgentsControl;
  /** Whether this agent's page is the one standing. */
  current: boolean;
  /** Whether its turn ended while the developer was not looking at it. */
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
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
  }, []);
  const menu = useMenu(shown);
  const place = useRowPlace();
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  const { act } = useAct();
  const archive = useAgentArchive(
    agent,
    { ...agents, readAgent: (agentId) => readAgentById(act, agentId) },
    shown,
  );
  const unarchive = useAgentUnarchive(agent.id, agents);
  const groups = [
    copyLink === undefined ? [] : [copyLink],
    onPin === undefined ? [] : [pinItem(agent, onPin)],
    [agent.archivedAt === undefined ? archive.action : unarchive],
  ].filter((group) => group.length > 0);
  return (
    <>
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
          <>
            {name}
            {unread ? <span className="luke-visually-hidden">(unread)</span> : null}
          </>
        }
        meta={
          <span className="sidebar-task-time">
            {repository === undefined ? null : (
              <FadingWords className="sidebar-task-repository" words={repository} />
            )}
            {starter === undefined ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
            {agentEndMark(agent, false)}
            <RelativeTime at={at} now={now} hint={false} />
          </span>
        }
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        unread={unread}
        menuOpen={menu.open !== undefined}
        hint={{ Hint: Tooltip, label: name }}
        onPress={() => {
          menu.close(false);
          onOpen();
        }}
        contextMenu={menu.contextMenu(row)}
      />
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
