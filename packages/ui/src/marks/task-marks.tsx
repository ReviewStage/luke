import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * task-marks.tsx -- the marks a task's status and priority wear wherever a task is drawn: a page's chip, a menu's row, a list's line.
 *
 * A status is a ring that fills as work moves through it: dashed while it
 * is filed for later, an empty ring to do, half filled under way, and a
 * filled disc once settled, with a check for done and a cross for
 * canceled. A priority is three bars, as many lit as it matters, an
 * attention square for urgent, and three dashes for one no one weighed.
 * Each mark draws in its own ink (`task-marks.css`) at the glyph cell of
 * whatever leads with it, which sizes it, and says nothing of its own: the
 * words beside it, or the caller's label, are what a reader hears.
 */

/** The bars a priority lights, of three: none for an unweighed task, whose mark is dashes instead, and urgent's its square. */
const LIT_BARS = {
  [TASK_PRIORITY.NONE]: 0,
  [TASK_PRIORITY.URGENT]: 3,
  [TASK_PRIORITY.HIGH]: 3,
  [TASK_PRIORITY.MEDIUM]: 2,
  [TASK_PRIORITY.LOW]: 1,
} as const satisfies Record<TaskPriority, number>;

/** The three bars, each its left edge, its top, and its height, rising left to right. */
const BARS = [
  { x: 2, y: 8, height: 4 },
  { x: 6, y: 5, height: 7 },
  { x: 10, y: 2, height: 10 },
] as const;

/** The ring every status but the settled ones draws, dashed for the backlog. */
function Ring({ dashed }: { dashed: boolean }): React.JSX.Element {
  return (
    <circle
      className="luke-task-mark-line"
      cx="7"
      cy="7"
      r="5.5"
      strokeDasharray={dashed ? "2 1.8" : undefined}
    />
  );
}

/** What a status draws inside its 14-unit box. */
function statusBody(status: TaskStatus): React.JSX.Element {
  switch (status) {
    case TASK_STATUS.BACKLOG:
      return <Ring dashed />;
    case TASK_STATUS.TODO:
      return <Ring dashed={false} />;
    case TASK_STATUS.IN_PROGRESS:
      return (
        <>
          <Ring dashed={false} />
          <path className="luke-task-mark-fill" d="M7 3.5a3.5 3.5 0 0 1 0 7Z" />
        </>
      );
    case TASK_STATUS.DONE:
      return (
        <>
          <circle className="luke-task-mark-fill" cx="7" cy="7" r="6.25" />
          <path className="luke-task-mark-cut" d="M4.4 7.2l1.8 1.8 3.5-3.6" />
        </>
      );
    case TASK_STATUS.CANCELED:
      return (
        <>
          <circle className="luke-task-mark-fill" cx="7" cy="7" r="6.25" />
          <path className="luke-task-mark-cut" d="M5 5l4 4M9 5l-4 4" />
        </>
      );
  }
}

/** A task's status as its mark, coloured by the status it stands for. */
export function TaskStatusMark({ status }: { status: TaskStatus }): React.JSX.Element {
  return (
    <svg
      className="luke-task-mark luke-task-status-mark"
      data-status={status}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {statusBody(status)}
    </svg>
  );
}

/** What a priority draws inside its 14-unit box. */
function priorityBody(priority: TaskPriority): React.JSX.Element {
  if (priority === TASK_PRIORITY.URGENT) {
    return (
      <>
        <rect className="luke-task-mark-fill" x="1" y="1" width="12" height="12" rx="3" />
        <path className="luke-task-mark-cut" d="M7 4v3.6M7 9.6v.2" />
      </>
    );
  }
  if (priority === TASK_PRIORITY.NONE) {
    return (
      <>
        {BARS.map(({ x }) => (
          <rect
            key={x}
            className="luke-task-mark-fill"
            x={x}
            y="6.3"
            width="2"
            height="1.4"
            rx=".5"
          />
        ))}
      </>
    );
  }
  const lit = LIT_BARS[priority];
  return (
    <>
      {BARS.map(({ x, y, height }, index) => (
        <rect
          key={x}
          className="luke-task-mark-fill"
          data-lit={index < lit}
          x={x}
          y={y}
          width="2.4"
          height={height}
          rx=".6"
        />
      ))}
    </>
  );
}

/** A task's priority as its mark: bars as many as it matters, urgent's square, or dashes where no one weighed it. */
export function TaskPriorityMark({ priority }: { priority: TaskPriority }): React.JSX.Element {
  return (
    <svg
      className="luke-task-mark luke-task-priority-mark"
      data-priority={priority}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {priorityBody(priority)}
    </svg>
  );
}
