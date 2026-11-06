import { INSTALLED_SKILLS } from "@repo/agent-runner/protocol";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SKILL_KEY } from "@repo/features/skill-file";
import type { AgentSkill } from "../agent-runtime/skills.js";
import type { SandboxSessionApi } from "../vercel-sandbox-api.js";

type SandboxFile = Parameters<SandboxSessionApi["writeFiles"]>[0][number];

export const NATIVE_SKILLS_PATH = {
  UPLOAD: "/tmp/agent-installed-skills",
  INSTALLED: "/opt/agent/installed-skills",
} as const;

const FILE_MODE = 0o644;

const MANIFEST = {
  name: INSTALLED_SKILLS.PLUGIN,
  description: `The skills you installed into ${PRODUCT_NAME}.`,
} as const;

const encoder = new TextEncoder();

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):/u;

const KEPT_KEYS: ReadonlySet<string> = new Set([SKILL_KEY.NAME, SKILL_KEY.DESCRIPTION]);

function otherKeys(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const key = TOP_LEVEL_KEY.exec(line);
    if (key !== null) dropping = KEPT_KEYS.has(key[1] ?? "");
    else if (line.trim() !== "" && !/^[ \t]/u.test(line)) dropping = false;
    if (!dropping) kept.push(line);
  }
  return kept;
}

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
  const frontmatter = [
    `${SKILL_KEY.NAME}: ${skill.name}`,
    `${SKILL_KEY.DESCRIPTION}: ${JSON.stringify(skill.description)}`,
    ...rest,
  ].join("\n");
  return encoder.encode(`---\n${frontmatter}\n---\n\n${body}\n`);
}

export function nativeSkillFiles(
  skills: readonly AgentSkill[],
  upload: string,
): readonly SandboxFile[] {
  if (skills.length === 0) return [];
  const root = `${upload}/${INSTALLED_SKILLS.SKILLS}`;
  const manifest: SandboxFile = {
    path: `${upload}/${INSTALLED_SKILLS.MANIFEST}`,
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
