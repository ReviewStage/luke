/**
 * skill-check.ts -- what keeps a skill's files from installing, read before anything is written: its `SKILL.md` held to the convention, its files to a skill's bounds, and every file to the credential-shape scan.
 *
 * A pasted skill is read by `parseSkillPaste`; a skill found in a
 * repository by its `SKILL.md`'s own frontmatter, named by its folder
 * where it declares no name, as the `skills` tool names one. Either way
 * the same problems are answered, so the preview says what an install
 * would refuse, and an install refuses exactly those.
 *
 * The credential shapes are the repository check's own
 * (`scripts/repository-checks.sh`): a live provider key, a GitHub token, a
 * Slack token, an AWS access key id, or a private key block. A skill is
 * instructions and scripts handed to every agent that loads it, so one
 * carrying a credential would hand it on; it is refused rather than
 * redacted, since the skill is the member's to mend.
 */

import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillFilesRefusal,
  type InstalledSkillProblem,
} from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
} from "@luke/features/installed-skill-wire";
import {
  readSkillFile,
  SKILL_FILE_BOUNDS,
  SKILL_KEY,
  SKILL_NAME_RULE,
} from "@luke/features/skill-file";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";

/** The repository check's provider-credential shapes, kept in step with `scripts/repository-checks.sh`. */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /sk_live_[0-9A-Za-z]{24,}/u,
  /gh[pousr]_[A-Za-z0-9]{36}/u,
  /github_pat_[A-Za-z0-9_]{22,}/u,
  /xox[baprs]-[0-9]+-/u,
  /AKIA[0-9A-Z]{16}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

/** What a skill's `SKILL.md` says of it, and what keeps it from installing. */
export interface CheckedSkill {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly userInvocable: boolean;
  /** Whether its `metadata` marks it internal, which the `skills` tool hides unless it is named. */
  readonly internal: boolean;
  readonly problems: readonly InstalledSkillProblem[];
}

/** The key under which a `SKILL.md` keeps the metadata an internal skill is marked in. */
const METADATA_KEY = "metadata";

/** `internal: true` among the metadata's keys, as the frontmatter reader folds a nested mapping into one line. */
const INTERNAL_MARK = /(?:^|\s)internal:\s+true(?:\s|$)/u;

/** A file's bytes as text, read leniently: a binary file reads as noise, which no credential shape matches by chance. */
export function fileText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Whether the text holds a literal shaped like a provider's credential. */
export function holdsCredentialShape(text: string): boolean {
  return CREDENTIAL_SHAPES.some((shape) => shape.test(text));
}

/** The problems of a skill's files as a set: too many, too many bytes, or one carrying a credential. */
export function filesProblems(
  files: readonly { readonly bytes: number }[],
): readonly InstalledSkillProblem[] {
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  return [
    ...(files.length > INSTALLED_SKILL_BOUNDS.MAX_FILES
      ? [INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES]
      : []),
    ...(bytes > INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES
      ? [INSTALLED_SKILL_PROBLEM.FILES_TOO_LARGE]
      : []),
  ];
}

/**
 * A repository skill's `SKILL.md` read as an install takes it: the name it
 * declares, or its folder's; its description; and what it breaks of the
 * convention or the credential scan.
 */
export function checkSkillFile(text: string, folderName: string): CheckedSkill {
  const problems: InstalledSkillProblem[] = [];
  if (new TextEncoder().encode(text).byteLength > SKILL_FILE_BOUNDS.MAX_FILE_BYTES) {
    problems.push(INSTALLED_SKILL_PROBLEM.TOO_LARGE);
  }
  const file = readSkillFile(text);
  if (file === undefined) problems.push(INSTALLED_SKILL_PROBLEM.FRONTMATTER_UNCLOSED);
  const declared = file?.keys.get(SKILL_KEY.NAME)?.trim();
  const name = declared === undefined || declared === "" ? folderName : declared;
  if (name === "") problems.push(INSTALLED_SKILL_PROBLEM.NAME_MISSING);
  else if (!SKILL_NAME_RULE.test(name)) problems.push(INSTALLED_SKILL_PROBLEM.NAME_INVALID);
  const description = file?.keys.get(SKILL_KEY.DESCRIPTION)?.trim() ?? "";
  if (description === "") problems.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING);
  else if (description.length > TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS) {
    problems.push(INSTALLED_SKILL_PROBLEM.DESCRIPTION_TOO_LONG);
  }
  if (holdsCredentialShape(text)) problems.push(INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED);
  return {
    name: name === "" ? undefined : name,
    description: description === "" ? undefined : description,
    userInvocable: file?.keys.get(SKILL_KEY.USER_INVOCABLE)?.trim() !== "false",
    internal: INTERNAL_MARK.test(file?.keys.get(METADATA_KEY) ?? ""),
    problems,
  };
}

/** Whether a skill's files hold its `SKILL.md` at their root. */
export function holdsSkillFile(files: readonly { readonly path: string }[]): boolean {
  return files.some((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
}

/** Why an install refuses a skill with the problem given, as the refusal names it. */
export function refusalOf(problem: InstalledSkillProblem): InstalledSkillFilesRefusal {
  switch (problem) {
    case INSTALLED_SKILL_PROBLEM.TOO_LARGE:
      return INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_TOO_LARGE;
    case INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED:
      return INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED;
    case INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES:
      return INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES;
    case INSTALLED_SKILL_PROBLEM.FILES_TOO_LARGE:
      return INSTALLED_SKILL_FILES_REFUSAL.TOO_LARGE;
    default:
      return INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_INVALID;
  }
}
