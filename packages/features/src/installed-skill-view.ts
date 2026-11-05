import { Schema as EffectSchema } from "effect";
import {
  installedSkillContentSchema,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillPreviewRequestSchema,
  installedSkillPreviewSchema,
  installedSkillRemovedAnswerSchema,
} from "./installed-skill-route-wire.js";
import { INSTALLED_SKILL_REFUSAL } from "./installed-skill-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * installed-skill-view.ts -- the skills a member installs into the app as one window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf
 * (`installed-skill-client.ts`) and answers the window one of the shapes
 * here: the service's answer, or why there is none, with the skill it
 * names where the service said. Settings › Skills
 * draws the skills the host holds for it (`installed-skill-live.ts`), and
 * its Add skill dialog previews and installs a paste.
 */

/** Why an installed skills call has no answer: a skill refused, for the store's reason, or the call's own failure. */
export const INSTALLED_SKILL_CALL_FAILURE = {
  ...INSTALLED_SKILL_REFUSAL,
  /** The call never reached an answer: no credential, the network, a refusal not named here, a shape not read. */
  UNANSWERED: "unanswered",
  /** The workspace is none the account is in, or the skill none it sees. */
  NOT_FOUND: "not-found",
  /** The account sees the skill or the workspace but may not do this: a workspace skill takes an owner or admin. */
  NOT_PERMITTED: "not-permitted",
  /** The request is none the service takes: nothing to install in the paste, or a workspace skill in a personal workspace. */
  INVALID: "invalid",
  /** A skill of that name is already installed in the scope asked. */
  NAME_TAKEN: "name-taken",
  /** GitHub serves the repository, or its ref, to none of the workspace's GitHub installation, the member's own token, and an anonymous read. */
  UNREACHABLE: "repository-not-reachable",
  /** GitHub did not answer, or is rate limiting; the same call later may be answered. */
  GITHUB_UNANSWERED: "github-unanswered",
} as const;

export type InstalledSkillCallFailure =
  (typeof INSTALLED_SKILL_CALL_FAILURE)[keyof typeof INSTALLED_SKILL_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INSTALLED_SKILL_CALL_FAILURE)),
  /** The skill refused, by name, where the service read one. */
  skillName: EffectSchema.optionalKey(EffectSchema.String),
});

export type InstalledSkillFailedView = typeof failed.Type;

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
export const installedSkillContentViewSchema = EffectSchema.Union([
  installedSkillContentSchema,
  failed,
]);

export type InstalledSkillContentView = typeof installedSkillContentViewSchema.Type;

/** What a paste would install, or why the service did not say. */
export const installedSkillPreviewViewSchema = EffectSchema.Union([
  installedSkillPreviewSchema,
  failed,
]);

export type InstalledSkillPreviewView = typeof installedSkillPreviewViewSchema.Type;

/** The skills an install made, or why it made none. */
export const installedSkillInstallViewSchema = EffectSchema.Union([
  installedSkillInstallAnswerSchema,
  failed,
]);

export type InstalledSkillInstallView = typeof installedSkillInstallViewSchema.Type;

/** A skill removed, or why it stands. */
export const installedSkillRemovedViewSchema = EffectSchema.Union([
  installedSkillRemovedAnswerSchema,
  failed,
]);

export type InstalledSkillRemovedView = typeof installedSkillRemovedViewSchema.Type;
