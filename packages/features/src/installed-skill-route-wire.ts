import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_REFUSAL,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "./installed-skill-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { SKILL_FILE_BOUNDS } from "./skill-file.js";
import { SKILL_PASTE_KIND, SKILL_PASTE_UNSUPPORTED, SKILL_TEXT_PROBLEM } from "./skill-paste.js";

/**
 * installed-skill-route-wire.ts -- what the installed skills routes take and answer: a paste previewed, skills installed from it, and one listed, toggled, updated, or removed.
 *
 * A member installs a skill by pasting a `skills add` command or a skill's
 * text into one box (`skill-paste.ts`). The preview reads the paste as the
 * service would install it: for a GitHub source, the commit its ref stands
 * at and every skill folder found there, each with what would be installed
 * and what is wrong with it; for text, the skill it would make. An install
 * sends the same paste again, and the service reads it afresh rather than
 * trusting the preview. A skill is answered as the account sees it: whether
 * it may manage it, and who installed it.
 */

/** The list's query: the workspace whose skills are listed beside the account's own. */
export const INSTALLED_SKILL_LIST_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

/** The update check's query: the workspace whose GitHub installation reads the skill's repository. */
export const INSTALLED_SKILL_UPDATE_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

/** The longest paste a preview or an install reads: twice the largest `SKILL.md`, so one past it is answered as too large rather than refused unread. */
export const INSTALLED_SKILL_PASTE_MAX_CHARS = SKILL_FILE_BOUNDS.MAX_FILE_BYTES * 2;

/** What is wrong with a skill a preview found, as the window words it: what its text breaks, and what its files do. */
export const INSTALLED_SKILL_PROBLEM = {
  ...SKILL_TEXT_PROBLEM,
  /** A file holds a literal shaped like a provider's credential, which a skill must never carry. */
  CREDENTIAL_SHAPED: "credential-shaped",
  /** It holds more files than a skill may. */
  TOO_MANY_FILES: "too-many-files",
  /** Its files hold more bytes together than a skill may. */
  FILES_TOO_LARGE: "files-too-large",
} as const;

export type InstalledSkillProblem =
  (typeof INSTALLED_SKILL_PROBLEM)[keyof typeof INSTALLED_SKILL_PROBLEM];

const installedSkillProblemSchema = EffectSchema.Literals(Object.values(INSTALLED_SKILL_PROBLEM));

/** Why an install or an update refused a skill's files: the store's reasons, and the ones read before it. */
export const INSTALLED_SKILL_FILES_REFUSAL = {
  ...INSTALLED_SKILL_REFUSAL,
  /** Its `SKILL.md` breaks the convention: no valid name, no description, or an unclosed frontmatter. */
  SKILL_FILE_INVALID: "skill-file-invalid",
  /** Its `SKILL.md` is larger than a `SKILL.md` may be. */
  SKILL_FILE_TOO_LARGE: "skill-file-too-large",
  /** A file holds a literal shaped like a provider's credential. */
  CREDENTIAL_SHAPED: "credential-shaped",
} as const;

export type InstalledSkillFilesRefusal =
  (typeof INSTALLED_SKILL_FILES_REFUSAL)[keyof typeof INSTALLED_SKILL_FILES_REFUSAL];

/**
 * What a refused install or update carries beside its slug: the skill it
 * refused, by name, where it read one, and why its files were refused.
 */
export const installedSkillRefusedDataSchema = EffectSchema.Struct({
  skillName: EffectSchema.optionalKey(EffectSchema.String),
  skillRefusal: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(INSTALLED_SKILL_FILES_REFUSAL)),
  ),
});

/* ----- The preview ----- */

const pasteText = EffectSchema.String.check(
  EffectSchema.isMaxLength(INSTALLED_SKILL_PASTE_MAX_CHARS),
);

/** A paste to preview, read in the workspace whose GitHub installation reaches its repository. */
export const installedSkillPreviewRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
});

/** One skill folder a GitHub source holds, as an install would take it. */
const installedSkillCandidateSchema = EffectSchema.Struct({
  /** The name its `SKILL.md` declares, or its folder's where it declares none. */
  name: EffectSchema.String,
  description: EffectSchema.optionalKey(EffectSchema.String),
  /** Its folder from the repository's root; empty for a skill at the root. */
  path: EffectSchema.String,
  fileCount: countedNumber,
  bytes: countedNumber,
  /** Whether the paste asked for it: by `--skill`, `@skill`, or the folder it names, or as the one skill there is. */
  selected: EffectSchema.Boolean,
  /** What keeps it from installing; none where it installs. */
  problems: EffectSchema.Array(installedSkillProblemSchema),
});

export type InstalledSkillCandidate = typeof installedSkillCandidateSchema.Type;

const previewSourceSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.SOURCE),
  /** The repository as GitHub spells it. */
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  /** The ref read: the one the paste named, or the default branch's name. */
  ref: EffectSchema.String,
  /** The commit the ref stands at now, which an install pins its files to. */
  sha: EffectSchema.String,
  /** The skill names the paste asked for that no folder holds. */
  missing: EffectSchema.Array(EffectSchema.String),
  skills: EffectSchema.Array(installedSkillCandidateSchema),
});

const previewTextSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.TEXT),
  name: EffectSchema.optionalKey(EffectSchema.String),
  description: EffectSchema.optionalKey(EffectSchema.String),
  bytes: countedNumber,
  problems: EffectSchema.Array(installedSkillProblemSchema),
});

const previewUnsupportedSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.UNSUPPORTED),
  reason: EffectSchema.Literals(Object.values(SKILL_PASTE_UNSUPPORTED)),
});

const previewEmptySchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.EMPTY),
});

/** What a paste would install: a GitHub source's skills, a skill's text, or why nothing. */
export const installedSkillPreviewSchema = EffectSchema.Union([
  previewSourceSchema,
  previewTextSchema,
  previewUnsupportedSchema,
  previewEmptySchema,
]);

export type InstalledSkillPreview = typeof installedSkillPreviewSchema.Type;

/* ----- A skill ----- */

/** One installed skill as the account sees it. */
export const installedSkillSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: installedSkillScopeSchema,
  name: EffectSchema.String,
  description: EffectSchema.String,
  userInvocable: EffectSchema.Boolean,
  source: installedSkillSourceSchema,
  enabled: EffectSchema.Boolean,
  /** The workspace a workspace skill is; absent for a personal one. */
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  /** Who installed it; null once their account is gone. */
  installedBy: EffectSchema.NullOr(EffectSchema.String),
  /** Whether the account may update, toggle, and remove it: its own personal skill, or its workspace's as an owner or admin. */
  manageable: EffectSchema.Boolean,
  createdAt: EffectSchema.Number,
  updatedAt: EffectSchema.Number,
});

export type InstalledSkillSummary = typeof installedSkillSummarySchema.Type;

/** The skills the account sees in a workspace: the workspace's, then its own. */
export const installedSkillListAnswerSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillSummarySchema),
});

/* ----- Install, toggle, update ----- */

/**
 * An install: the paste, read afresh; whose the skills are; for a source,
 * the skills chosen by name, where the paste's own choice or its one skill
 * is not meant; and for text, the name and description it lacks.
 */
export const installedSkillInstallRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
  scope: installedSkillScopeSchema,
  skills: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.NonEmptyString)),
  name: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  description: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

/** The skills an install made, in the order asked. */
export const installedSkillInstallAnswerSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillSummarySchema),
});

/** A skill turned on or off. */
export const installedSkillToggleRequestSchema = EffectSchema.Struct({
  enabled: EffectSchema.Boolean,
});

/** A skill as a write left it. */
export const installedSkillAnswerSchema = EffectSchema.Struct({
  skill: installedSkillSummarySchema,
});

/** An update, read in the workspace whose GitHub installation reaches the skill's repository. */
export const installedSkillUpdateRequestSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

/** A skill as an update left it, and whether its files changed. */
export const installedSkillUpdatedAnswerSchema = EffectSchema.Struct({
  skill: installedSkillSummarySchema,
  changed: EffectSchema.Boolean,
});

/**
 * Whether a GitHub skill's folder moved since it was installed: its ref's
 * commit now, and whether the folder there differs from the one pinned.
 * A pasted skill has nothing to update from.
 */
export const installedSkillUpdateCheckSchema = EffectSchema.Struct({
  available: EffectSchema.Boolean,
  /** The commit the skill's ref stands at now; absent for a pasted skill. */
  latestSha: EffectSchema.optionalKey(EffectSchema.String),
});

export type InstalledSkillUpdateCheck = typeof installedSkillUpdateCheckSchema.Type;

/** A skill removed. */
export const installedSkillRemovedAnswerSchema = EffectSchema.Struct({
  id: EffectSchema.String,
});
