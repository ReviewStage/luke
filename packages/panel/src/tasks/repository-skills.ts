import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@repo/features/task-wire";
import type { TasksSkillsAnswer } from "@repo/features/tasks-view";
import { keepIdentity } from "@repo/wire";
import type { SkillSource, SkillsRead } from "./skill-picker.js";

const SKILLS_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]: `${PRODUCT_NAME}'s GitHub App no longer reaches this task's repository.`,
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read.",
  [TASK_FILE_REFUSAL.SECRET]: "This repository's skills could not be read.",
  [TASK_FILE_REFUSAL.MISSING]: "This repository's skills could not be read.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "This repository's skills could not be read.",
} as const satisfies Record<TaskFileRefusal, string>;

function skillsReadOf(answer: TasksSkillsAnswer): SkillsRead {
  if ("skills" in answer) return { skills: answer.skills.skills };
  if (!("refusal" in answer)) return { unread: SKILLS_REFUSAL_LINE[TASK_FILE_REFUSAL.UNAVAILABLE] };
  return { unread: SKILLS_REFUSAL_LINE[answer.refusal] };
}

export function keptSkills(read: () => Promise<TasksSkillsAnswer>): SkillSource {
  let last: SkillsRead | undefined;
  const settle = (next: SkillsRead): SkillsRead => {
    if ("unread" in next && last !== undefined && "skills" in last) return last;
    last = last === undefined ? next : keepIdentity(last, next);
    return last;
  };
  return () =>
    read().then(
      (answer) => settle(skillsReadOf(answer)),
      () => settle({ unread: SKILLS_REFUSAL_LINE[TASK_FILE_REFUSAL.UNAVAILABLE] }),
    );
}
