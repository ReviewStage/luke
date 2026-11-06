import { eventIterator, type } from "@orpc/contract";
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
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { INSTALLED_SKILL_ACT_KIND } from "./kinds.js";

/**
 * installed-skills.ts -- Settings' Skills page's asks of the host about the skills the account installs: each plain ask declared, and the procedures of the hold and its Try again beside them.
 *
 * Only a panel draws Settings, so every ask is the panel's alone. A refusal
 * or a defect of the host's is drawn as the skill calls' unanswered
 * failure, as every one was before it was declared. The hold and its Try
 * again stay procedures of their own
 * (`act-port/installed-skill-procedures.ts`): a live read, not a plain act.
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

export const installedSkillActsContract = {
  ...contractOf(INSTALLED_SKILL_ACTS),
  // Note that the hold's stream carries nothing: the held skills reach the panel on app state, and the stream is the window's hold on them.
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_FOLLOW]: actProcedure(
    "Could not follow your skills on this system.",
  )
    .input(exactInput(installedSkillFollowParamsSchema))
    .output(eventIterator(type<never>())),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY]: actProcedure(
    "Could not read your skills again on this system.",
  )
    .input(exactInput(installedSkillFollowParamsSchema))
    .output(EffectSchema.Void),
};
