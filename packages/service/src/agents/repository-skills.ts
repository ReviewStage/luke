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
 * The frontmatter is read for the few keys the convention names, as the
 * YAML a `SKILL.md` actually holds spells them: a plain, quoted, or block
 * scalar at the top level. Anything richer is a key this reader ignores,
 * which is what a harness does with a key it does not know.
 */

import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
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
  MAX_FILE_BYTES: 64 * 1024,
  /** The convention's bound on a description, past which it is cut, which the desktop's read holds it to. */
  MAX_DESCRIPTION_CHARS: TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS,
  /** How many `SKILL.md` reads stand at once. */
  READ_CONCURRENCY: 8,
} as const;

/** The file a skill's folder holds it in. */
const SKILL_FILE = "SKILL.md";

/** The convention's rule for a skill's name: up to 64 lowercase letters and digits, in words joined by single hyphens. */
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** The frontmatter's fences: `---` on the first line and again on a line of its own. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** A top-level key and the rest of its line. */
const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/u;

/** A JSON value read as a string, which a double-quoted scalar parses to. */
const readJsonString = Schema.decodeUnknownOption(Schema.String);

/** The frontmatter keys this reader reads. */
const SKILL_KEY = {
  NAME: "name",
  DESCRIPTION: "description",
  USER_INVOCABLE: "user-invocable",
} as const;

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

/** What a `SKILL.md` says of itself: its frontmatter's keys, each as text, and the body under it. */
interface SkillFile {
  readonly keys: ReadonlyMap<string, string>;
  readonly body: string;
}

/* ----- Frontmatter ----- */

/** The lines under a key that continue its value: indented or blank, up to the next top-level key. */
function continuationOf(lines: readonly string[], from: number): readonly string[] {
  const taken: string[] = [];
  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (line.trim() !== "" && !/^[ \t]/u.test(line)) break;
    taken.push(line);
  }
  return taken;
}

/** A block scalar's lines (`|` keeps line breaks, `>` folds them into spaces), dedented by the first line's indent. */
function blockScalar(style: string, lines: readonly string[]): string {
  const first = lines.find((line) => line.trim() !== "") ?? "";
  const indent = first.length - first.trimStart().length;
  const kept = lines.map((line) => line.slice(indent).trimEnd());
  if (style === "|") return kept.join("\n").trim();
  return kept
    .join("\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.split("\n").join(" "))
    .join("\n")
    .trim();
}

/** A double-quoted scalar's text, its escapes read as JSON reads them; the bare text where JSON cannot. */
function doubleQuoted(text: string): string {
  try {
    return Option.getOrElse(readJsonString(JSON.parse(text)), () => text.slice(1, -1));
  } catch {
    return text.slice(1, -1);
  }
}

/** One key's value as text: the first line's rest, folded with the lines that continue it. */
function scalarOf(rest: string, continuation: readonly string[]): string {
  const head = rest.trim();
  if (/^[|>][+-]?$/u.test(head)) return blockScalar(head.charAt(0), continuation);
  const folded = [head, ...continuation.map((line) => line.trim())]
    .filter((part) => part !== "")
    .join(" ");
  if (folded.startsWith('"') && folded.endsWith('"') && folded.length > 1) {
    return doubleQuoted(folded);
  }
  if (folded.startsWith("'") && folded.endsWith("'") && folded.length > 1) {
    return folded.slice(1, -1).replaceAll("''", "'");
  }
  // Note that a plain scalar ends at a comment, which YAML opens with a space and a hash.
  return folded.replace(/[ \t]+#.*$/u, "");
}

/** A `SKILL.md` read for its frontmatter's top-level keys and its body; nothing where it opens with no frontmatter. */
function readSkillFile(text: string): SkillFile | undefined {
  const fenced = FRONTMATTER.exec(text.replace(/^\uFEFF/u, ""));
  if (fenced === null) return undefined;
  const lines = (fenced[1] ?? "").split(/\r?\n/u);
  const keys = new Map<string, string>();
  for (let at = 0; at < lines.length; at += 1) {
    const key = TOP_LEVEL_KEY.exec(lines[at] ?? "");
    if (key === null) continue;
    const continuation = continuationOf(lines, at + 1);
    keys.set(key[1] ?? "", scalarOf(key[2] ?? "", continuation));
    at += continuation.length;
  }
  return {
    keys,
    body: text
      .replace(/^\uFEFF/u, "")
      .slice(fenced[0].length)
      .trim(),
  };
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
          .filter((entry) => entry.type === GIT_ENTRY.TREE && SKILL_NAME.test(entry.name))
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
