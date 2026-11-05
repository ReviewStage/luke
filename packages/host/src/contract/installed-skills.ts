import { eventIterator, type } from "@orpc/contract";
import {
  installedSkillContentViewSchema,
  installedSkillFollowParamsSchema,
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillInstallViewSchema,
  installedSkillPreviewParamsSchema,
  installedSkillPreviewViewSchema,
  installedSkillRemovedViewSchema,
} from "@repo/features/installed-skill-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { INSTALLED_SKILL_ACT_KIND } from "./kinds.js";

/**
 * installed-skills.ts -- Settings' Skills page's asks of the host about the skills the account installs, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * page's value into what crosses the port, the convention the hosted contract
 * keeps (`@repo/features/contract`).
 */
export const installedSkillActsContract = {
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
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_READ]: actProcedure(
    "Could not read the skill on this system.",
  )
    .input(exactInput(installedSkillIdParamsSchema))
    .output(EffectSchema.flip(installedSkillContentViewSchema)),
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
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_REMOVE]: actProcedure(
    "Could not remove the skill on this system.",
  )
    .input(exactInput(installedSkillIdParamsSchema))
    .output(EffectSchema.flip(installedSkillRemovedViewSchema)),
};
