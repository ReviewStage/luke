import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_REFUSAL,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "./installed-skill-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { SKILL_FILE_BOUNDS } from "./skill-file.js";

export const INSTALLED_SKILL_LIST_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

export const INSTALLED_SKILL_PASTE_MAX_CHARS = SKILL_FILE_BOUNDS.MAX_FILE_BYTES * 2;

export const installedSkillRefusedDataSchema = EffectSchema.Struct({
  skillName: EffectSchema.optionalKey(EffectSchema.String),
  skillRefusal: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(INSTALLED_SKILL_REFUSAL)),
  ),
});

export const SKILL_PASTE_KIND = {
  SOURCE: "source",
  TEXT: "text",
  UNSUPPORTED: "unsupported",
} as const;

const pasteText = EffectSchema.String.check(
  EffectSchema.isMaxLength(INSTALLED_SKILL_PASTE_MAX_CHARS),
);

const commitShaSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{40}$/u));

export const installedSkillPreviewRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
});

const installedSkillCandidateSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  description: EffectSchema.optionalKey(EffectSchema.String),
  path: EffectSchema.String,
  bytes: countedNumber,
  selected: EffectSchema.Boolean,
  fileCount: countedNumber,
  problems: EffectSchema.Tuple([]),
});

export type InstalledSkillCandidate = typeof installedSkillCandidateSchema.Type;

const previewSourceSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.SOURCE),
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  ref: EffectSchema.String,
  sha: EffectSchema.String,
  skills: EffectSchema.Array(installedSkillCandidateSchema),
  missing: EffectSchema.Tuple([]),
});

const previewTextSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.TEXT),
  name: EffectSchema.optionalKey(EffectSchema.String),
  description: EffectSchema.optionalKey(EffectSchema.String),
  bytes: countedNumber,
  problems: EffectSchema.Tuple([]),
});

const UNSUPPORTED_REASON = "other-host";

const previewUnsupportedSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.UNSUPPORTED),
  reason: EffectSchema.Literal(UNSUPPORTED_REASON),
});

export const installedSkillPreviewSchema = EffectSchema.Union([
  previewSourceSchema,
  previewTextSchema,
  previewUnsupportedSchema,
]);

export type InstalledSkillPreview = typeof installedSkillPreviewSchema.Type;

export const UNSUPPORTED_PREVIEW = {
  kind: SKILL_PASTE_KIND.UNSUPPORTED,
  reason: UNSUPPORTED_REASON,
} as const satisfies InstalledSkillPreview;

const installedSkillSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: installedSkillScopeSchema,
  name: EffectSchema.String,
  description: EffectSchema.String,
  userInvocable: EffectSchema.Boolean,
  source: installedSkillSourceSchema,
  enabled: EffectSchema.Literal(true),
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  installedBy: EffectSchema.NullOr(EffectSchema.String),
  manageable: EffectSchema.Boolean,
  createdAt: EffectSchema.Number,
  updatedAt: EffectSchema.Number,
});

export type InstalledSkillSummary = typeof installedSkillSummarySchema.Type;

export const installedSkillListAnswerSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillSummarySchema),
});

const installedSkillFileEntrySchema = EffectSchema.Struct({
  path: EffectSchema.String,
  bytes: countedNumber,
});

export const installedSkillContentSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  skillFile: EffectSchema.String,
  files: EffectSchema.Array(installedSkillFileEntrySchema),
});

export type InstalledSkillContent = typeof installedSkillContentSchema.Type;

export const installedSkillInstallRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
  scope: installedSkillScopeSchema,
  skills: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.NonEmptyString)),
  sha: EffectSchema.optionalKey(commitShaSchema),
  name: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  description: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

const txid = EffectSchema.optionalKey(EffectSchema.String);

export const installedSkillInstallAnswerSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillSummarySchema),
  txid,
});

export const installedSkillRemovedAnswerSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  txid,
});
