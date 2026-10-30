import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@luke/features/task-wire";
import type { TasksSkillsAnswer } from "@luke/features/tasks-view";
import { keepIdentity } from "@luke/wire";
import type { SkillSource, SkillsRead } from "./skill-picker.js";

/**
 * repository-skills.ts -- the skills of the open task's repository a `/` in an agent's box offers, drawn at once as last read and read again behind.
 *
 * Each ask goes to the host, which answers the skills it holds at once and
 * reads them again behind the answer (`@luke/host`'s `compose-tasks.ts`),
 * so a skill added on GitHub is offered the next time a box asks; one ask
 * is out at a time, shared by every box that asks meanwhile. An answer
 * naming the skills last read keeps their identity, so nothing drawn from
 * them is drawn again, and one that did not land, or that the service
 * refused, leaves the skills last read standing where there are any;
 * where there are none it says why, in the list's own words.
 */

/** Why a repository's skills were not read, in the list's words. */
const SKILLS_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]: "Luke's GitHub App no longer reaches this task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read.",
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

/** A source over the read given: each ask reads again, an answer naming the skills last read keeping their identity, and one that did not land leaving them standing. */
export function keptSkills(read: () => Promise<TasksSkillsAnswer>): SkillSource {
  let out: Promise<SkillsRead> | undefined;
  let last: SkillsRead | undefined;
  const settle = (next: SkillsRead): SkillsRead => {
    if ("unread" in next && last !== undefined && "skills" in last) return last;
    last = last === undefined ? next : keepIdentity(last, next);
    return last;
  };
  return () => {
    if (out !== undefined) return out;
    const reading = read()
      .then(
        (answer) => settle(skillsReadOf(answer)),
        () => settle({ unread: SKILLS_REFUSAL_LINE[TASK_FILE_REFUSAL.UNAVAILABLE] }),
      )
      .finally(() => {
        out = undefined;
      });
    out = reading;
    return reading;
  };
}
