import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@luke/features/task-wire";
import type { TasksSkillsAnswer } from "@luke/features/tasks-view";
import type { SkillSource, SkillsRead } from "./skill-picker.js";

/**
 * repository-skills.ts -- the skills of the open task's repository a `/` in an agent's box offers, read once for the task.
 *
 * The skills are read the first time a box asks for them, and the read is
 * kept, the one in flight shared by every box that asks meanwhile, for as
 * long as the task stays open on the same repository, so opening the list
 * again reads nothing; opening the task again reads the repository as
 * GitHub holds it then. A read that did not land or that the service
 * refused is not kept, so the next `/` asks again, and says why in the
 * list's own words.
 */

/** Why a repository's skills were not read, in the list's words. */
const SKILLS_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "The Luke GitHub App no longer reaches this task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read just now.",
  [TASK_FILE_REFUSAL.SECRET]: "This repository's skills could not be read.",
  [TASK_FILE_REFUSAL.MISSING]: "This repository's skills could not be read.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "This repository's skills could not be read.",
} as const satisfies Record<TaskFileRefusal, string>;

/** The service's answer as the list reads it: the skills, or why there are none to offer. */
function skillsReadOf(answer: TasksSkillsAnswer): SkillsRead {
  if ("skills" in answer) return { skills: answer.skills.skills };
  if (!("refusal" in answer)) return { unread: SKILLS_REFUSAL_LINE[TASK_FILE_REFUSAL.UNAVAILABLE] };
  return { unread: SKILLS_REFUSAL_LINE[answer.refusal] };
}

/** A source over the read given that reads once and keeps what it read; a read that did not land, or was refused, is asked again next time. */
export function keptSkills(read: () => Promise<TasksSkillsAnswer>): SkillSource {
  let kept: Promise<SkillsRead> | undefined;
  return () => {
    if (kept !== undefined) return kept;
    const reading = read().then(
      (answer) => {
        if (!("skills" in answer)) kept = undefined;
        return skillsReadOf(answer);
      },
      (): SkillsRead => {
        kept = undefined;
        return { unread: SKILLS_REFUSAL_LINE[TASK_FILE_REFUSAL.UNAVAILABLE] };
      },
    );
    kept = reading;
    return reading;
  };
}
