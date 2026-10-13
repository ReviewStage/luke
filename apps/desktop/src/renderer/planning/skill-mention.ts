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

/** A skill as the composer offers it: its name and what it is for. */
export interface SkillOption {
  readonly name: string;
  readonly description: string;
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
const FENCE = "```";
const TICK = "`";

/** A character a skill's name is spelled in, typed in either case. */
const NAME_CHARACTER = /[A-Za-z0-9-]/u;

/** A character that ends a word. */
const SPACE = /\s/u;

/** Whether the index stands in code: inside a fenced block, or between backticks on its own line. */
function insideCode(text: string, at: number): boolean {
  const before = text.slice(0, at);
  const fences = before.split(FENCE).length - 1;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1).replaceAll(FENCE, "");
  return (line.split(TICK).length - 1) % 2 === 1;
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
