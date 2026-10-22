/**
 * native-skills.ts -- the skills a member installed into Luke as a native harness finds them: whole skill folders, `SKILL.md` and its files, in one folder of the sandbox, written as it opens.
 *
 * eve is handed an installed skill through its resolver and writes the
 * files itself (`../agent-runtime/skills.ts`); Claude Code and Codex find
 * skills on disk, so the launch writes the ones `nativeSkills` answers,
 * the repository's left to the checkout, into the folder laid out as the
 * runner's protocol says (`INSTALLED_SKILLS`): a Claude Code local plugin,
 * whose `skills/` is Codex's extra skills root as it stands. Nothing is
 * written into the checkout, so nothing is committed and the repository's
 * own skills stay as they are.
 *
 * The files are uploaded as the sandbox's default user to `UPLOAD`, and the
 * launch, as root, moves them to `INSTALLED`, where only root writes and
 * every user reads (`runner-sessions.ts`'s launch script), as the runner's
 * bundle is. Written once, as the sandbox opens, so the session keeps the
 * skills it opened with, which its persisted disk keeps across a stop, as
 * eve's session keeps the ones it started with.
 */

import { INSTALLED_SKILLS } from "@luke/agent-runner/protocol";
import { SKILL_KEY } from "@luke/features/skill-file";
import type { AgentSkill } from "../agent-runtime/skills.js";
import type { VercelSandboxApi } from "../vercel-sandbox-api.js";

/** One file as the sandbox's API writes it. */
type SandboxFile = Parameters<VercelSandboxApi["writeFiles"]>[1][number];

/** Where the installed skills stand: uploaded as the default user, then where root installs them, which a launch's config names. */
export const NATIVE_SKILLS_PATH = {
  UPLOAD: "/tmp/luke-installed-skills",
  INSTALLED: "/opt/luke/installed-skills",
} as const;

/** The mode each file is written with; root's install makes them every user's to read. */
const FILE_MODE = 0o644;

/** The plugin's manifest, which names it, so Claude Code lists its skills as `luke:<name>`. */
const MANIFEST = {
  name: INSTALLED_SKILLS.PLUGIN,
  description: "The skills you installed into Luke.",
} as const;

const encoder = new TextEncoder();

/** The frontmatter's fences, as `@luke/features/skill-file` reads them. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** A top-level key's line. */
const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):/u;

/** The keys Luke writes from what it keeps of the skill, over whatever the file says. */
const KEPT_KEYS: ReadonlySet<string> = new Set([SKILL_KEY.NAME, SKILL_KEY.DESCRIPTION]);

/** The frontmatter's lines less the keys Luke writes and the lines that continue them, every other key kept as written. */
function otherKeys(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const key = TOP_LEVEL_KEY.exec(line);
    // A blank or indented line continues the key above it; any other line ends it.
    if (key !== null) dropping = KEPT_KEYS.has(key[1] ?? "");
    else if (line.trim() !== "" && !/^[ \t]/u.test(line)) dropping = false;
    if (!dropping) kept.push(line);
  }
  return kept;
}

/**
 * A skill's `SKILL.md` as the harness reads it: its body and every key of
 * its frontmatter as installed, under the name and description Luke keeps
 * of it, which both harnesses list it by. Note that the two are written
 * from the store rather than kept from the file, because a file may name
 * none or describe it in words an update has since replaced.
 */
function skillFileOf(skill: AgentSkill): Uint8Array {
  const text =
    skill.skillFile === undefined
      ? undefined
      : new TextDecoder("utf-8", { fatal: false }).decode(skill.skillFile).replace(/^\uFEFF/u, "");
  const fenced = text === undefined ? null : FRONTMATTER.exec(text);
  const rest = fenced === null ? [] : otherKeys((fenced[1] ?? "").split(/\r?\n/u));
  const body =
    text === undefined
      ? skill.markdown
      : (fenced === null ? text : text.slice(fenced[0].length)).trim();
  // A double-quoted scalar, which JSON spells as YAML reads it.
  const frontmatter = [
    `${SKILL_KEY.NAME}: ${skill.name}`,
    `${SKILL_KEY.DESCRIPTION}: ${JSON.stringify(skill.description)}`,
    ...rest,
  ].join("\n");
  return encoder.encode(`---\n${frontmatter}\n---\n\n${body}\n`);
}

/** The files the skills are uploaded as, under `UPLOAD`: the plugin's manifest and each skill's folder; none where there are no skills, so nothing is installed. */
export function nativeSkillFiles(skills: readonly AgentSkill[]): readonly SandboxFile[] {
  if (skills.length === 0) return [];
  const root = `${NATIVE_SKILLS_PATH.UPLOAD}/${INSTALLED_SKILLS.SKILLS}`;
  const manifest: SandboxFile = {
    path: `${NATIVE_SKILLS_PATH.UPLOAD}/${INSTALLED_SKILLS.MANIFEST}`,
    contents: encoder.encode(`${JSON.stringify(MANIFEST, null, 2)}\n`),
    mode: FILE_MODE,
  };
  return [
    manifest,
    ...skills.flatMap((skill) => [
      { path: `${root}/${skill.name}/SKILL.md`, contents: skillFileOf(skill), mode: FILE_MODE },
      ...Object.entries(skill.files ?? {}).map(([path, contents]) => ({
        path: `${root}/${skill.name}/${path}`,
        contents,
        mode: FILE_MODE,
      })),
    ]),
  ];
}
