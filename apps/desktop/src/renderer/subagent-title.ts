import { BRAIN_INPUT_MARKER } from "@sidecar/brain/input-items";
import type { AgentRead, ChildRead } from "@sidecar/hosted/reads-wire";
import type { SessionView } from "./session-model";

/**
 * What the panel calls a child, wherever it names one: on the list's rows, the
 * transcript page's header, and the chip a completion in the thread wears.
 * One helper so the same child reads the same on every page. Beside it, what
 * the panel calls a per-workspace agent: the roster's own title for the
 * session, found by the identity the agents read named it under, the way the
 * thread's chips name a session.
 */

/** How much of a child's id, or a session's, stands in for a name when nothing else does. */
const CHILD_ID_EXCERPT_CHARS = 8;

/** The roster's session for an agent, by session identity, while the roster still holds it. */
export function agentSession(
  agent: AgentRead,
  roster: readonly SessionView[],
): SessionView | undefined {
  return roster.find(
    (session) => session.providerId === agent.providerId && session.id === agent.providerSessionId,
  );
}

/** What a row calls a per-workspace agent: the roster's title for its session, or a slice of the session's id once the roster has let it go. */
export function agentTitle(agent: AgentRead, roster: readonly SessionView[]): string {
  return (
    agentSession(agent, roster)?.title ??
    `Session ${agent.providerSessionId.slice(0, CHILD_ID_EXCERPT_CHARS)}`
  );
}

/** The name a child falls back to: a slice of its id. */
function childIdTitle(childId: string): string {
  return `Child ${childId.slice(0, CHILD_ID_EXCERPT_CHARS)}`;
}

/** What a row calls the child: its label, else its task without the marker, else a slice of its id. */
export function subagentTitle(child: ChildRead): string {
  if (child.label) return child.label;
  // The brain leads a delegated task with its own marker; the row names the task, never the framing.
  const task = child.task?.startsWith(BRAIN_INPUT_MARKER.SUBAGENT_TASK)
    ? child.task.slice(BRAIN_INPUT_MARKER.SUBAGENT_TASK.length).trim()
    : child.task;
  return task || childIdTitle(child.id);
}
