import { Schema as EffectSchema } from "effect";

export const INSTALLED_SKILL_SCOPE = {
  PERSONAL: "personal",
  WORKSPACE: "workspace",
} as const;

export type InstalledSkillScope =
  (typeof INSTALLED_SKILL_SCOPE)[keyof typeof INSTALLED_SKILL_SCOPE];

export const installedSkillScopeSchema = EffectSchema.Literals(
  Object.values(INSTALLED_SKILL_SCOPE),
);

export const INSTALLED_SKILL_SOURCE = {
  GITHUB: "github",
  TEXT: "text",
} as const;

const installedSkillGithubSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.GITHUB),
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  path: EffectSchema.String,
  ref: EffectSchema.String,
  sha: EffectSchema.String,
});

const installedSkillTextSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.TEXT),
});

export const installedSkillSourceSchema = EffectSchema.Union([
  installedSkillGithubSourceSchema,
  installedSkillTextSourceSchema,
]);

export type InstalledSkillSource = typeof installedSkillSourceSchema.Type;

export const INSTALLED_SKILL_MAIN_FILE = "SKILL.md";

export const INSTALLED_SKILL_BOUNDS = {
  MAX_FILE_BYTES: 3_000_000,
} as const;

export function holdsFileTooLarge(sizes: readonly number[]): boolean {
  return sizes.some((bytes) => bytes > INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES);
}

export const INSTALLED_SKILL_REFUSAL = {
  NO_SKILL_FILE: "no-skill-file",
  SKILL_FILE_INVALID: "skill-file-invalid",
  TOO_LARGE: "too-large",
  CREDENTIAL: "credential-shaped",
} as const;

export type InstalledSkillRefusal =
  (typeof INSTALLED_SKILL_REFUSAL)[keyof typeof INSTALLED_SKILL_REFUSAL];
