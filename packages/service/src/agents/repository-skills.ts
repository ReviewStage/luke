import {
  readSkillFile,
  SKILL_FILE_BOUNDS,
  SKILL_KEY,
  SKILL_NAME_RULE,
} from "@repo/features/skill-file";
import { TASK_SKILL_BOUNDS } from "@repo/features/task-wire";
import { Effect, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubUnavailable } from "../github/github-app.js";
import { readRepositoryFile } from "../github/repository-file.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";

export const SKILL_ROOT = {
  AGENTS: ".agents/skills",
  CLAUDE: ".claude/skills",
} as const;

type SkillRoot = (typeof SKILL_ROOT)[keyof typeof SKILL_ROOT];

const REPOSITORY_SKILLS = {
  MAX_SKILLS: TASK_SKILL_BOUNDS.MAX_SKILLS,
  MAX_READS: 128,
  MAX_FILE_BYTES: SKILL_FILE_BOUNDS.MAX_FILE_BYTES,
  MAX_DESCRIPTION_CHARS: TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS,
  READ_CONCURRENCY: 8,
} as const;

const SKILL_FILE = "SKILL.md";

export interface RepositorySkill {
  readonly name: string;
  readonly description: string;
  readonly folder: string;
  readonly userInvocable: boolean;
  readonly markdown: string;
}

function skillOf(root: SkillRoot, name: string, text: string): RepositorySkill | undefined {
  const file = readSkillFile(text);
  if (file === undefined) return undefined;
  const declared = file.keys.get(SKILL_KEY.NAME)?.trim();
  if (declared !== undefined && declared !== name) return undefined;
  const description = file.keys.get(SKILL_KEY.DESCRIPTION)?.trim() ?? "";
  if (description === "") return undefined;
  return {
    name,
    description: description.slice(0, REPOSITORY_SKILLS.MAX_DESCRIPTION_CHARS),
    folder: `${root}/${name}`,
    userInvocable: file.keys.get(SKILL_KEY.USER_INVOCABLE)?.trim() !== "false",
    markdown: file.body,
  };
}

interface SkillFolder {
  readonly root: SkillRoot;
  readonly name: string;
}

function rootFolders(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  root: SkillRoot,
): Effect.Effect<readonly SkillFolder[], GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.map(readRepositoryFolder(token, repository, root), (folder) =>
    folder.found
      ? folder.entries
          .filter((entry) => entry.type === GIT_ENTRY.TREE && SKILL_NAME_RULE.test(entry.name))
          .map((entry) => ({ root, name: entry.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );
}

function readSkill(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  folder: SkillFolder,
): Effect.Effect<RepositorySkill | undefined, GitHubUnavailable, HttpClient.HttpClient> {
  const path = `${folder.root}/${folder.name}/${SKILL_FILE}`;
  return Effect.map(
    readRepositoryFile(token, repository, repository.defaultBranch, path),
    (file) => {
      if (!file.regular || file.content === undefined) return undefined;
      if (file.bytes > REPOSITORY_SKILLS.MAX_FILE_BYTES) return undefined;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(file.content);
      return skillOf(folder.root, folder.name, text);
    },
  );
}

export function skillFilePath(skill: Pick<RepositorySkill, "folder">): string {
  return `${skill.folder}/${SKILL_FILE}`;
}

export function readRepositorySkills(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
): Effect.Effect<readonly RepositorySkill[], GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const listed = yield* Effect.forEach(Object.values(SKILL_ROOT), (root) =>
      rootFolders(token, repository, root),
    );
    const folders = listed
      .flat()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, REPOSITORY_SKILLS.MAX_READS);
    const read = yield* Effect.forEach(folders, (folder) => readSkill(token, repository, folder), {
      concurrency: REPOSITORY_SKILLS.READ_CONCURRENCY,
    });
    const byName = new Map<string, RepositorySkill>();
    for (const skill of read) {
      if (skill !== undefined && !byName.has(skill.name)) byName.set(skill.name, skill);
    }
    return [...byName.values()].slice(0, REPOSITORY_SKILLS.MAX_SKILLS);
  });
}
