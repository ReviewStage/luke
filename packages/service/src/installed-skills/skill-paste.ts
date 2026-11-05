/**
 * skill-paste.ts -- what a member pasted into Add skill: a GitHub repository or one of its folders, a skill's own text, or neither.
 *
 * A source is `owner/repo[/path]`, or a github.com link to the repository,
 * to one of its folders (`/tree/<ref>/<path>`), or to a file there
 * (`/blob/<ref>/<path>`), a `SKILL.md` naming its folder. A `skills add`
 * line is split on white space: its source is the first word after `add`
 * holding a slash, and the skills it names follow `--skill` or `-s`. Text
 * over more than one line is a skill's text. Anything else is no source we
 * install from.
 */

import { SKILL_PASTE_KIND } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_MAIN_FILE } from "@repo/features/installed-skill-wire";

/** A GitHub repository as pasted: the folder and ref it names, and the skills a `skills add` line asks for. */
export interface SkillPasteSource {
  readonly kind: typeof SKILL_PASTE_KIND.SOURCE;
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  /** The folder skills are found in, from the repository's root; the root where none is named. */
  readonly path: string;
  readonly skills: readonly string[];
}

export type SkillPaste =
  | SkillPasteSource
  | { readonly kind: typeof SKILL_PASTE_KIND.TEXT; readonly markdown: string }
  | { readonly kind: typeof SKILL_PASTE_KIND.UNSUPPORTED };

/** GitHub's own rules for an account's and a repository's name. */
const OWNER = /^[A-Za-z0-9-]+$/u;
const REPO = /^[A-Za-z0-9._-]+$/u;

const GITHUB_LINK = /^https?:\/\/(?:www\.)?github\.com\/(.*)$/u;

/** The words that open a `skills add` line's skill names. */
const SKILL_FLAGS: ReadonlySet<string> = new Set(["--skill", "-s"]);

/** The folder the segments name, a `SKILL.md` naming the folder it is in. */
function folderOf(segments: readonly string[]): string {
  const folder = segments.at(-1) === INSTALLED_SKILL_MAIN_FILE ? segments.slice(0, -1) : segments;
  return folder.join("/");
}

/** The repository, ref, and folder a word names, or nothing where it names no GitHub repository. */
function sourceOf(word: string): Omit<SkillPasteSource, "kind" | "skills"> | undefined {
  const link = GITHUB_LINK.exec(word);
  const [owner = "", repo = "", ...rest] = (link?.[1] ?? word).split("/").filter(Boolean);
  if (!OWNER.test(owner) || !REPO.test(repo)) return undefined;
  if (link === null || rest.length === 0) return { owner, repo, path: folderOf(rest) };
  const [kind, ref, ...path] = rest;
  if ((kind !== "tree" && kind !== "blob") || ref === undefined) return undefined;
  return { owner, repo, ref, path: folderOf(path) };
}

/** The skill names a `skills add` line asks for: every word after `--skill` or `-s` up to the next flag or source. */
function skillsOf(words: readonly string[]): readonly string[] {
  const skills: string[] = [];
  let naming = false;
  for (const word of words) {
    if (SKILL_FLAGS.has(word)) naming = true;
    else if (word.startsWith("-") || word.includes("/")) naming = false;
    else if (naming) skills.push(word);
  }
  return skills;
}

/** The paste read as the module's header says. */
export function parseSkillPaste(text: string): SkillPaste {
  const trimmed = text.trim();
  if (trimmed.includes("\n")) return { kind: SKILL_PASTE_KIND.TEXT, markdown: trimmed };
  const words = trimmed.split(/\s+/u);
  const add = words.indexOf("add");
  const word =
    add === -1 ? trimmed : (words.slice(add + 1).find((each) => each.includes("/")) ?? "");
  const source = sourceOf(word);
  if (source === undefined) return { kind: SKILL_PASTE_KIND.UNSUPPORTED };
  return { kind: SKILL_PASTE_KIND.SOURCE, ...source, skills: skillsOf(words) };
}
