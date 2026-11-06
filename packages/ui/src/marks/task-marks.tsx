import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import React from "react";
import { STATUS_TONE, type StatusTone } from "../status-tone.js";

void React;

const LIT_BARS = {
  [TASK_PRIORITY.NONE]: 0,
  [TASK_PRIORITY.URGENT]: 3,
  [TASK_PRIORITY.HIGH]: 3,
  [TASK_PRIORITY.MEDIUM]: 2,
  [TASK_PRIORITY.LOW]: 1,
} as const satisfies Record<TaskPriority, number>;

const MARK_EDGE = { start: 1.5, end: 12.5 } as const;

const BAR_WIDTH = 2.6;

const BARS = [
  { x: MARK_EDGE.start, y: 8.5, height: 4 },
  { x: 7 - BAR_WIDTH / 2, y: 5, height: 7.5 },
  { x: MARK_EDGE.end - BAR_WIDTH, y: MARK_EDGE.start, height: 11 },
] as const;

const STATUS_MARK_TONE = {
  [TASK_STATUS.BACKLOG]: STATUS_TONE.NEUTRAL,
  [TASK_STATUS.TODO]: STATUS_TONE.NEUTRAL,
  [TASK_STATUS.IN_PROGRESS]: STATUS_TONE.WORKING,
  [TASK_STATUS.DONE]: STATUS_TONE.COMPLETE,
  [TASK_STATUS.CANCELED]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<TaskStatus, StatusTone>;

function Ring({ dashed }: { dashed: boolean }): React.JSX.Element {
  return (
    <circle
      className="ui-task-mark-line"
      cx="7"
      cy="7"
      r="5.5"
      strokeDasharray={dashed ? "2 1.8" : undefined}
    />
  );
}

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
          <path className="ui-task-mark-fill" d="M7 3.5a3.5 3.5 0 0 1 0 7Z" />
        </>
      );
    case TASK_STATUS.DONE:
      return (
        <>
          <circle className="ui-task-mark-fill" cx="7" cy="7" r="6.25" />
          <path className="ui-task-mark-cut" d="M4.4 7.2l1.8 1.8 3.5-3.6" />
        </>
      );
    case TASK_STATUS.CANCELED:
      return (
        <>
          <circle className="ui-task-mark-fill" cx="7" cy="7" r="6.25" />
          <path className="ui-task-mark-cut" d="M5 5l4 4M9 5l-4 4" />
        </>
      );
  }
}

export function TaskStatusMark({ status }: { status: TaskStatus }): React.JSX.Element {
  return (
    <svg
      className="ui-task-mark ui-task-status-mark"
      data-status={status}
      data-tone={STATUS_MARK_TONE[status]}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {statusBody(status)}
    </svg>
  );
}

function priorityBody(priority: TaskPriority): React.JSX.Element {
  if (priority === TASK_PRIORITY.URGENT) {
    return (
      <>
        <rect
          className="ui-task-mark-fill"
          x={MARK_EDGE.start}
          y={MARK_EDGE.start}
          width={MARK_EDGE.end - MARK_EDGE.start}
          height={MARK_EDGE.end - MARK_EDGE.start}
          rx="2.5"
        />
        <path className="ui-task-mark-cut" d="M7 4v3.6M7 9.6v.2" />
      </>
    );
  }
  if (priority === TASK_PRIORITY.NONE) {
    return (
      <>
        {BARS.map(({ x }) => (
          <rect
            key={x}
            className="ui-task-mark-fill"
            x={x}
            y="6.25"
            width={BAR_WIDTH}
            height="1.5"
            rx=".6"
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
          className="ui-task-mark-fill"
          data-lit={index < lit}
          x={x}
          y={y}
          width={BAR_WIDTH}
          height={height}
          rx=".75"
        />
      ))}
    </>
  );
}

export function TaskPriorityMark({ priority }: { priority: TaskPriority }): React.JSX.Element {
  return (
    <svg
      className="ui-task-mark ui-task-priority-mark"
      data-priority={priority}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {priorityBody(priority)}
    </svg>
  );
}
