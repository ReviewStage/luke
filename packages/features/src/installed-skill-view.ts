import { Schema as EffectSchema } from "effect";
import { installedSkillsContract } from "./contract/installed-skills.js";
import { failureFactsSchema } from "./failure-facts.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import {
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillPreviewRequestSchema,
  installedSkillPreviewSchema,
} from "./installed-skill-route-wire.js";
import { INSTALLED_SKILL_REFUSAL } from "./installed-skill-wire.js";
import { HOSTED_API_ERROR, wireUuidSchema } from "./service-wire.js";

/**
 * installed-skill-view.ts -- the skills a member installs into the app as one window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf
 * (`installed-skill-client.ts`) and answers the window one of the shapes
 * here: the service's answer, or why there is none, with the skill it
 * names where the service said. The failures are derived from the
 * procedures' declared refusals (`hosted-failure.ts`), but a skill's files
 * refused, which the window hears by the store's reason for it. Settings › Skills
 * draws the skills the host holds for it (`installed-skill-live.ts`), and
 * its Add skill dialog previews and installs a paste.
 */

/** The failures installed skills shipped under spellings of their own, by the refusal each stands for. */
export const INSTALLED_SKILL_RENAMES = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: "invalid",
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: "name-taken",
} as const;

// Note that files refused never reach a window under their slug: the client spells them by the store's reason (`INSTALLED_SKILL_REFUSAL`).
const { SKILL_FILES_REFUSED: _filesRefused, ...called } = failureSetOf(installedSkillsContract, {
  as: INSTALLED_SKILL_RENAMES,
});

/** Why an installed skills call has no answer: a skill refused, for the store's reason, or the call's own failure. */
export const INSTALLED_SKILL_CALL_FAILURE = { ...INSTALLED_SKILL_REFUSAL, ...called } as const;

export type InstalledSkillCallFailure =
  (typeof INSTALLED_SKILL_CALL_FAILURE)[keyof typeof INSTALLED_SKILL_CALL_FAILURE];

/** Why a call that reads a paste has no answer: any failure of the domain, a skill's files refused by the store's reason among them. */
const pasteFailed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INSTALLED_SKILL_CALL_FAILURE)),
  skillName: EffectSchema.optionalKey(EffectSchema.String),
  cause: EffectSchema.optionalKey(failureFactsSchema),
});

/** Why a call has no answer, with the skill refused, by name, where the service read one. */
export type InstalledSkillFailedView = typeof pasteFailed.Type;

/* ----- Params ----- */

/** A workspace's skills held beside the account's own, or read again, as the window asks it: the workspace Settings shows. */
export const installedSkillFollowParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

export type InstalledSkillFollowParams = typeof installedSkillFollowParamsSchema.Type;

/** A paste previewed in the workspace whose GitHub installation reaches its source. */
export const installedSkillPreviewParamsSchema = installedSkillPreviewRequestSchema;

export type InstalledSkillPreviewParams = typeof installedSkillPreviewParamsSchema.Type;

/** A paste installed, as the service takes it. */
export const installedSkillInstallParamsSchema = installedSkillInstallRequestSchema;

export type InstalledSkillInstallParams = typeof installedSkillInstallParamsSchema.Type;

/** One skill, by id. */
export const installedSkillIdParamsSchema = EffectSchema.Struct({ skillId: wireUuidSchema });

export type InstalledSkillIdParams = typeof installedSkillIdParamsSchema.Type;

/* ----- Views ----- */

/** One skill read whole, or why it was not. */
export const installedSkillContentViewSchema = answerView(installedSkillsContract.read, {
  as: INSTALLED_SKILL_RENAMES,
});

export type InstalledSkillContentView = typeof installedSkillContentViewSchema.Type;

/** What a paste would install, or why the service did not say. */
export const installedSkillPreviewViewSchema = EffectSchema.Union([
  installedSkillPreviewSchema,
  pasteFailed,
]);

export type InstalledSkillPreviewView = typeof installedSkillPreviewViewSchema.Type;

/** The skills an install made, or why it made none. */
export const installedSkillInstallViewSchema = EffectSchema.Union([
  installedSkillInstallAnswerSchema,
  pasteFailed,
]);

export type InstalledSkillInstallView = typeof installedSkillInstallViewSchema.Type;

/** A skill removed, or why it stands. */
export const installedSkillRemovedViewSchema = answerView(installedSkillsContract.remove, {
  as: INSTALLED_SKILL_RENAMES,
});

export type InstalledSkillRemovedView = typeof installedSkillRemovedViewSchema.Type;
