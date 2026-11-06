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

export const INSTALLED_SKILL_CALL_FAILURE = {
  ...INSTALLED_SKILL_REFUSAL,
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  NOT_PERMITTED: "not-permitted",
  INVALID: "invalid",
  NAME_TAKEN: "name-taken",
  UNREACHABLE: "repository-not-reachable",
  GITHUB_UNANSWERED: "github-unanswered",
} as const;

export type InstalledSkillCallFailure =
  (typeof INSTALLED_SKILL_CALL_FAILURE)[keyof typeof INSTALLED_SKILL_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INSTALLED_SKILL_CALL_FAILURE)),
  skillName: EffectSchema.optionalKey(EffectSchema.String),
});

export type InstalledSkillFailedView = typeof failed.Type;

export const installedSkillFollowParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

export type InstalledSkillFollowParams = typeof installedSkillFollowParamsSchema.Type;

export const installedSkillPreviewParamsSchema = installedSkillPreviewRequestSchema;

export type InstalledSkillPreviewParams = typeof installedSkillPreviewParamsSchema.Type;

export const installedSkillInstallParamsSchema = installedSkillInstallRequestSchema;

export type InstalledSkillInstallParams = typeof installedSkillInstallParamsSchema.Type;

export const installedSkillIdParamsSchema = EffectSchema.Struct({ skillId: wireUuidSchema });

export type InstalledSkillIdParams = typeof installedSkillIdParamsSchema.Type;

export const installedSkillContentViewSchema = EffectSchema.Union([
  installedSkillContentSchema,
  failed,
]);

export type InstalledSkillContentView = typeof installedSkillContentViewSchema.Type;

export const installedSkillPreviewViewSchema = EffectSchema.Union([
  installedSkillPreviewSchema,
  failed,
]);

export type InstalledSkillPreviewView = typeof installedSkillPreviewViewSchema.Type;

export const installedSkillInstallViewSchema = EffectSchema.Union([
  installedSkillInstallAnswerSchema,
  failed,
]);

export type InstalledSkillInstallView = typeof installedSkillInstallViewSchema.Type;

export const installedSkillRemovedViewSchema = EffectSchema.Union([
  installedSkillRemovedAnswerSchema,
  failed,
]);

export type InstalledSkillRemovedView = typeof installedSkillRemovedViewSchema.Type;
