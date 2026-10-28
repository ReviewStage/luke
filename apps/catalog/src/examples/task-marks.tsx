import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskAgentsSummary } from "@luke/features/task-wire";
import {
  AttentionMark,
  FailedMark,
  GAP,
  Inline,
  TASK_AGENTS_MARK_SIZE,
  TaskAgentsMark,
  type TaskAgentsMarkSize,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * task-marks.tsx -- a task's status as its mark, each of the five, its
 * priority as its mark, each of the five, and the one icon of how its agents
 * stand, each of the six it can wear, every one beside the word it stands for.
 */

/** A task's agents at rest, with `counts` and a pull request standing in `state` where one is given. */
function agents(
  counts: Partial<Pick<TaskAgentsSummary, "working" | "failed">>,
  state?: (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE],
): TaskAgentsSummary {
  const pullRequests =
    state === undefined
      ? []
      : [
          {
            number: 42,
            title: "Sample",
            state,
            checks: CHECK_SUMMARY.NONE,
            additions: 1,
            deletions: 1,
          },
        ];
  return {
    total: 1,
    working: 0,
    agents: [],
    pullRequestTotal: pullRequests.length,
    pullRequests,
    ...counts,
  };
}

/** One task's agents in each status its icon wears, most pressing first, each beside its word. */
const AGENTS_STATUSES = [
  ["failed", agents({ failed: 1 })],
  ["working", agents({ working: 1 })],
  ["open", agents({}, PULL_REQUEST_STATE.OPEN)],
  ["draft", agents({}, PULL_REQUEST_STATE.DRAFT)],
  ["merged", agents({}, PULL_REQUEST_STATE.MERGED)],
  ["closed", agents({}, PULL_REQUEST_STATE.CLOSED)],
] as const;

/** Every status a task's agents icon wears, at `size`, each beside its word. */
function TaskAgentsMarks({ size }: { size: TaskAgentsMarkSize }): React.JSX.Element {
  return (
    <Inline gap={GAP.SECTION}>
      {AGENTS_STATUSES.map(([words, summary]) => (
        <Inline key={words} gap={GAP.CONTROL}>
          <TaskAgentsMark agents={summary} size={size} />
          <Text variant={TEXT_VARIANT.CAPTION}>{words}</Text>
        </Inline>
      ))}
    </Inline>
  );
}

function TaskMarks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="task-status-mark" title="A task's status">
        <Inline gap={GAP.SECTION}>
          {Object.values(TASK_STATUS).map((status) => (
            <Inline key={status} gap={GAP.CONTROL}>
              <TaskStatusMark status={status} />
              <Text variant={TEXT_VARIANT.CAPTION}>{status}</Text>
            </Inline>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="task-priority-mark" title="A task's priority">
        <Inline gap={GAP.SECTION}>
          {Object.values(TASK_PRIORITY).map((priority) => (
            <Inline key={priority} gap={GAP.CONTROL}>
              <TaskPriorityMark priority={priority} />
              <Text variant={TEXT_VARIANT.CAPTION}>{priority}</Text>
            </Inline>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="status-marks" title="A question waiting on you, and a failure">
        <Inline gap={GAP.SECTION}>
          <Inline gap={GAP.CONTROL}>
            <AttentionMark />
            <Text variant={TEXT_VARIANT.CAPTION}>attention</Text>
          </Inline>
          <Inline gap={GAP.CONTROL}>
            <FailedMark />
            <Text variant={TEXT_VARIANT.CAPTION}>failed</Text>
          </Inline>
        </Inline>
      </CatalogSection>
      <CatalogSection id="task-agents-mark" title="How a task's agents stand, in a sidebar row">
        <TaskAgentsMarks size={TASK_AGENTS_MARK_SIZE.SMALL} />
      </CatalogSection>
      <CatalogSection
        id="task-agents-mark-medium"
        title="How a task's agents stand, on the Tasks page"
      >
        <TaskAgentsMarks size={TASK_AGENTS_MARK_SIZE.MEDIUM} />
      </CatalogSection>
    </>
  );
}

export const TASK_MARKS_EXAMPLE: Example = {
  id: "task-marks",
  title: "Task marks",
  Render: TaskMarks,
};
