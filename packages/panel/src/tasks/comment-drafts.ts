import type { DiffSide } from "@luke/features/coding-agent-wire";
import type { DiffListSelection } from "../diff-view/contract.js";
import type { CommentLines } from "./changes-model.js";

/**
 * comment-drafts.ts -- the line comments a member has open in Files changed, several at once across lines and files, and the words written in each, kept above the list so a comment scrolled out of it and back loses nothing.
 *
 * A comment is open on the lines it was picked on, and stands under the
 * last of them, as GitHub anchors a review thread at its last line: one
 * comment per last line and side, so picking lines that end where an open
 * comment ends moves that comment onto them rather than opening a second.
 * Its words are kept by its file, side, and last line, apart from whether
 * it stands open, so a comment closed unsent and opened there again comes
 * back with what was written; a comment GitHub took lets its words go. The
 * lines of the comment opened or written in last stand lit (`lit`).
 */

/** One comment open on lines of a file: its own key, the lines as picked, and as GitHub takes them. */
export interface CommentDraft {
  readonly id: string;
  readonly picked: DiffListSelection;
  readonly lines: CommentLines;
}

/** Words written, by file, by the side and the last line of the lines they are on. */
type HeldWords = ReadonlyMap<string, ReadonlyMap<DiffSide, ReadonlyMap<number, string>>>;

/** The comments open, in the order they were opened, the words kept for each place, and which comment's lines stand lit. */
export interface CommentDrafts {
  readonly open: readonly CommentDraft[];
  readonly words: HeldWords;
  readonly lit: string | undefined;
}

/** No comment open and nothing written. */
export const NO_DRAFTS: CommentDrafts = { open: [], words: new Map(), lit: undefined };

/** Whether a comment ends on the same line, on the same side, of the same file. */
function endsAt(draft: CommentDraft, path: string, lines: CommentLines): boolean {
  return (
    draft.picked.path === path && draft.lines.side === lines.side && draft.lines.line === lines.line
  );
}

/** Opens a comment on the lines picked, under the key `id`, or moves the one ending where they end onto them; either stands lit. */
export function openDraft(
  drafts: CommentDrafts,
  picked: DiffListSelection,
  lines: CommentLines,
  id: string,
): CommentDrafts {
  const was = drafts.open.find((draft) => endsAt(draft, picked.path, lines));
  const draft = { id: was?.id ?? id, picked, lines };
  const open =
    was === undefined
      ? [...drafts.open, draft]
      : drafts.open.map((each) => (each === was ? draft : each));
  return { ...drafts, open, lit: draft.id };
}

/** Closes a comment, keeping its words; the lines of the one opened last before it stand lit where its did. */
export function closeDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  const open = drafts.open.filter((draft) => draft.id !== id);
  return { ...drafts, open, lit: drafts.lit === id ? open.at(-1)?.id : drafts.lit };
}

/** Lights a comment's lines, as its words take the keyboard. */
export function lightDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  return drafts.lit === id ? drafts : { ...drafts, lit: id };
}

/** The words written where a comment stands. */
export function wordsOf(drafts: CommentDrafts, draft: CommentDraft): string {
  return drafts.words.get(draft.picked.path)?.get(draft.lines.side)?.get(draft.lines.line) ?? "";
}

/** Keeps the words written where a comment stands; none written lets the place go. */
export function withWords(drafts: CommentDrafts, draft: CommentDraft, body: string): CommentDrafts {
  const { path } = draft.picked;
  const { side, line } = draft.lines;
  const sides = drafts.words.get(path) ?? new Map<DiffSide, ReadonlyMap<number, string>>();
  const onSide = new Map(sides.get(side));
  if (body === "") onSide.delete(line);
  else onSide.set(line, body);
  return { ...drafts, words: new Map(drafts.words).set(path, new Map(sides).set(side, onSide)) };
}
