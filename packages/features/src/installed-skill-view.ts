import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  installedSkillAnswerSchema,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillListAnswerSchema,
  installedSkillPreviewFileRequestSchema,
  installedSkillPreviewFileSchema,
  installedSkillPreviewRequestSchema,
  installedSkillPreviewSchema,
  installedSkillRemovedAnswerSchema,
  installedSkillUpdateCheckSchema,
  installedSkillUpdatedAnswerSchema,
} from "./installed-skill-route-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * installed-skill-view.ts -- the skills a member installs into Luke as one window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf
 * (`installed-skill-client.ts`) and answers the window one of the shapes
 * here: the service's answer, or the failure with the skill it names and
 * why its files were refused, where the service said. Settings › Skills
 * draws them, and its Add skill dialog previews and installs a paste.
 */

/** Why an installed skills call has no answer. */
export const INSTALLED_SKILL_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal not named here, a shape not read. */
  UNANSWERED: "unanswered",
  /** The workspace is none the account is in, or the skill none it sees. */
  NOT_FOUND: "not-found",
  /** The account sees the skill or the workspace but may not do this: a workspace skill takes an owner or admin. */
  NOT_PERMITTED: "not-permitted",
  /** The request is none the service takes: nothing to install in the paste, a skill named that the source does not hold, a workspace skill in a personal workspace, or an update of a pasted skill. */
  INVALID: "invalid",
  /** A skill of that name is already installed in the scope asked. */
  NAME_TAKEN: "name-taken",
  /** A skill's files were refused, for the reason the failure carries. */
  FILES_REFUSED: "files-refused",
  /** Neither the workspace's GitHub installation, the member's own token, nor an anonymous read reaches the repository. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** The branch, tag, or commit the source names is none of the repository's. */
  REF_NOT_FOUND: "ref-not-found",
  /** GitHub did not answer, or is rate limiting; the same call later may be answered. */
  GITHUB_UNANSWERED: "github-unanswered",
} as const;

export type InstalledSkillCallFailure =
  (typeof INSTALLED_SKILL_CALL_FAILURE)[keyof typeof INSTALLED_SKILL_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INSTALLED_SKILL_CALL_FAILURE)),
  /** The skill refused, by name, where the service read one. */
  skillName: EffectSchema.optionalKey(EffectSchema.String),
  /** Why its files were refused, where that is the failure. */
  skillRefusal: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(INSTALLED_SKILL_FILES_REFUSAL)),
  ),
});

export type InstalledSkillFailedView = typeof failed.Type;

/* ----- Params ----- */

/** A workspace's skills listed beside the account's own. */
export const installedSkillListParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

export type InstalledSkillListParams = typeof installedSkillListParamsSchema.Type;

/** A paste previewed in the workspace whose GitHub installation reaches its source. */
export const installedSkillPreviewParamsSchema = installedSkillPreviewRequestSchema;

export type InstalledSkillPreviewParams = typeof installedSkillPreviewParamsSchema.Type;

/** A previewed skill's `SKILL.md` asked for by the repository, commit, and folder the preview named. */
export const installedSkillPreviewFileParamsSchema = installedSkillPreviewFileRequestSchema;

export type InstalledSkillPreviewFileParams = typeof installedSkillPreviewFileParamsSchema.Type;

/** A paste installed, as the service takes it. */
export const installedSkillInstallParamsSchema = installedSkillInstallRequestSchema;

export type InstalledSkillInstallParams = typeof installedSkillInstallParamsSchema.Type;

/** One skill turned on or off. */
export const installedSkillToggleParamsSchema = EffectSchema.Struct({
  skillId: wireUuidSchema,
  enabled: EffectSchema.Boolean,
});

export type InstalledSkillToggleParams = typeof installedSkillToggleParamsSchema.Type;

/** One skill checked for an update or updated, read in the workspace whose GitHub installation reaches its repository. */
export const installedSkillUpdateParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  skillId: wireUuidSchema,
});

export type InstalledSkillUpdateParams = typeof installedSkillUpdateParamsSchema.Type;

/** One skill, by id. */
export const installedSkillIdParamsSchema = EffectSchema.Struct({ skillId: wireUuidSchema });

export type InstalledSkillIdParams = typeof installedSkillIdParamsSchema.Type;

/* ----- Views ----- */

/** The skills the account sees in a workspace, or why there are none. */
export const installedSkillListViewSchema = EffectSchema.Union([
  installedSkillListAnswerSchema,
  failed,
]);

export type InstalledSkillListView = typeof installedSkillListViewSchema.Type;

/** What a paste would install, or why the service did not say. */
export const installedSkillPreviewViewSchema = EffectSchema.Union([
  installedSkillPreviewSchema,
  failed,
]);

export type InstalledSkillPreviewView = typeof installedSkillPreviewViewSchema.Type;

/** A previewed skill's `SKILL.md`, or why the service did not answer it. */
export const installedSkillPreviewFileViewSchema = EffectSchema.Union([
  installedSkillPreviewFileSchema,
  failed,
]);

export type InstalledSkillPreviewFileView = typeof installedSkillPreviewFileViewSchema.Type;

/** The skills an install made, or why it made none. */
export const installedSkillInstallViewSchema = EffectSchema.Union([
  installedSkillInstallAnswerSchema,
  failed,
]);

export type InstalledSkillInstallView = typeof installedSkillInstallViewSchema.Type;

/** One skill as a toggle left it, or why it is unchanged. */
export const installedSkillViewSchema = EffectSchema.Union([installedSkillAnswerSchema, failed]);

export type InstalledSkillView = typeof installedSkillViewSchema.Type;

/** Whether a skill's folder moved at its ref, or why that is unknown. */
export const installedSkillUpdateCheckViewSchema = EffectSchema.Union([
  installedSkillUpdateCheckSchema,
  failed,
]);

export type InstalledSkillUpdateCheckView = typeof installedSkillUpdateCheckViewSchema.Type;

/** A skill as an update left it, or why it is unchanged. */
export const installedSkillUpdatedViewSchema = EffectSchema.Union([
  installedSkillUpdatedAnswerSchema,
  failed,
]);

export type InstalledSkillUpdatedView = typeof installedSkillUpdatedViewSchema.Type;

/** A skill removed, or why it stands. */
export const installedSkillRemovedViewSchema = EffectSchema.Union([
  installedSkillRemovedAnswerSchema,
  failed,
]);

export type InstalledSkillRemovedView = typeof installedSkillRemovedViewSchema.Type;
