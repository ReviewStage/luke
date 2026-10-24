import { DRAFT_PLACE, type LineCommentPlace } from "../composer-drafts.js";
import type { DiffListSelection } from "../diff-view/contract.js";
import type { CommentLines } from "./changes-model.js";

/**
 * comment-drafts.ts -- the line comments a member has open in Files changed, several at once across lines and files, and the words written in each, kept above the list so a comment scrolled out of it and back loses nothing.
 *
 * A comment is open on the lines it was picked on, and stands under the
 * last of them, as GitHub anchors a review thread at its last line: one
 * comment per last line and side, so picking lines that end where an open
 * comment ends moves that comment onto them rather than opening a second.
 * Its words are not kept here but in the drafts store (`composer-drafts.ts`),
 * by its agent, file, side, and last line (`lineCommentPlace`), apart from
 * whether it stands open, so a comment closed unsent and opened there again
 * comes back with what was written, after the tab closed or the window
 * reloaded as well; a comment GitHub took lets its words go. The lines of
 * the comment opened or written in last stand lit (`lit`).
 */

/** One comment open on lines of a file: its own key, the lines as picked, and as GitHub takes them. */
export interface CommentDraft {
  readonly id: string;
  readonly picked: DiffListSelection;
  readonly lines: CommentLines;
}

/** The comments open, in the order they were opened, and which comment's lines stand lit. */
export interface CommentDrafts {
  readonly open: readonly CommentDraft[];
  readonly lit: string | undefined;
}

/** No comment open. */
export const NO_DRAFTS: CommentDrafts = { open: [], lit: undefined };

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

/** Closes a comment, its words kept in the drafts store; the lines of the one opened last before it stand lit where its did. */
export function closeDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  const open = drafts.open.filter((draft) => draft.id !== id);
  return { ...drafts, open, lit: drafts.lit === id ? open.at(-1)?.id : drafts.lit };
}

/** Lights a comment's lines, as its words take the keyboard. */
export function lightDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  return drafts.lit === id ? drafts : { ...drafts, lit: id };
}

/** Where the words of a comment on an agent's changes are kept: by the agent, the file, and the side and last line it stands under. */
export function lineCommentPlace(agentId: string, draft: CommentDraft): LineCommentPlace {
  const { side, line } = draft.lines;
  return { kind: DRAFT_PLACE.LINE_COMMENT, agentId, path: draft.picked.path, side, line };
}

/**
 * The words written in the replies and the edits a member closed unsent,
 * held by the id of the thread or of the pending comment they were written
 * on, so opening one again brings them back. A reply or an edit GitHub took
 * lets its words go, and so does one written back to what it began from.
 */
export interface HeldBodies {
  /** The words held for `id`; none where nothing is held. */
  readonly of: (id: string) => string | undefined;
  /** Holds `body` for `id`, or lets the place go where it is `undefined`. */
  readonly keep: (id: string, body: string | undefined) => void;
}

/** A place that holds words, empty. */
export function heldBodies(): HeldBodies {
  // Note that this is a mutable map, because it is read as a box opens and written as words are typed, and neither should draw every thread of the tab again.
  const held = new Map<string, string>();
  return {
    of: (id) => held.get(id),
    keep: (id, body) => {
      if (body === undefined) held.delete(id);
      else held.set(id, body);
    },
  };
}
