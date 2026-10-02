import { PLAN_EMPTY_TEXT } from "@sidecar/hosted/plan-template";

/**
 * plan-diff.ts -- where one unit of the plan differs from its newer words: the edits a person would make, word by word, and a line moved whole.
 *
 * The plan's typing plays these edits one at a time, so they are cut the way
 * someone editing a document would make them rather than the shortest way:
 * whole words, a lone shared word between two changes folded into one change,
 * and a line that left one place and arrived unchanged at another paired as
 * a move. While a field is still streaming in, its newer words are cut off
 * partway, and `heldWords` says how far they can be trusted. Everything here
 * is pure.
 */

/** The most cells a longest-common-run table may hold before a change is taken as one replacement. */
const MAX_TABLE_CELLS = 1_000_000;

/** The shortest line, without its break, worth playing as a move rather than an erase and a retype. */
const MOVE_MIN_CHARS = 8;

/**
 * A word, a space, a line break, or a single mark: the units an edit is made
 * of. Note that spaces are one apiece, so the gap a word was erased from
 * still matches the single space around the word typed into it.
 */
const TOKEN = /\n|[^\S\n]|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Which half of a move a hunk is: the line cut from its old place, or the same line where it lands. */
export const MOVE_HALF = {
  CUT: "cut",
  PASTE: "paste",
} as const;

type MoveHalf = (typeof MOVE_HALF)[keyof typeof MOVE_HALF];

/** One change to the old words: the span from `from` to `to` replaced by `insert`, offsets in the old words. */
export interface Hunk {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  /** Set on both halves of a line moved whole. */
  readonly move?: MoveHalf;
}

const PLACEHOLDERS: ReadonlySet<string> = new Set(Object.values(PLAN_EMPTY_TEXT));

function tokens(words: string): readonly string[] {
  return words.match(TOKEN) ?? [];
}

/**
 * The pairs of positions where the longest run the two sequences share
 * lines up, in order, or nothing when the table would be too large to hold.
 * Note that a tie prefers dropping from the old side first, so a replacement
 * reads as an erase followed by the typing.
 */
function commonPairs(
  old: readonly string[],
  next: readonly string[],
): ReadonlyArray<readonly [number, number]> | undefined {
  const rows = old.length + 1;
  const columns = next.length + 1;
  if (rows * columns > MAX_TABLE_CELLS) return undefined;
  const longest = new Uint32Array(rows * columns);
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      const here = i * columns + j;
      longest[here] =
        old[i] === next[j]
          ? 1 + (longest[here + columns + 1] ?? 0)
          : Math.max(longest[here + columns] ?? 0, longest[here + 1] ?? 0);
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    const here = i * columns + j;
    if (old[i] === next[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((longest[here + columns] ?? 0) >= (longest[here + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
}

/** The same text with one line break taken off either end, which is how a line reads wherever it moved. */
function bareLine(text: string): string {
  return text.replace(/^\n/u, "").replace(/\n$/u, "");
}

/** Whether the span from `from` to `to` of the words is one or more whole lines, with a break on one side. */
function wholeLines(words: string, from: number, to: number): boolean {
  const span = words.slice(from, to);
  const opens = from === 0 || words[from - 1] === "\n" || span.startsWith("\n");
  const closes = to === words.length || words[to] === "\n" || span.endsWith("\n");
  return opens && closes;
}

/**
 * A change that only erases or only inserts, slid along the identical words
 * around it, within `lower` and `upper`, to where it covers whole lines, if
 * there is such a place: the same change, as a hand making it would see it.
 * Note that the words compared see "invite.\n- " as easily as "- ...invite.\n",
 * so a line moved or added is found wherever the comparison happened to cut it.
 */
function lineAligned(old: string, hunk: Hunk, lower: number, upper: number): Hunk {
  const erasing = hunk.insert === "";
  if (erasing === (hunk.from === hunk.to)) return hunk;
  let { from, to } = hunk;
  let words = erasing ? old.slice(from, to) : hunk.insert;
  // Slide to the leftmost place first, then try each place rightward.
  while (from > lower && old[from - 1] === words.at(-1)) {
    words = `${words.at(-1)}${words.slice(0, -1)}`;
    from -= 1;
    to -= 1;
  }
  for (;;) {
    const whole = erasing ? wholeLines(old, from, to) : wholeInsert(old, from, words);
    if (whole) return erasing ? { from, to, insert: "" } : { from, to: from, insert: words };
    if (to >= upper || old[to] !== words[0]) return hunk;
    words = `${words.slice(1)}${words[0]}`;
    from += 1;
    to += 1;
  }
}

/** Whether words inserted at `at` land as whole lines, with a break on one side. */
function wholeInsert(old: string, at: number, words: string): boolean {
  const opens = at === 0 || old[at - 1] === "\n" || words.startsWith("\n");
  const closes = at === old.length || old[at] === "\n" || words.endsWith("\n");
  return opens && closes;
}

/**
 * Pairs a line erased whole in one place with the same line inserted whole
 * in another, marking both halves, so the typing cuts and pastes it rather
 * than erasing it and typing it again.
 */
function pairedMoves(old: string, hunks: readonly Hunk[]): readonly Hunk[] {
  const marked = hunks.map((hunk, index) =>
    lineAligned(old, hunk, hunks[index - 1]?.to ?? 0, hunks[index + 1]?.from ?? old.length),
  );
  marked.forEach((cut, cutIndex) => {
    if (cut.insert !== "" || !wholeLines(old, cut.from, cut.to)) return;
    const line = bareLine(old.slice(cut.from, cut.to));
    if (line.trim().length < MOVE_MIN_CHARS || line.includes("\n")) return;
    const pasteIndex = marked.findIndex(
      (paste) =>
        paste.from === paste.to && paste.move === undefined && bareLine(paste.insert) === line,
    );
    if (pasteIndex === -1) return;
    marked[cutIndex] = { ...cut, move: MOVE_HALF.CUT };
    const paste = marked[pasteIndex];
    if (paste !== undefined) marked[pasteIndex] = { ...paste, move: MOVE_HALF.PASTE };
  });
  return marked;
}

/**
 * One change with the letters both sides share at its ends left standing
 * when it changes one word into another, so a word typed partway carries on
 * rather than being erased and typed again, and "member" becoming "members"
 * types the one letter. A change spanning words is left whole, since a hand
 * selects "an admin" to type "a member" rather than keeping the "a".
 */
function narrowed(old: string, hunk: Hunk): Hunk {
  const { from, insert: typed } = hunk;
  const erased = old.slice(from, hunk.to);
  if (/\s/u.test(erased) || /\s/u.test(typed)) return hunk;
  let head = 0;
  while (head < erased.length && head < typed.length && erased[head] === typed[head]) head += 1;
  let tail = 0;
  while (
    tail < erased.length - head &&
    tail < typed.length - head &&
    erased[erased.length - 1 - tail] === typed[typed.length - 1 - tail]
  ) {
    tail += 1;
  }
  return {
    from: from + head,
    to: from + erased.length - tail,
    insert: typed.slice(head, typed.length - tail),
  };
}

/**
 * Folds two changes separated by a single shared word or space into one, so
 * "the" left standing between two rewritten words does not split the edit
 * into two trips. A shared line break always separates.
 */
function folded(old: string, hunks: readonly Hunk[]): readonly Hunk[] {
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const previous = merged.at(-1);
    const between = previous === undefined ? "" : old.slice(previous.to, hunk.from);
    if (previous !== undefined && !between.includes("\n") && tokens(between).length === 1) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: hunk.to,
        insert: previous.insert + between + hunk.insert,
      };
    } else merged.push(hunk);
  }
  return merged;
}

/**
 * The edits that turn the old words into the newer ones, in document order,
 * offsets in the old words. Words are compared whole, and only the letters
 * that differ at a changed word's ends are touched; a change too large to compare word by word is one replacement of everything between
 * the shared start and the shared end.
 */
export function diffHunks(old: string, next: string): readonly Hunk[] {
  if (old === next) return [];
  const before = tokens(old);
  const after = tokens(next);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const oldMiddle = before.slice(head, before.length - tail);
  const nextMiddle = after.slice(head, after.length - tail);
  const start = before.slice(0, head).join("").length;
  const pairs = commonPairs(oldMiddle, nextMiddle) ?? [];

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let at = start;
  // A sentinel pair past both ends closes the last change.
  for (const [pairI, pairJ] of [...pairs, [oldMiddle.length, nextMiddle.length] as const]) {
    const erased = oldMiddle.slice(i, pairI).join("");
    const typed = nextMiddle.slice(j, pairJ).join("");
    if (erased !== "" || typed !== "")
      hunks.push({ from: at, to: at + erased.length, insert: typed });
    at += erased.length + (oldMiddle[pairI] ?? "").length;
    i = pairI + 1;
    j = pairJ + 1;
  }
  return pairedMoves(
    old,
    folded(old, hunks).map((hunk) => narrowed(old, hunk)),
  );
}

/** Whether a span of old words is a field's empty placeholder, which is cleared at once rather than kept or erased letter by letter. */
export function isPlaceholder(words: string): boolean {
  return PLACEHOLDERS.has(words.trim());
}

/**
 * The words a unit is aimed at while its newer words are still streaming in.
 * The newer words end partway through what the model is writing, so a diff
 * against them would erase every shown line the stream has not reached yet
 * and type it back as the stream catches up, and would read a rewrite cut off
 * partway as a different rewrite. So only growth streams: newer words that
 * carry on from everything shown, a placeholder aside, are typed in as they
 * arrive, and anything else is held as shown until the unit settles and its
 * whole change can be read at once.
 */
export function heldWords(shown: string, streaming: string): string {
  const lines = shown.split("\n");
  const kept = isPlaceholder(lines.at(-1) ?? "") ? lines.slice(0, -1).join("\n") : shown;
  return streaming.startsWith(kept) ? streaming : shown;
}
