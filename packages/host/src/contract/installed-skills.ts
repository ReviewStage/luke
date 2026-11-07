import {
  INSTALLED_SKILL_CALL_FAILURE,
  installedSkillContentViewSchema,
  installedSkillFollowParamsSchema,
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillInstallViewSchema,
  installedSkillPreviewParamsSchema,
  installedSkillPreviewViewSchema,
  installedSkillRemovedViewSchema,
} from "@repo/features/installed-skill-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * installed-skills.ts -- Settings' Skills page's asks of the host about the skills the account installs: each plain ask declared, and the live follow beside them.
 *
 * Only a panel draws Settings, so every ask is the panel's alone. A refusal
 * or a defect of the host's is drawn as the skill calls' unanswered
 * failure, as every one was before it was declared. A workspace's skills are
 * a live follow, declared once (`live-follow.ts`).
 */

/** What the window draws for a skill ask the host could not answer. */
const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

/** The installed skills' plain asks, each answered by the installed skills' composer. */
export const INSTALLED_SKILL_ACTS = declaredActs({
  INSTALLED_SKILLS_READ: hostAct({
    input: installedSkillIdParamsSchema,
    output: installedSkillContentViewSchema,
    refusal: "Could not read the skill on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  INSTALLED_SKILLS_PREVIEW: hostAct({
    input: installedSkillPreviewParamsSchema,
    output: installedSkillPreviewViewSchema,
    refusal: "Could not read what that paste would install on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  INSTALLED_SKILLS_INSTALL: hostAct({
    input: installedSkillInstallParamsSchema,
    output: installedSkillInstallViewSchema,
    refusal: "Could not install the skill on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  INSTALLED_SKILLS_REMOVE: hostAct({
    input: installedSkillIdParamsSchema,
    output: installedSkillRemovedViewSchema,
    refusal: "Could not remove the skill on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
});

/** A workspace's skills, followed for Settings › Skills while it holds them. */
export const INSTALLED_SKILL_FOLLOWS = liveFollows({
  INSTALLED_SKILLS_FOLLOW: liveFollow({
    slice: LIVE_READ.INSTALLED_SKILLS,
    hold: HOLD.WINDOW,
    key: installedSkillFollowParamsSchema,
    refusal: "Could not follow your skills on this system.",
    panelOnly: true,
    retry: {
      name: "INSTALLED_SKILLS_RETRY",
      refusal: "Could not read your skills again on this system.",
    },
  }),
});

export const installedSkillActsContract = {
  ...contractOf(INSTALLED_SKILL_ACTS),
  ...followsContractOf(INSTALLED_SKILL_FOLLOWS),
};
