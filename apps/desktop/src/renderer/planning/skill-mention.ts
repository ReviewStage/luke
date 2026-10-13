/**
 * skill-mention.ts -- a skill named in a message as `/name`: where one is being typed, what choosing one writes, and where the chosen ones stand.
 *
 * A message names one of its repository's skills the way Claude Code and
 * Codex take one: a slash at the start of a word, then the skill's name
 * (`/release-notes`), which the coding agent loads before it acts. The
 * composer opens its list while the caret stands in such a word, so a
 * slash typed inside a word (`a/b`), a path, or code (between backticks or
 * inside a fenced block) opens nothing. A chosen skill is written into the
 * message as its own word, `/name` and a space, and stands as one token
 * after that: drawn as a chip, and taken out whole by one Backspace at its
 * end. Nothing here draws.
 */

/** A skill as the composer offers it: its name, what it is for, and its `SKILL.md`, named from the repository's root. */
export interface SkillOption {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

/** A `/` word the caret stands at the end of: where its slash is, and the letters typed after it. */
export interface SkillMention {
  readonly start: number;
  readonly query: string;
}

/** A stretch of the message, from its first character to the one after its last. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** The words and the caret after an edit. */
export interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

const SLASH = "/";
/** A line that opens or closes a fenced block: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** A run of backticks, which opens a code span the next run of the same length closes. */
const TICKS = /`+/gu;

/** A character a skill's name is spelled in, typed in either case. */
const NAME_CHARACTER = /[A-Za-z0-9-]/u;

/** A character that ends a word. */
const SPACE = /\s/u;

/** Whether the line holding the index stands inside a fenced block, its fence lines included. */
function insideFence(text: string, at: number): boolean {
  let open: string | undefined;
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const fence = FENCE_LINE.exec(line)?.[1];
    if (at >= start && at <= end) return open !== undefined || fence !== undefined;
    // A fence closes on a run of its own character at least as long as the one that opened it.
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

/** Whether the index stands inside a code span on its own line: between a run of backticks and the next run of the same length. */
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
    // A run no later run closes is backticks as words.
    if (closing === -1) continue;
    if (offset >= opening.end && offset < (runs[closing]?.start ?? 0)) return true;
    index = closing;
  }
  return false;
}

/** Whether the index stands in code: inside a fenced block, or inside a code span on its own line. */
function insideCode(text: string, at: number): boolean {
  return insideFence(text, at) || insideSpan(text, at);
}

/** Whether a slash at the index starts a word: the message's start or a space before it, and no code around it. */
function startsWord(text: string, at: number): boolean {
  if (text[at] !== SLASH) return false;
  const before = text[at - 1];
  if (before !== undefined && !SPACE.test(before)) return false;
  return !insideCode(text, at);
}

/** Whether the message holds a `/` that starts a word anywhere, outside code. */
export function holdsSlashWord(text: string): boolean {
  for (let at = text.indexOf(SLASH); at !== -1; at = text.indexOf(SLASH, at + 1)) {
    if (startsWord(text, at)) return true;
  }
  return false;
}

/** The `/` word the caret ends, as far as it has been typed; nothing where the caret stands in no such word. */
export function mentionAt(text: string, caret: number): SkillMention | undefined {
  let at = caret;
  while (at > 0 && NAME_CHARACTER.test(text[at - 1] ?? "")) at -= 1;
  const start = at - 1;
  if (start < 0 || !startsWord(text, start)) return undefined;
  return { start, query: text.slice(at, caret) };
}

/**
 * The skills whose name or description holds the query, in either case:
 * those whose name starts with it first, then those whose name holds it,
 * then those whose description does, each in the order given.
 */
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

/** The message with the `/` word under the caret written as the skill chosen, a space after it, and the caret after that. */
export function chooseSkill(text: string, mention: SkillMention, name: string): TextEdit {
  let end = mention.start + 1;
  while (end < text.length && NAME_CHARACTER.test(text[end] ?? "")) end += 1;
  const after = text.slice(end);
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const written = `${SLASH}${name}`;
  return {
    text: `${text.slice(0, mention.start)}${written}${spaced}`,
    caret: mention.start + written.length + 1,
  };
}

/** Every chosen skill the message names, as `/name` words of the skills given, in order. */
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

/** The message with the chosen skill the caret ends taken out whole, as Backspace there does; nothing where the caret ends none. */
export function withoutTokenBefore(
  text: string,
  caret: number,
  names: ReadonlySet<string>,
): TextEdit | undefined {
  const token = skillTokens(text, names).find((each) => each.end === caret);
  if (token === undefined) return undefined;
  return { text: `${text.slice(0, token.start)}${text.slice(token.end)}`, caret: token.start };
}
