import {
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillInstallViewSchema,
  installedSkillListParamsSchema,
  installedSkillListViewSchema,
  installedSkillPreviewParamsSchema,
  installedSkillPreviewViewSchema,
  installedSkillRemovedViewSchema,
  installedSkillToggleParamsSchema,
  installedSkillUpdateCheckViewSchema,
  installedSkillUpdatedViewSchema,
  installedSkillUpdateParamsSchema,
  installedSkillViewSchema,
} from "@luke/features/installed-skill-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { INSTALLED_SKILL_ACT_KIND } from "./kinds.js";

/**
 * installed-skills.ts -- Settings' Skills page's asks of the host about the skills the account installs into Luke, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * page's value into what crosses the port, the convention the hosted contract
 * keeps (`@luke/features/contract`).
 */
export const installedSkillActsContract = {
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_LIST]: actProcedure(
    "Could not read your skills on this system.",
  )
    .input(exactInput(installedSkillListParamsSchema))
    .output(EffectSchema.flip(installedSkillListViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_PREVIEW]: actProcedure(
    "Could not read what that paste would install on this system.",
  )
    .input(exactInput(installedSkillPreviewParamsSchema))
    .output(EffectSchema.flip(installedSkillPreviewViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_INSTALL]: actProcedure(
    "Could not install the skill on this system.",
  )
    .input(exactInput(installedSkillInstallParamsSchema))
    .output(EffectSchema.flip(installedSkillInstallViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_SET_ENABLED]: actProcedure(
    "Could not turn the skill on or off on this system.",
  )
    .input(exactInput(installedSkillToggleParamsSchema))
    .output(EffectSchema.flip(installedSkillViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE]: actProcedure(
    "Could not check the skill for an update on this system.",
  )
    .input(exactInput(installedSkillUpdateParamsSchema))
    .output(EffectSchema.flip(installedSkillUpdateCheckViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_UPDATE]: actProcedure(
    "Could not update the skill on this system.",
  )
    .input(exactInput(installedSkillUpdateParamsSchema))
    .output(EffectSchema.flip(installedSkillUpdatedViewSchema)),
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_REMOVE]: actProcedure(
    "Could not remove the skill on this system.",
  )
    .input(exactInput(installedSkillIdParamsSchema))
    .output(EffectSchema.flip(installedSkillRemovedViewSchema)),
};
