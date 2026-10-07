import { TURN_STATUS } from "@sidecar/wire";

/**
 * Where a child the brain delegated to stands, derived from its latest turn:
 * accepted before one runs (no turn yet, or one still queued), then the
 * turn's own status. The store derives it; a child has no run record of its
 * own to fall out of step with.
 */
export const CHILD_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: TURN_STATUS.RUNNING,
  SETTLED: TURN_STATUS.SETTLED,
  CANCELLED: TURN_STATUS.CANCELLED,
  FAILED: TURN_STATUS.FAILED,
} as const;

export type ChildStatus = (typeof CHILD_STATUS)[keyof typeof CHILD_STATUS];

/** The bounds of the children read: the most children one answer lists, and the most of a task's words it carries. */
export const CHILDREN_READ_BOUNDS = {
  MAX_CHILDREN: 100,
  TASK_EXCERPT_CHARS: 200,
} as const;
