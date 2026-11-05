import { Schema as EffectSchema } from "effect";

/**
 * installed-skill-wire.ts -- a skill a member installs into the app: whose it is, where it came from, and how large its files may be.
 *
 * A repository's skills are read from GitHub at session start; an installed
 * skill is kept by the service itself, its files stored beside it, and
 * offered to agents beside the repository's. It is one member's, account-wide
 * and following them into every workspace (`personal`), or one workspace's,
 * offered to every member's agents there (`workspace`). Its source says where
 * its files came from: a GitHub folder pinned to the commit it was read at,
 * or text the member pasted. The shapes here are what the store keeps
 * (`packages/database/src/schemas/installed-skill.ts`) and what the routes
 * answer, declared once. The name rule and the `SKILL.md` bound are the
 * repository skills' own, which the store's checks hold too.
 */

/** Whose an installed skill is. */
export const INSTALLED_SKILL_SCOPE = {
  /** Its installer's alone, in every workspace they are a member of. */
  PERSONAL: "personal",
  /** Its workspace's: every member installs one and their agents use it; its installer and the workspace's owners and admins change it. */
  WORKSPACE: "workspace",
} as const;

export type InstalledSkillScope =
  (typeof INSTALLED_SKILL_SCOPE)[keyof typeof INSTALLED_SKILL_SCOPE];

export const installedSkillScopeSchema = EffectSchema.Literals(
  Object.values(INSTALLED_SKILL_SCOPE),
);

/** Where an installed skill's files came from. */
export const INSTALLED_SKILL_SOURCE = {
  /** A folder of a GitHub repository, read at one commit. */
  GITHUB: "github",
  /** A `SKILL.md` the member pasted. */
  TEXT: "text",
} as const;

/** A skill read from GitHub: the repository, its folder, the ref asked for, and the commit it resolved to, which the files are pinned at. */
const installedSkillGithubSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.GITHUB),
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  /** The skill's folder from the repository's root, such as `skills/frontend-design`. */
  path: EffectSchema.String,
  /** The branch, tag, or commit asked for; the default branch's name where none was. */
  ref: EffectSchema.String,
  /** The commit `ref` resolved to when the files were read. */
  sha: EffectSchema.String,
});

/** A skill pasted as text. */
const installedSkillTextSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.TEXT),
});

export const installedSkillSourceSchema = EffectSchema.Union([
  installedSkillGithubSourceSchema,
  installedSkillTextSourceSchema,
]);

export type InstalledSkillSource = typeof installedSkillSourceSchema.Type;

/** The file every skill holds at its folder's root: its frontmatter and its procedure. */
export const INSTALLED_SKILL_MAIN_FILE = "SKILL.md";

/** The bound on an installed skill's files, past which an install or update is refused: each file's bytes, whatever the skill holds together. */
export const INSTALLED_SKILL_BOUNDS = {
  /** The most bytes one file holds: 3 MB, which a Mac takes whole in one queued message once base64 swells it to 4 MB. */
  MAX_FILE_BYTES: 3_000_000,
} as const;

/** Whether any of the files, by their sizes, is larger than one may be. */
export function holdsFileTooLarge(sizes: readonly number[]): boolean {
  return sizes.some((bytes) => bytes > INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES);
}

/** Why a skill's files were refused. */
export const INSTALLED_SKILL_REFUSAL = {
  /** None of its files is `SKILL.md` at its root. */
  NO_SKILL_FILE: "no-skill-file",
  /** A file larger than `INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES`. */
  TOO_LARGE: "too-large",
} as const;

export type InstalledSkillRefusal =
  (typeof INSTALLED_SKILL_REFUSAL)[keyof typeof INSTALLED_SKILL_REFUSAL];
