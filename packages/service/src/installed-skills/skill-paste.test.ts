import { SKILL_PASTE_KIND } from "@repo/features/installed-skill-route-wire";
import { expect, it } from "vitest";
import { parseSkillPaste } from "./skill-paste.js";

/** What Add skill's one box reads a paste as: a GitHub source, a skill's text, or nothing we install from. */

const source = (rest: object = {}) => ({
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "o",
  repo: "r",
  path: "",
  skills: [],
  ...rest,
});

const UNSUPPORTED = { kind: SKILL_PASTE_KIND.UNSUPPORTED };

it.each([
  ["o/r", source()],
  ["  o/r/skills/x \n", source({ path: "skills/x" })],
  ["https://github.com/o/r", source()],
  ["https://github.com/o/r/tree/main/skills/x", source({ ref: "main", path: "skills/x" })],
  ["https://github.com/o/r/blob/v2/skills/x/SKILL.md", source({ ref: "v2", path: "skills/x" })],
  ["npx skills add o/r --skill a b -s c", source({ skills: ["a", "b", "c"] })],
  ["npx skills add -y https://github.com/o/r/tree/dev", source({ ref: "dev" })],
  [
    "---\nname: x\n---\nDo it.",
    { kind: SKILL_PASTE_KIND.TEXT, markdown: "---\nname: x\n---\nDo it." },
  ],
  ["", UNSUPPORTED],
  ["just words", UNSUPPORTED],
  ["https://gitlab.com/o/r", UNSUPPORTED],
  ["git@github.com:o/r.git", UNSUPPORTED],
  ["https://github.com/o/r/issues/3", UNSUPPORTED],
  ["npx skills add ./local", UNSUPPORTED],
  ["npx skills find review", UNSUPPORTED],
])("%j", (text, expected) => {
  expect(parseSkillPaste(text)).toEqual(expected);
});
