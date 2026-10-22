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
import { readSkillFile, SKILL_KEY } from "@luke/features/skill-file";
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

/**
 * A skill's `SKILL.md` as the harness reads it: as installed, where its
 * frontmatter names the skill and describes it, since that keeps every key
 * a harness reads; otherwise its body under a frontmatter written from the
 * name and description Luke keeps, which both harnesses need to list it.
 */
function skillFileOf(skill: AgentSkill): Uint8Array {
  const text =
    skill.skillFile === undefined
      ? undefined
      : new TextDecoder("utf-8", { fatal: false }).decode(skill.skillFile);
  const read = text === undefined ? undefined : readSkillFile(text);
  const named = read?.keys.get(SKILL_KEY.NAME) === skill.name;
  const described = (read?.keys.get(SKILL_KEY.DESCRIPTION) ?? "") !== "";
  if (skill.skillFile !== undefined && named && described) return skill.skillFile;
  const body = read?.body ?? text?.replace(/^\uFEFF/u, "").trim() ?? skill.markdown;
  // A double-quoted scalar, which JSON spells as YAML reads it.
  const frontmatter = `name: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}`;
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
