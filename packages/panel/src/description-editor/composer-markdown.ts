export const INLINE_MARK = {
  LINK: "link",
  BOLD: "bold",
  ITALIC: "italic",
  STRIKE: "strike",
  CODE: "code",
} as const;

export type InlineMarkName = (typeof INLINE_MARK)[keyof typeof INLINE_MARK];

export interface InlineMark {
  readonly name: InlineMarkName;
  readonly href?: string | undefined;
}

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export type InlineSpan =
  | {
      readonly kind: typeof INLINE_SPAN.WORDS;
      readonly from: number;
      readonly to: number;
      readonly marks: readonly InlineMark[];
    }
  | { readonly kind: typeof INLINE_SPAN.ATOM; readonly from: number; readonly to: number };

export const INLINE_SPAN = { WORDS: "words", ATOM: "atom" } as const;

export interface InlinePiece {
  readonly text: string;
  readonly marks: readonly InlineMark[];
  readonly atom: boolean;
}

export interface WrittenSegment {
  readonly piece: number;
  readonly from: number;
  readonly offset: number;
  readonly length: number;
}

const MARK_ORDER: readonly InlineMarkName[] = [
  INLINE_MARK.LINK,
  INLINE_MARK.BOLD,
  INLINE_MARK.ITALIC,
  INLINE_MARK.STRIKE,
  INLINE_MARK.CODE,
];

const BACKSLASH = "\\";
const TICK = "`";
const STAR = "*";
const TILDE = "~";
const OPEN_BRACKET = "[";
const CLOSE_BRACKET = "]";
const BANG = "!";
const MENTION_SIGIL = "@";
const SPACE = " ";

const STRIKE_RUN = 2;

const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u;
const LEADING_SPACE = /^\s*/u;
const TRAILING_SPACE = /\s*$/u;
const TICK_RUNS = /`+/gu;

const MARK_SPECIAL = /[\\*~[\]]/u;

const LINK_TARGET = /^\(([^\s()]+)\)/u;

const ADDRESS_SPECIAL = /[\s()]/gu;

interface Delimiter {
  readonly char: string;
  at: number;
  length: number;
  readonly origin: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

interface Bracket {
  readonly at: number;
  readonly bottom: number;
  active: boolean;
}

interface MarkRange extends LineRange {
  readonly mark: InlineMark;
}

interface Reading {
  readonly line: string;
  readonly atoms: ReadonlyMap<number, number>;
  readonly dropped: boolean[];
  readonly ranges: MarkRange[];
  readonly codes: { range: MarkRange; syntax: readonly number[] }[];
  readonly escapes: number[];
}

function runLength(line: string, at: number, char: string): number {
  let end = at;
  while (line[end] === char) end += 1;
  return end - at;
}

function flanking(line: string, at: number, run: number): { canOpen: boolean; canClose: boolean } {
  const before = line[at - 1];
  const after = line[at + run];
  const beforeSpace = before === undefined || WHITESPACE.test(before);
  const afterSpace = after === undefined || WHITESPACE.test(after);
  const beforePunctuation = before !== undefined && PUNCTUATION.test(before);
  const afterPunctuation = after !== undefined && PUNCTUATION.test(after);
  return {
    canOpen: !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation),
    canClose: !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation),
  };
}

function drop(reading: Reading, from: number, to: number): void {
  for (let at = from; at < to; at += 1) reading.dropped[at] = true;
}

function atomWithin(reading: Reading, from: number, to: number): boolean {
  for (let at = from; at < to; at += 1) if (reading.atoms.has(at)) return true;
  return false;
}

function ruleOfThree(opener: Delimiter, closer: Delimiter): boolean {
  if (!opener.canClose && !closer.canOpen) return false;
  const sum = opener.origin + closer.origin;
  return sum % 3 === 0 && !(opener.origin % 3 === 0 && closer.origin % 3 === 0);
}

function openerFor(delimiters: readonly Delimiter[], bottom: number, closer: number): number {
  const closing = delimiters[closer];
  if (closing === undefined) return -1;
  for (let at = closer - 1; at >= bottom; at -= 1) {
    const opener = delimiters[at];
    if (opener === undefined || opener.char !== closing.char || !opener.canOpen) continue;
    if (closing.char === TILDE) {
      if (opener.length === STRIKE_RUN && closing.length === STRIKE_RUN) return at;
      continue;
    }
    if (!ruleOfThree(opener, closing)) return at;
  }
  return -1;
}

function emphasis(reading: Reading, delimiters: Delimiter[], bottom: number): void {
  let closer = bottom;
  while (closer < delimiters.length) {
    const closing = delimiters[closer];
    if (closing === undefined) break;
    const found = closing.canClose ? openerFor(delimiters, bottom, closer) : -1;
    if (found < 0) {
      if (closing.canClose && !closing.canOpen) delimiters.splice(closer, 1);
      else closer += 1;
      continue;
    }
    const opener = delimiters[found];
    if (opener === undefined) break;
    const use = closing.char === TILDE || (opener.length >= 2 && closing.length >= 2) ? 2 : 1;
    const name =
      closing.char === TILDE
        ? INLINE_MARK.STRIKE
        : use === 2
          ? INLINE_MARK.BOLD
          : INLINE_MARK.ITALIC;
    const start = opener.at + opener.length;
    reading.ranges.push({ start, end: closing.at, mark: { name } });
    drop(reading, start - use, start);
    drop(reading, closing.at, closing.at + use);
    opener.length -= use;
    closing.at += use;
    closing.length -= use;
    delimiters.splice(found + 1, closer - found - 1);
    closer = found + 1;
    if (opener.length === 0) {
      delimiters.splice(found, 1);
      closer = found;
    }
    if (closing.length === 0) delimiters.splice(closer, 1);
  }
  delimiters.length = bottom;
}

function closingTicks(reading: Reading, from: number, run: number): number | undefined {
  let at = from;
  while (at < reading.line.length) {
    if (reading.atoms.has(at)) return undefined;
    if (reading.line[at] !== TICK) {
      at += 1;
      continue;
    }
    const length = runLength(reading.line, at, TICK);
    if (length === run) return at;
    at += length;
  }
  return undefined;
}

function codeSpan(reading: Reading, at: number): number {
  const run = runLength(reading.line, at, TICK);
  const close = closingTicks(reading, at + run, run);
  if (close === undefined) return at + run;
  const words = reading.line.slice(at + run, close);
  const padded = words.length >= 2 && words.startsWith(SPACE) && words.endsWith(SPACE);
  const pad = padded && words.trim() !== "" ? 1 : 0;
  const syntax: number[] = [];
  for (let each = at; each < at + run + pad; each += 1) syntax.push(each);
  for (let each = close - pad; each < close + run; each += 1) syntax.push(each);
  const range = { start: at + run + pad, end: close - pad, mark: { name: INLINE_MARK.CODE } };
  reading.codes.push({ range, syntax });
  for (const each of syntax) reading.dropped[each] = true;
  return close + run;
}

function closedBracket(
  reading: Reading,
  at: number,
  brackets: Bracket[],
  delimiters: Delimiter[],
): number {
  const opener = brackets.pop();
  if (opener === undefined || !opener.active || opener.at + 1 === at) return at + 1;
  const target = LINK_TARGET.exec(reading.line.slice(at + 1));
  const syntax = target?.[0].length ?? 0;
  if (target === null || atomWithin(reading, at + 1, at + 1 + syntax)) return at + 1;
  if (reading.line[opener.at + 1] === MENTION_SIGIL) return at + 1;
  emphasis(reading, delimiters, opener.bottom);
  reading.ranges.push({
    start: opener.at + 1,
    end: at,
    mark: { name: INLINE_MARK.LINK, href: target[1] },
  });
  drop(reading, opener.at, opener.at + 1);
  drop(reading, at, at + 1 + syntax);
  for (const each of brackets) each.active = false;
  return at + 1 + syntax;
}

function scanned(reading: Reading): void {
  const { line } = reading;
  const delimiters: Delimiter[] = [];
  const brackets: Bracket[] = [];
  let at = 0;
  while (at < line.length) {
    const atomEnd = reading.atoms.get(at);
    const char = line[at] ?? "";
    if (atomEnd !== undefined) at = atomEnd;
    else if (char === BACKSLASH && ASCII_PUNCTUATION.test(line[at + 1] ?? "")) {
      reading.escapes.push(at);
      at += 2;
    } else if (char === TICK) at = codeSpan(reading, at);
    else if (char === STAR || char === TILDE) {
      const run = runLength(line, at, char);
      if (char === STAR || run === STRIKE_RUN) {
        delimiters.push({ char, at, length: run, origin: run, ...flanking(line, at, run) });
      }
      at += run;
    } else if (char === OPEN_BRACKET && line[at - 1] !== BANG) {
      brackets.push({ at, bottom: delimiters.length, active: true });
      at += 1;
    } else if (char === CLOSE_BRACKET) at = closedBracket(reading, at, brackets, delimiters);
    else at += 1;
  }
  emphasis(reading, delimiters, 0);
}

function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function settledCodes(reading: Reading): void {
  for (const code of reading.codes) {
    if (reading.ranges.some((each) => overlaps(each, code.range))) {
      for (const each of code.syntax) reading.dropped[each] = false;
    } else reading.ranges.push(code.range);
  }
}

function settledEscapes(reading: Reading): void {
  for (const at of reading.escapes) {
    const marked = reading.ranges.some(
      (range) => range.mark.name !== INLINE_MARK.CODE && at >= range.start && at < range.end,
    );
    if (marked) reading.dropped[at] = true;
  }
}

function sameMarks(a: readonly InlineMark[], b: readonly InlineMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((mark) => b.some((each) => each.name === mark.name && each.href === mark.href))
  );
}

export function readInline(line: string, atoms: readonly LineRange[]): InlineSpan[] {
  const reading: Reading = {
    line,
    atoms: new Map(atoms.map((atom) => [atom.start, atom.end])),
    dropped: Array.from({ length: line.length }, () => false),
    ranges: [],
    codes: [],
    escapes: [],
  };
  scanned(reading);
  settledCodes(reading);
  settledEscapes(reading);
  const spans: InlineSpan[] = [];
  let words: { from: number; to: number; marks: readonly InlineMark[] } | undefined;
  const flush = () => {
    if (words !== undefined) spans.push({ kind: INLINE_SPAN.WORDS, ...words });
    words = undefined;
  };
  let at = 0;
  while (at < line.length) {
    const atomEnd = reading.atoms.get(at);
    if (atomEnd !== undefined) {
      flush();
      spans.push({ kind: INLINE_SPAN.ATOM, from: at, to: atomEnd });
      at = atomEnd;
      continue;
    }
    if (reading.dropped[at] === true) {
      flush();
      at += 1;
      continue;
    }
    const marks = reading.ranges
      .filter((range) => at >= range.start && at < range.end)
      .map((range) => range.mark);
    if (words !== undefined && sameMarks(words.marks, marks)) words.to = at + 1;
    else {
      flush();
      words = { from: at, to: at + 1, marks };
    }
    at += 1;
  }
  flush();
  return spans;
}

function ordered(marks: readonly InlineMark[]): InlineMark[] {
  return [...marks].sort((a, b) => MARK_ORDER.indexOf(a.name) - MARK_ORDER.indexOf(b.name));
}

function writtenAddress(href: string): string {
  return href.replace(
    ADDRESS_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function opening(mark: InlineMark): string {
  if (mark.name === INLINE_MARK.LINK) return OPEN_BRACKET;
  if (mark.name === INLINE_MARK.BOLD) return STAR.repeat(2);
  if (mark.name === INLINE_MARK.ITALIC) return STAR;
  return TILDE.repeat(STRIKE_RUN);
}

function closing(mark: InlineMark): string {
  if (mark.name !== INLINE_MARK.LINK) return opening(mark);
  return `${CLOSE_BRACKET}(${writtenAddress(mark.href ?? "")})`;
}

function codeFences(words: string): { fence: string; pad: string } {
  const longest = Math.max(0, ...(words.match(TICK_RUNS) ?? []).map((run) => run.length));
  const between = words.startsWith(SPACE) && words.endsWith(SPACE) && words.trim() !== "";
  const pad = words.startsWith(TICK) || words.endsWith(TICK) || between ? SPACE : "";
  return { fence: TICK.repeat(longest + 1), pad };
}

function keptOpen(open: readonly InlineMark[], marks: readonly InlineMark[]): number {
  const kept = open.findIndex(
    (mark) => !marks.some((each) => each.name === mark.name && each.href === mark.href),
  );
  return kept === -1 ? open.length : kept;
}

export function writeInline(pieces: readonly InlinePiece[]): {
  readonly text: string;
  readonly segments: readonly WrittenSegment[];
} {
  let text = "";
  const segments: WrittenSegment[] = [];
  const open: InlineMark[] = [];
  let trailing: { piece: number; from: number; words: string } | undefined;
  const write = (words: string, piece?: number, from = 0) => {
    if (piece !== undefined && words !== "") {
      segments.push({ piece, from, offset: text.length, length: words.length });
    }
    text += words;
  };
  const writeMarked = (words: string, piece: number, from: number) => {
    let start = 0;
    for (let at = 0; at < words.length; at += 1) {
      if (!MARK_SPECIAL.test(words[at] ?? "")) continue;
      write(words.slice(start, at), piece, from + start);
      text += BACKSLASH;
      start = at;
    }
    write(words.slice(start), piece, from + start);
  };
  const closeTo = (keep: number) => {
    for (let mark = open.pop(); mark !== undefined; mark = open.pop()) {
      if (open.length < keep) {
        open.push(mark);
        break;
      }
      text += closing(mark);
    }
    if (trailing !== undefined) write(trailing.words, trailing.piece, trailing.from);
    trailing = undefined;
  };
  pieces.forEach((piece, index) => {
    const marks = piece.atom ? [] : ordered(piece.marks);
    if (marks.some((mark) => mark.name === INLINE_MARK.CODE)) {
      closeTo(0);
      const { fence, pad } = codeFences(piece.text);
      write(`${fence}${pad}`);
      write(piece.text, index);
      write(`${pad}${fence}`);
      return;
    }
    closeTo(keptOpen(open, marks));
    const lead = LEADING_SPACE.exec(piece.text)?.[0].length ?? 0;
    if (piece.atom || lead === piece.text.length) {
      write(piece.text, piece.atom ? undefined : index);
      return;
    }
    const trail = TRAILING_SPACE.exec(piece.text)?.[0].length ?? 0;
    write(piece.text.slice(0, lead), index);
    for (const mark of marks) {
      if (open.some((each) => each.name === mark.name && each.href === mark.href)) continue;
      text += opening(mark);
      open.push(mark);
    }
    const core = piece.text.slice(lead, piece.text.length - trail);
    if (marks.length === 0) write(core, index, lead);
    else writeMarked(core, index, lead);
    if (trail > 0) {
      trailing = { piece: index, from: piece.text.length - trail, words: piece.text.slice(-trail) };
    }
  });
  closeTo(0);
  return { text, segments };
}
