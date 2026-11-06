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

const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /sk_live_[0-9A-Za-z]{24,}/u,
  /gh[pousr]_[A-Za-z0-9]{36}/u,
  /github_pat_[A-Za-z0-9_]{22,}/u,
  /xox[baprs]-[0-9]+-/u,
  /AKIA[0-9A-Z]{16}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

export interface SkillHead {
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
}

export function fileText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function skillHead(markdown: string, fallbackName: string): SkillHead {
  const keys = readSkillFile(markdown)?.keys;
  return {
    name: keys?.get(SKILL_KEY.NAME)?.trim() || fallbackName,
    description: keys?.get(SKILL_KEY.DESCRIPTION)?.trim() ?? "",
    userInvocable: keys?.get(SKILL_KEY.USER_INVOCABLE)?.trim() !== "false",
  };
}

export function skillRefusal(
  head: Pick<SkillHead, "name" | "description">,
  files: readonly SkillFile[],
): InstalledSkillRefusal | undefined {
  const main = files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main === undefined) return INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE;
  if (
    holdsFileTooLarge(files.map((file) => file.bytes.byteLength)) ||
    main.bytes.byteLength > SKILL_FILE_BOUNDS.MAX_FILE_BYTES
  ) {
    return INSTALLED_SKILL_REFUSAL.TOO_LARGE;
  }
  if (!SKILL_NAME_RULE.test(head.name) || head.description === "") {
    return INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID;
  }
  const texts = files.map((file) => fileText(file.bytes));
  if (texts.some((text) => CREDENTIAL_SHAPES.some((shape) => shape.test(text)))) {
    return INSTALLED_SKILL_REFUSAL.CREDENTIAL;
  }
  return undefined;
}
