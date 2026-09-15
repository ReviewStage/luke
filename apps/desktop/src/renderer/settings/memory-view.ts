import type { NotebookFile, NotebookReadResult } from "@sidecar/gateway";

/**
 * How the Memory page reads what Luke has saved: the words beside each file
 * and the states the page moves through, kept apart from the component so
 * they can be asserted without a DOM.
 *
 * The page is a debugging window onto the notebook and says so in its
 * vocabulary: a file is named by the path the service holds it under rather
 * than a friendlier title, because the path is what Luke's own tools and
 * the privacy statement call it, and a reader here is checking what he
 * saved rather than being told a story about it.
 */

/** Where the page stands: nothing asked yet or a read under way, a notebook drawn, or a read that came back empty-handed. */
export const MEMORY_VIEW_STATUS = {
  READING: "reading",
  READ: "read",
  UNREADABLE: "unreadable",
} as const;

export type MemoryView =
  | { status: typeof MEMORY_VIEW_STATUS.READING }
  | { status: typeof MEMORY_VIEW_STATUS.READ; notebook: NotebookReadResult }
  | { status: typeof MEMORY_VIEW_STATUS.UNREADABLE };

/** Why the page holds nothing while signed out: the notebook is the account's, on the service. */
export const MEMORY_SIGNED_OUT_NOTE =
  "Sign in to see what Luke has saved. His memory lives with your account.";

/** What the page says when the service could not be asked or did not answer. */
export const MEMORY_UNREADABLE_NOTE = "Luke's memory could not be read just now.";

/** What the page says when the account holds a notebook with nothing in it yet. */
export const MEMORY_EMPTY_NOTE = "Luke has not saved anything yet.";

/** How a page's own record of the notebook is described, so a reader knows this is a window and not a place to write. */
export const MEMORY_PAGE_NOTE =
  "What Luke has saved on the service, read-only. He writes it himself as you talk; ask him to remember, correct, or forget something.";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The line under a file's name: when it last changed, and — for a file the
 * service cut at its bound — how much of it travelled, so a reader is never
 * shown the head of a file as if it were the whole.
 */
export function notebookFileNote(file: NotebookFile): string {
  const updated = `Updated ${DATE_FORMAT.format(new Date(file.updatedAt))}`;
  if (file.content.length >= file.chars) return updated;
  return `${updated} · showing the first ${file.content.length.toLocaleString()} of ${file.chars.toLocaleString()} characters`;
}

/** The line that closes the page when older notes stand behind the ones shown. */
export function notebookOmittedNote(omittedNotes: number): string | undefined {
  if (omittedNotes <= 0) return undefined;
  return omittedNotes === 1
    ? "1 older note is not shown."
    : `${omittedNotes.toLocaleString()} older notes are not shown.`;
}
