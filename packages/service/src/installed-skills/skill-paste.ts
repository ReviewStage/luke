import { SKILL_PASTE_KIND } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_MAIN_FILE } from "@repo/features/installed-skill-wire";

export interface SkillPasteSource {
  readonly kind: typeof SKILL_PASTE_KIND.SOURCE;
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly path: string;
  readonly skills: readonly string[];
}

export type SkillPaste =
  | SkillPasteSource
  | { readonly kind: typeof SKILL_PASTE_KIND.TEXT; readonly markdown: string }
  | { readonly kind: typeof SKILL_PASTE_KIND.UNSUPPORTED };

const OWNER = /^[A-Za-z0-9-]+$/u;
const REPO = /^[A-Za-z0-9._-]+$/u;

const GITHUB_LINK = /^https?:\/\/(?:www\.)?github\.com\/([^?#]*)/u;

const SKILL_FLAGS: ReadonlySet<string> = new Set(["--skill", "-s"]);

function folderOf(segments: readonly string[]): string {
  const folder = segments.at(-1) === INSTALLED_SKILL_MAIN_FILE ? segments.slice(0, -1) : segments;
  return folder.join("/");
}

function sourceOf(word: string): Omit<SkillPasteSource, "kind" | "skills"> | undefined {
  const link = GITHUB_LINK.exec(word);
  const [owner = "", repo = "", ...rest] = (link?.[1] ?? word).split("/").filter(Boolean);
  if (!OWNER.test(owner) || !REPO.test(repo)) return undefined;
  if (link === null || rest.length === 0) return { owner, repo, path: folderOf(rest) };
  const [kind, ref, ...path] = rest;
  if ((kind !== "tree" && kind !== "blob") || ref === undefined) return undefined;
  return { owner, repo, ref, path: folderOf(path) };
}

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
