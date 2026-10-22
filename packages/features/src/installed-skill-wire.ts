import { Schema as EffectSchema } from "effect";

/**
 * installed-skill-wire.ts -- a skill a member installs into Luke: whose it is, where it came from, and how large it may be.
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

export type InstalledSkillSourceType =
  (typeof INSTALLED_SKILL_SOURCE)[keyof typeof INSTALLED_SKILL_SOURCE];

/** A skill read from GitHub: the repository, its folder, the ref asked for, and the commit it resolved to, which the files are pinned at. */
export const installedSkillGithubSourceSchema = EffectSchema.Struct({
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
export const installedSkillTextSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.TEXT),
});

export const installedSkillSourceSchema = EffectSchema.Union([
  installedSkillGithubSourceSchema,
  installedSkillTextSourceSchema,
]);

export type InstalledSkillSource = typeof installedSkillSourceSchema.Type;

/** The file every skill holds at its folder's root: its frontmatter and its procedure. */
export const INSTALLED_SKILL_MAIN_FILE = "SKILL.md";

/** The bounds on one installed skill's files, past which an install or update is refused. */
export const INSTALLED_SKILL_BOUNDS = {
  /** The most files a skill holds, its `SKILL.md` among them. */
  MAX_FILES: 64,
  /** The most bytes a skill's files hold together; a single file is held to it too. */
  MAX_TOTAL_BYTES: 1024 * 1024,
} as const;

/** Why a skill's files were refused. */
export const INSTALLED_SKILL_REFUSAL = {
  /** None of its files is `SKILL.md` at its root. */
  NO_SKILL_FILE: "no-skill-file",
  /** Two of its files share one path. */
  DUPLICATE_PATH: "duplicate-path",
  /** More files than `INSTALLED_SKILL_BOUNDS.MAX_FILES`. */
  TOO_MANY_FILES: "too-many-files",
  /** More bytes than `INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES`. */
  TOO_LARGE: "too-large",
} as const;

export type InstalledSkillRefusal =
  (typeof INSTALLED_SKILL_REFUSAL)[keyof typeof INSTALLED_SKILL_REFUSAL];
