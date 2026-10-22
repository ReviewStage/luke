/**
 * skill-file.ts -- what a `SKILL.md` says of itself, read by the Agent Skills convention's rules.
 *
 * A skill is a folder named for it holding a `SKILL.md`, whose YAML
 * frontmatter carries its `name` and the `description` a model routes on,
 * and whose body is the procedure. The service reads a repository's skills
 * by these rules, and a skill a member pastes is held to the same ones.
 *
 * The frontmatter is read for the few keys the convention names, as the
 * YAML a `SKILL.md` actually holds spells them: a plain, quoted, or block
 * scalar at the top level. Anything richer is a key this reader ignores,
 * which is what a harness does with a key it does not know.
 */

import { Option, Schema } from "effect";

/** The convention's rule for a skill's name: up to 64 lowercase letters and digits, in words joined by single hyphens. */
export const SKILL_NAME_RULE = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** The convention's bounds on a skill's name and its `SKILL.md`. */
export const SKILL_FILE_BOUNDS = {
  /** The longest name. */
  MAX_NAME_CHARS: 64,
  /** The largest `SKILL.md`, in UTF-8 bytes. */
  MAX_FILE_BYTES: 64 * 1024,
} as const;

/** The frontmatter keys this reader reads. */
export const SKILL_KEY = {
  NAME: "name",
  DESCRIPTION: "description",
  USER_INVOCABLE: "user-invocable",
} as const;

/** What a `SKILL.md` says of itself: its frontmatter's keys, each as text, and the body under it. */
export interface SkillFile {
  readonly keys: ReadonlyMap<string, string>;
  readonly body: string;
}

/** The frontmatter's fences: `---` on the first line and again on a line of its own. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** A top-level key and the rest of its line. */
const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/u;

/** A JSON value read as a string, which a double-quoted scalar parses to. */
const readJsonString = Schema.decodeUnknownOption(Schema.String);

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
export function readSkillFile(text: string): SkillFile | undefined {
  const unmarked = text.replace(/^\uFEFF/u, "");
  const fenced = FRONTMATTER.exec(unmarked);
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
  return { keys, body: unmarked.slice(fenced[0].length).trim() };
}
