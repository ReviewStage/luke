import { BRAIN_INPUT_MARKER } from "@sidecar/brain/input-items";
import type { ChildRead } from "@sidecar/hosted/reads-wire";

/**
 * What the panel calls a child, wherever it names one: on the list's rows, the
 * transcript page's header, and the chip a completion in the thread wears.
 * One helper so the same child reads the same on every page.
 */

/** How much of a child's id stands in for a name when it was handed neither a label nor a task. */
const CHILD_ID_EXCERPT_CHARS = 8;

/** The name a child falls back to: a slice of its id. */
export function childIdTitle(childId: string): string {
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
