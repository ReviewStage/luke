import { PLAN_FILE_REFUSAL, type PlanFileRefusal } from "@sidecar/hosted/plan-wire";
import type { PlanningSkillsAnswer } from "@sidecar/hosted/planning-view";
import { CONNECTED_ACCOUNTS_LINK } from "../open-settings";
import type { SkillSource, SkillsRead } from "./skill-picker";

/**
 * repository-skills.ts -- the skills of the open plan's repository a `/` in an agent's box offers, read once for the plan.
 *
 * The skills are read the first time a box asks for them, and the read is
 * kept, the one in flight shared by every box that asks meanwhile, for as
 * long as the plan stays open on the same repository, so opening the list
 * again reads nothing; opening the plan again reads the repository as
 * GitHub holds it then. A read that did not land or that the service
 * refused is not kept, so the next `/` asks again, and says why in the
 * list's own words.
 */

/** Why a repository's skills were not read, in the list's words. */
const SKILLS_REFUSAL_LINE = {
  [PLAN_FILE_REFUSAL.NO_REPOSITORY]: "This plan has no repository.",
  [PLAN_FILE_REFUSAL.NOT_REACHABLE]:
    "The Luke GitHub App no longer reaches this plan's repository.",
  [PLAN_FILE_REFUSAL.SIGN_IN_REQUIRED]:
    "Connect GitHub in Settings to read this repository's skills.",
  [PLAN_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read just now.",
  [PLAN_FILE_REFUSAL.SECRET]: "This repository's skills could not be read.",
  [PLAN_FILE_REFUSAL.MISSING]: "This repository's skills could not be read.",
  [PLAN_FILE_REFUSAL.NOT_TEXT]: "This repository's skills could not be read.",
} as const satisfies Record<PlanFileRefusal, string>;

/** The service's answer as the list reads it: the skills, or why there are none to offer. */
function skillsReadOf(answer: PlanningSkillsAnswer): SkillsRead {
  if ("skills" in answer) return { skills: answer.skills.skills };
  if (!("refusal" in answer)) return { unread: SKILLS_REFUSAL_LINE[PLAN_FILE_REFUSAL.UNAVAILABLE] };
  // GitHub not connected is mended in Settings, which the list offers to open.
  if (answer.refusal === PLAN_FILE_REFUSAL.SIGN_IN_REQUIRED) {
    return { unread: SKILLS_REFUSAL_LINE[answer.refusal], mendedAt: CONNECTED_ACCOUNTS_LINK };
  }
  return { unread: SKILLS_REFUSAL_LINE[answer.refusal] };
}

/** A source over the read given that reads once and keeps what it read; a read that did not land, or was refused, is asked again next time. */
export function keptSkills(read: () => Promise<PlanningSkillsAnswer>): SkillSource {
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
        return { unread: SKILLS_REFUSAL_LINE[PLAN_FILE_REFUSAL.UNAVAILABLE] };
      },
    );
    kept = reading;
    return reading;
  };
}
