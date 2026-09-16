import { BRAIN_INPUT_MARKER } from "@sidecar/brain/input-items";
import type { ChildRead } from "@sidecar/hosted/reads-wire";
import type { SessionIdentity } from "@sidecar/session";
import type { SessionView } from "./session-model";

/**
 * What the panel calls a child, wherever it names one: on the list's rows, the
 * transcript page's header, and the chip a completion in the thread wears.
 * One helper so the same child reads the same on every page. Beside it, what
 * the panel calls a per-workspace agent: the roster's own title for the
 * session, found by the identity the agents read or a turn group's source
 * named it under, the way the thread's chips name a session, and, once the
 * roster has let the session go, the title the service kept for it.
 */

/** How much of a child's id, or a session's, stands in for a name when nothing else does. */
const ID_EXCERPT_CHARS = 8;

/** The roster's session for an agent, by session identity, while the roster still holds it. */
export function agentSession(
  agent: SessionIdentity,
  roster: readonly SessionView[],
): SessionView | undefined {
  return roster.find(
    (session) => session.providerId === agent.providerId && session.id === agent.providerSessionId,
  );
}

/** What a row calls a per-workspace agent: the roster's title for its session, else the title the service kept where the caller has it, else a slice of the session's id. */
export function agentTitle(
  agent: SessionIdentity & { readonly title?: string },
  roster: readonly SessionView[],
): string {
  return (
    agentSession(agent, roster)?.title ??
    agent.title ??
    `Session ${agent.providerSessionId.slice(0, ID_EXCERPT_CHARS)}`
  );
}

/** The name a child falls back to: a slice of its id. */
function childIdTitle(childId: string): string {
  return `Child ${childId.slice(0, ID_EXCERPT_CHARS)}`;
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
