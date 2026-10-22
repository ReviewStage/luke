/**
 * repository-skills.ts -- the agent skills a repository keeps, read from GitHub as it stands now.
 *
 * A skill is the Agent Skills convention the coding harnesses share: a
 * folder named for the skill holding a `SKILL.md`, whose YAML frontmatter
 * carries its `name` and the `description` a model routes on, and whose
 * body is the procedure. A repository keeps them under the roots below:
 * `.agents/skills/`, which Codex and the other harnesses read, and
 * `.claude/skills/`, which Claude Code reads. A skill is a folder of a
 * root, so a link standing in a root, as `.claude/skills/<name>` linking
 * to `.agents/skills/<name>` does, is no skill of its own (git holds it as
 * a blob): the skill it links to is read from where it stands. Where two
 * roots hold a skill of one name, the first root's is the one offered, and
 * the next root's where the first root's breaks the convention.
 *
 * Every read is bounded, so a repository holding hundreds of skills or a
 * huge `SKILL.md` costs a fixed number of requests and bytes: past the
 * bound the rest are left out. The bound on reads is wider than the bound
 * on skills, so folders that hold no skill do not crowd out ones that do.
 * A skill is named by its folder, as eve names one by its path; a folder
 * whose name breaks the convention's rule (lowercase letters, digits, and
 * single hyphens), whose `SKILL.md` names another, or which carries no
 * description is left out, since the convention refuses all three.
 *
 * The frontmatter is read by `@luke/features/skill-file`, which a skill a
 * member pastes is read by too.
 */

import {
  readSkillFile,
  SKILL_FILE_BOUNDS,
  SKILL_KEY,
  SKILL_NAME_RULE,
} from "@luke/features/skill-file";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { Effect, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubUnavailable } from "../github/github-app.js";
import { readRepositoryFile } from "../github/repository-file.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";

/** Where a repository keeps its skills, in the order a name is looked for. */
const SKILL_ROOT = {
  AGENTS: ".agents/skills",
  CLAUDE: ".claude/skills",
} as const;

type SkillRoot = (typeof SKILL_ROOT)[keyof typeof SKILL_ROOT];

/** How much of a repository's skills is read. */
const REPOSITORY_SKILLS = {
  /** The most skills read, across every root: as many as the desktop's read of them carries. */
  MAX_SKILLS: TASK_SKILL_BOUNDS.MAX_SKILLS,
  /** The most `SKILL.md` files read, across every root: a skill's in each root, twice the skills. */
  MAX_READS: 128,
  /** The largest `SKILL.md` read; a larger one is left out. */
  MAX_FILE_BYTES: SKILL_FILE_BOUNDS.MAX_FILE_BYTES,
  /** The convention's bound on a description, past which it is cut, which the desktop's read holds it to. */
  MAX_DESCRIPTION_CHARS: TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS,
  /** How many `SKILL.md` reads stand at once. */
  READ_CONCURRENCY: 8,
} as const;

/** The file a skill's folder holds it in. */
const SKILL_FILE = "SKILL.md";

/** One skill a repository keeps. */
export interface RepositorySkill {
  readonly name: string;
  readonly description: string;
  /** The skill's folder in the repository, from its root: `.agents/skills/<name>`. */
  readonly folder: string;
  /** Whether a developer may choose it by name; Claude Code's `user-invocable: false` says not, and the model alone loads it. */
  readonly userInvocable: boolean;
  /** The body of its `SKILL.md`, the frontmatter taken off. */
  readonly markdown: string;
}

/** The skill a `SKILL.md` in the folder named describes, or nothing where it breaks the convention. */
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

/* ----- GitHub ----- */

/** A skill's folder found in a root, not yet read. */
interface SkillFolder {
  readonly root: SkillRoot;
  readonly name: string;
}

/** The skill folders a root holds, by the convention's names, in name order; none where the root stands nowhere. */
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

/** One folder's `SKILL.md` read and held to the convention; nothing where it is missing, too large, not text, or breaks it. */
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

/** Where a skill's `SKILL.md` stands in the repository, from its root: `.agents/skills/<name>/SKILL.md`. */
export function skillFilePath(skill: Pick<RepositorySkill, "folder">): string {
  return `${skill.folder}/${SKILL_FILE}`;
}

/**
 * The skills the repository keeps on its default branch as GitHub holds it
 * now, read on a token minted for that one repository, in name order: the
 * first root's where two roots name one skill, the next root's where the
 * first's breaks the convention, and no more than the bounds.
 */
export function readRepositorySkills(
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
): Effect.Effect<readonly RepositorySkill[], GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const listed = yield* Effect.forEach(Object.values(SKILL_ROOT), (root) =>
      rootFolders(token, repository, root),
    );
    // Note that the sort is stable, so a name's folders stay in root order.
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
