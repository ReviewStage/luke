import type { TaskSkillSource } from "@repo/features/task-wire";

export interface SkillOption {
  readonly name: string;
  readonly description: string;
  readonly source: TaskSkillSource;
  readonly path?: string;
}

export interface SkillMention {
  readonly start: number;
  readonly query: string;
}

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

const SLASH = "/";
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

const TICKS = /`+/gu;

const NAME_CHARACTER = /[A-Za-z0-9-]/u;

const SPACE = /\s/u;

function insideFence(text: string, at: number): boolean {
  let open: string | undefined;
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const fence = FENCE_LINE.exec(line)?.[1];
    if (at >= start && at <= end) return open !== undefined || fence !== undefined;
    if (fence !== undefined && open === undefined) open = fence;
    else if (
      fence !== undefined &&
      open !== undefined &&
      fence[0] === open[0] &&
      fence.length >= open.length
    )
      open = undefined;
    start = end + 1;
  }
  return false;
}

function insideSpan(text: string, at: number): boolean {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", at);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const runs = [...line.matchAll(TICKS)].map((run) => ({
    start: run.index,
    end: run.index + run[0].length,
  }));
  const offset = at - lineStart;
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index];
    if (opening === undefined) continue;
    const length = opening.end - opening.start;
    const closing = runs.findIndex((run, later) => later > index && run.end - run.start === length);
    if (closing === -1) continue;
    if (offset >= opening.end && offset < (runs[closing]?.start ?? 0)) return true;
    index = closing;
  }
  return false;
}

export function insideCode(text: string, at: number): boolean {
  return insideFence(text, at) || insideSpan(text, at);
}

function startsWord(text: string, at: number): boolean {
  if (text[at] !== SLASH) return false;
  const before = text[at - 1];
  if (before !== undefined && !SPACE.test(before)) return false;
  return !insideCode(text, at);
}

export function holdsSlashWord(text: string): boolean {
  for (let at = text.indexOf(SLASH); at !== -1; at = text.indexOf(SLASH, at + 1)) {
    if (startsWord(text, at)) return true;
  }
  return false;
}

export function mentionAt(text: string, caret: number): SkillMention | undefined {
  let at = caret;
  while (at > 0 && NAME_CHARACTER.test(text[at - 1] ?? "")) at -= 1;
  const start = at - 1;
  if (start < 0 || !startsWord(text, start)) return undefined;
  return { start, query: text.slice(at, caret) };
}

export function matchingSkills(
  skills: readonly SkillOption[],
  query: string,
): readonly SkillOption[] {
  const asked = query.toLowerCase();
  const starts = skills.filter((skill) => skill.name.startsWith(asked));
  const holds = skills.filter(
    (skill) => !skill.name.startsWith(asked) && skill.name.includes(asked),
  );
  const describes = skills.filter(
    (skill) => !skill.name.includes(asked) && skill.description.toLowerCase().includes(asked),
  );
  return [...starts, ...holds, ...describes];
}

export function skillWord(name: string): string {
  return `${SLASH}${name}`;
}

export function skillTokens(text: string, names: ReadonlySet<string>): readonly TextRange[] {
  const tokens: TextRange[] = [];
  for (let at = text.indexOf(SLASH); at !== -1; at = text.indexOf(SLASH, at + 1)) {
    if (!startsWord(text, at)) continue;
    let end = at + 1;
    while (end < text.length && NAME_CHARACTER.test(text[end] ?? "")) end += 1;
    const next = text[end];
    if (next !== undefined && !SPACE.test(next)) continue;
    if (names.has(text.slice(at + 1, end))) tokens.push({ start: at, end });
  }
  return tokens;
}
