import type { PlanlessAgent } from "@luke/features/coding-agent-wire";
import { ACTOR_KIND, ACTOR_STATE, type Actor, teammateCreator } from "@luke/ui/actor-model";
import { agentRow, taskRowName } from "@luke/ui/task-list-model";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { useMemberDirectory } from "../member-directory";
import { RelativeTime } from "../planning/relative-time";
import { AgentGlyph, agentEndMark } from "../planning/tab-look";
import { Tooltip } from "../tooltip";

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
 * tab does.
 */

/** Who started the agent, as its row's end wears them: its automation, or a teammate's face where it has none and `face` allows it. */
function starterOf(
  agent: PlanlessAgent,
  face: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
): Actor | undefined {
  if (agent.automationName !== undefined) {
    return { kind: ACTOR_KIND.AUTOMATION, name: agent.automationName, state: ACTOR_STATE.REST };
  }
  if (!face) return undefined;
  return teammateCreator({ createdBy: agent.startedBy, ownerId: agent.startedBy?.userId }, reader);
}

/** One agent with no task among the sidebar's tasks. */
export function SidebarAgent({
  agent,
  current,
  unread,
  now,
  at,
  repository,
  face = true,
  onOpen,
}: {
  agent: PlanlessAgent;
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
  onOpen: () => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const name = taskRowName(agentRow(agent));
  const starter = starterOf(agent, face, reader);
  return (
    <li className="sidebar-plan-item">
      <Tooltip label={name}>
        <button
          type="button"
          className="sidebar-plan sidebar-agent"
          aria-current={current ? "page" : undefined}
          data-unread={String(unread)}
          onClick={onOpen}
        >
          <span className="sidebar-plan-line">
            <span className="sidebar-agent-glyph" aria-hidden="true">
              <AgentGlyph agent={agent} />
            </span>
            <span className="sidebar-plan-name">{name}</span>
            {unread ? <span className="visually-hidden">(unread)</span> : null}
            <span className="sidebar-plan-time">
              {repository === undefined ? null : (
                <span className="sidebar-plan-repository">{repository}</span>
              )}
              {starter === undefined ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
              {agentEndMark(agent, false)}
              <RelativeTime at={at} now={now} hint={false} />
            </span>
          </span>
        </button>
      </Tooltip>
    </li>
  );
}
