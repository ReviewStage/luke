import type { ReactNode } from "react";

/**
 * composer-body.tsx -- the words of a message box, and over them the files handed to it, as the sent message draws them.
 *
 * A message carries its files over its words: the transcript and the Inbox
 * draw a sent one's pictures and chips first and its words under
 * them. Every box a message is written in holds them the same way, so the
 * message reads as it will once sent: the files' row first, in a row that
 * wraps, then the field. The row comes first in the document too, so Tab
 * walks a file's open and its way off before it reaches the words, as the
 * eye does.
 *
 * It owns the order and nothing else: the field is the owner's, and what
 * stands over the files (a question's controls, a send that did not go) and
 * the foot under the field (`ComposerFoot`) stay where the owner puts them.
 * A row that holds nothing drawn takes no room. It is drawn in Tailwind
 * utilities over the theme, inset as the foot under the field stands in its
 * frame (`ComposerFrame`'s look).
 */

/**
 * The files' row: at a card's inset, a step tighter in a field's or an
 * input's well, and flush with the words under it in a bare frame, since the
 * card around it insets both; hidden while it holds nothing drawn.
 */
const FILES =
  "luke-composer-files flex flex-wrap gap-tight-gap px-luke-12 pt-luke-12 pb-0 " +
  "group-data-[look=field]/composer:px-luke-6 group-data-[look=field]/composer:pt-luke-6 " +
  "group-data-[look=input]/composer:px-luke-6 group-data-[look=input]/composer:pt-luke-6 " +
  "group-data-[look=bare]/composer:p-0 [&:not(:has(>:not([hidden])))]:hidden";

/** A box's field, `children`, under the chips of the files handed to it, where it holds any. */
export function ComposerBody({
  files,
  children,
}: {
  /** The chips of the files handed to the box, where it holds any. */
  files?: ReactNode;
  /** The box's field. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      {files === undefined || files === null ? null : <div className={FILES}>{files}</div>}
      {children}
    </>
  );
}
