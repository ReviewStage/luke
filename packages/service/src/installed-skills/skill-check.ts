/**
 * skill-check.ts -- what a skill's `SKILL.md` says of it, and the one check an install holds a skill to before anything is written.
 *
 * A skill is named by its `SKILL.md`'s frontmatter, or by its folder where
 * it declares no name, as the `skills` tool names one. An install refuses
 * a skill with no `SKILL.md`, a file past its bound, a name off the rule
 * or no description, or a file shaped like a credential, in that order.
 *
 * The credential shapes are the repository check's own
 * (`scripts/repository-checks.sh`): a live provider key, a GitHub token, a
 * Slack token, an AWS access key id, or a private key block. A skill is
 * instructions and scripts handed to every agent that loads it, so one
 * carrying a credential would hand it on; it is refused rather than
 * redacted, since the skill is the member's to mend.
 */

import {
  holdsFileTooLarge,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
  type InstalledSkillRefusal,
} from "@repo/features/installed-skill-wire";
import {
  readSkillFile,
  SKILL_FILE_BOUNDS,
  SKILL_KEY,
  SKILL_NAME_RULE,
} from "@repo/features/skill-file";
import type { SkillFile } from "./skill-source.js";

/** The repository check's provider-credential shapes, kept in step with `scripts/repository-checks.sh`. */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /sk_live_[0-9A-Za-z]{24,}/u,
  /gh[pousr]_[A-Za-z0-9]{36}/u,
  /github_pat_[A-Za-z0-9_]{22,}/u,
  /xox[baprs]-[0-9]+-/u,
  /AKIA[0-9A-Z]{16}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

/** What a skill's `SKILL.md` says of it, as the store keeps it. */
export interface SkillHead {
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
}

/** A file's bytes as text, read leniently: a binary file reads as noise, which no credential shape matches by chance. */
export function fileText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** What the `SKILL.md` text says of its skill: the name it declares, else the one given; its description; and whether a member may pick it. */
export function skillHead(markdown: string, fallbackName: string): SkillHead {
  const keys = readSkillFile(markdown)?.keys;
  return {
    name: keys?.get(SKILL_KEY.NAME)?.trim() || fallbackName,
    description: keys?.get(SKILL_KEY.DESCRIPTION)?.trim() ?? "",
    userInvocable: keys?.get(SKILL_KEY.USER_INVOCABLE)?.trim() !== "false",
  };
}

/** Why an install refuses the skill, as the module's header says; nothing where it installs. */
export function skillRefusal(
  head: Pick<SkillHead, "name" | "description">,
  files: readonly SkillFile[],
): InstalledSkillRefusal | undefined {
  const main = files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main === undefined) return INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE;
  // Note that a `SKILL.md` is held to a repository's bound besides, as the table's check holds it (`installed_skill_file_bytes_bound`).
  if (
    holdsFileTooLarge(files.map((file) => file.bytes.byteLength)) ||
    main.bytes.byteLength > SKILL_FILE_BOUNDS.MAX_FILE_BYTES
  ) {
    return INSTALLED_SKILL_REFUSAL.TOO_LARGE;
  }
  if (!SKILL_NAME_RULE.test(head.name) || head.description === "") {
    return INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID;
  }
  if (files.some((file) => CREDENTIAL_SHAPES.some((shape) => shape.test(fileText(file.bytes))))) {
    return INSTALLED_SKILL_REFUSAL.CREDENTIAL;
  }
  return undefined;
}
