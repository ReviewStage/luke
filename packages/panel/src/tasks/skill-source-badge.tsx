import { TASK_SKILL_SOURCE, type TaskSkillSource } from "@luke/features/task-wire";
import { Badge, STATUS_TONE } from "@luke/ui";

/**
 * skill-source-badge.tsx -- the short word saying where a skill the `/` list offers comes from: Repository, Workspace, or Only you.
 *
 * A skill is offered from the task's repository or from the skills a member
 * installed into Luke, for the whole workspace or for themselves
 * (`task-skills.ts`), and the list, the composer's chip's card, and a sent
 * chip's card each say which beside its name, so a member reading
 * `/release-notes` knows whether the repository keeps it or Settings ›
 * Skills does. The words are the badge, in the neutral tone, since where a
 * skill comes from is no state of it.
 */

/** The badge's word for each source. */
const SKILL_SOURCE_WORD = {
  [TASK_SKILL_SOURCE.REPOSITORY]: "Repository",
  [TASK_SKILL_SOURCE.WORKSPACE]: "Workspace",
  [TASK_SKILL_SOURCE.PERSONAL]: "Only you",
} as const satisfies Record<TaskSkillSource, string>;

/** Where the skill comes from, as a neutral badge. */
export function SkillSourceBadge({ source }: { source: TaskSkillSource }): React.JSX.Element {
  return <Badge tone={STATUS_TONE.NEUTRAL}>{SKILL_SOURCE_WORD[source]}</Badge>;
}
