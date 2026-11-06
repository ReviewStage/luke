import { TASK_SKILL_SOURCE, type TaskSkillSource } from "@repo/features/task-wire";
import { Badge, STATUS_TONE } from "@repo/ui";

const SKILL_SOURCE_WORD = {
  [TASK_SKILL_SOURCE.REPOSITORY]: "Repository",
  [TASK_SKILL_SOURCE.WORKSPACE]: "Workspace",
  [TASK_SKILL_SOURCE.PERSONAL]: "Only you",
} as const satisfies Record<TaskSkillSource, string>;

export function SkillSourceBadge({ source }: { source: TaskSkillSource }): React.JSX.Element {
  return <Badge tone={STATUS_TONE.NEUTRAL}>{SKILL_SOURCE_WORD[source]}</Badge>;
}
