import { Option, Schema } from "effect";

export const SKILL_NAME_RULE = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const SKILL_FILE_BOUNDS = {
  MAX_NAME_CHARS: 64,
  MAX_FILE_BYTES: 64 * 1024,
} as const;

export const SKILL_KEY = {
  NAME: "name",
  DESCRIPTION: "description",
  USER_INVOCABLE: "user-invocable",
} as const;

export interface SkillFile {
  readonly keys: ReadonlyMap<string, string>;
  readonly body: string;
}

export const SKILL_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):(?:[ \t](.*))?$/u;

const readJsonString = Schema.decodeUnknownOption(Schema.String);

function continuationOf(lines: readonly string[], from: number): readonly string[] {
  const taken: string[] = [];
  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (line.trim() !== "" && !/^[ \t]/u.test(line)) break;
    taken.push(line);
  }
  return taken;
}

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

function doubleQuoted(text: string): string {
  try {
    return Option.getOrElse(readJsonString(JSON.parse(text)), () => text.slice(1, -1));
  } catch {
    return text.slice(1, -1);
  }
}

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
  const comment = folded.search(/[ \t]#/u);
  return comment === -1 ? folded : folded.slice(0, comment).trimEnd();
}

export function readSkillFile(text: string): SkillFile | undefined {
  const unmarked = text.replace(/^\uFEFF/u, "");
  const fenced = SKILL_FRONTMATTER.exec(unmarked);
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
