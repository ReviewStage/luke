import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_REFUSAL,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "./installed-skill-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { SKILL_FILE_BOUNDS } from "./skill-file.js";

/**
 * installed-skill-route-wire.ts -- what the installed skills routes take and answer: a paste previewed, skills installed from it, and one listed, read, toggled, updated, shared, or removed.
 *
 * A member installs a skill by pasting a GitHub repository, a link to one
 * of its folders, an `npx skills add` line naming one, or a skill's text
 * into one box. The preview reads a GitHub source at the commit its ref
 * stands at and lists every skill folder there; for text, it says the
 * name and description the text declares. An install sends the paste
 * again with the commit the preview pinned, and the service reads it
 * afresh rather than trusting the preview. A skill is answered as the
 * account sees it: whether it may manage it, and who installed it.
 *
 * Desktops released before this read a preview through a wider schema,
 * so the fields it requires are still answered here, empty where nothing
 * reads them now.
 */

/** The list's query: the workspace whose skills are listed beside the account's own. */
export const INSTALLED_SKILL_LIST_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

/** The longest paste a preview or an install reads: twice the largest `SKILL.md`. */
export const INSTALLED_SKILL_PASTE_MAX_CHARS = SKILL_FILE_BOUNDS.MAX_FILE_BYTES * 2;

/**
 * What a refused install or update carries beside its slug: the skill it
 * refused, by name, where it read one, and why.
 */
export const installedSkillRefusedDataSchema = EffectSchema.Struct({
  skillName: EffectSchema.optionalKey(EffectSchema.String),
  skillRefusal: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(INSTALLED_SKILL_REFUSAL)),
  ),
});

/* ----- The preview ----- */

/** What a preview read a paste as. */
export const SKILL_PASTE_KIND = {
  /** A GitHub repository, or one of its folders. */
  SOURCE: "source",
  /** A skill's own text. */
  TEXT: "text",
  /** Neither: we install from GitHub alone. */
  UNSUPPORTED: "unsupported",
} as const;

const pasteText = EffectSchema.String.check(
  EffectSchema.isMaxLength(INSTALLED_SKILL_PASTE_MAX_CHARS),
);

/** A full commit sha, which pins a read to the tree a preview answered. */
const commitShaSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{40}$/u));

/** A paste to preview, read in the workspace whose GitHub installation reaches its repository. */
export const installedSkillPreviewRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
});

/** One skill folder a GitHub source holds. */
const installedSkillCandidateSchema = EffectSchema.Struct({
  /** The name its `SKILL.md` declares, or its folder's where it declares none. */
  name: EffectSchema.String,
  description: EffectSchema.optionalKey(EffectSchema.String),
  /** Its folder from the repository's root; empty for a skill at the root. */
  path: EffectSchema.String,
  /** Its files' bytes together. */
  bytes: countedNumber,
  /** Whether the paste named it with `--skill`, or it is the one skill there is. */
  selected: EffectSchema.Boolean,
  /** How many files it holds; kept for desktops released before this, which require it. */
  fileCount: countedNumber,
  /** Always empty, since an install checks each skill; kept for desktops released before this, which require it. */
  problems: EffectSchema.Tuple([]),
});

export type InstalledSkillCandidate = typeof installedSkillCandidateSchema.Type;

const previewSourceSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.SOURCE),
  /** The repository as GitHub spells it, or as pasted where it was read anonymously. */
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  /** The ref read: the one the paste named, else the default branch's name, or `HEAD` where the repository was read anonymously. */
  ref: EffectSchema.String,
  /** The commit the ref stands at now, which an install pins its files to. */
  sha: EffectSchema.String,
  skills: EffectSchema.Array(installedSkillCandidateSchema),
  /** Always empty; kept for desktops released before this, which require it. */
  missing: EffectSchema.Tuple([]),
});

const previewTextSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.TEXT),
  /** What the text's frontmatter declares, which the dialog's fields start from. */
  name: EffectSchema.optionalKey(EffectSchema.String),
  description: EffectSchema.optionalKey(EffectSchema.String),
  /** Kept for desktops released before this, which require them. */
  bytes: countedNumber,
  problems: EffectSchema.Tuple([]),
});

/** Why a released desktop reads an unsupported paste: the one reason it words as GitHub alone. */
const UNSUPPORTED_REASON = "other-host";

const previewUnsupportedSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(SKILL_PASTE_KIND.UNSUPPORTED),
  /** Kept for desktops released before this, which require it. */
  reason: EffectSchema.Literal(UNSUPPORTED_REASON),
});

/** What a paste would install: a GitHub source's skills, a skill's text, or nothing. */
export const installedSkillPreviewSchema = EffectSchema.Union([
  previewSourceSchema,
  previewTextSchema,
  previewUnsupportedSchema,
]);

export type InstalledSkillPreview = typeof installedSkillPreviewSchema.Type;

/** A paste no preview installs from, as the service answers it. */
export const UNSUPPORTED_PREVIEW = {
  kind: SKILL_PASTE_KIND.UNSUPPORTED,
  reason: UNSUPPORTED_REASON,
} as const satisfies InstalledSkillPreview;

/* ----- A skill ----- */

/** One installed skill as the account sees it. */
const installedSkillSummarySchema = EffectSchema.Struct({
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

/** One file of an installed skill as a read lists it: its path from the skill's folder and its size. */
const installedSkillFileEntrySchema = EffectSchema.Struct({
  path: EffectSchema.String,
  bytes: countedNumber,
});

/** One installed skill read whole, for a member to see what it says before they trust it: its `SKILL.md` text and every file, in path order. */
export const installedSkillContentSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** Its `SKILL.md`, read as UTF-8. */
  skillFile: EffectSchema.String,
  files: EffectSchema.Array(installedSkillFileEntrySchema),
});

export type InstalledSkillContent = typeof installedSkillContentSchema.Type;

/* ----- Install, toggle, update, share ----- */

/**
 * An install: the paste, read afresh; whose the skills are; for a source,
 * the skills chosen by name and the commit the preview pinned, which a
 * desktop released before this sends none of; and for text, the name and
 * description to install it by, its frontmatter's where none is sent.
 */
export const installedSkillInstallRequestSchema = EffectSchema.Struct({
  text: pasteText,
  workspaceId: EffectSchema.NonEmptyString,
  scope: installedSkillScopeSchema,
  skills: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.NonEmptyString)),
  sha: EffectSchema.optionalKey(commitShaSchema),
  name: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  description: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

/**
 * The transaction a write committed in, which a reader following the skills
 * waits for (`installed-skill-live.ts`); a service from before it answers
 * none.
 */
const txid = EffectSchema.optionalKey(EffectSchema.String);

/** The skills an install made, in the order asked, and the transaction they were made in. */
export const installedSkillInstallAnswerSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillSummarySchema),
  txid,
});

/** A skill turned on or off. */
export const installedSkillToggleRequestSchema = EffectSchema.Struct({
  enabled: EffectSchema.Boolean,
});

/** A skill as a toggle or a share left it, and the transaction it committed in. */
export const installedSkillAnswerSchema = EffectSchema.Struct({
  skill: installedSkillSummarySchema,
  txid,
});

/** An update, read in the workspace whose GitHub installation reaches the skill's repository. */
export const installedSkillUpdateRequestSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

/** A skill as an update left it, whether its files changed, and the transaction it committed in. */
export const installedSkillUpdatedAnswerSchema = EffectSchema.Struct({
  skill: installedSkillSummarySchema,
  changed: EffectSchema.Boolean,
  txid,
});

/** A personal skill shared with the workspace named, which it moves into. */
export const installedSkillShareRequestSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

/** A skill removed, and the transaction it was removed in. */
export const installedSkillRemovedAnswerSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  txid,
});
