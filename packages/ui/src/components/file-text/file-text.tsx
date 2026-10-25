/**
 * file-text.tsx -- a file's words as they are written: monospaced, kept line for line, on the code's ground, a peek of its head or the whole of it scrolling in place.
 *
 * What an agent will read is shown as it stands, before anyone trusts it: a
 * skill's `SKILL.md` opened under its card, or the text a member pasted.
 * Nothing is parsed or drawn as Markdown, because the words an agent reads
 * are the raw ones. A peek (`FILE_TEXT_EXTENT.PEEK`) holds its first lines
 * and fades out over its last, its words still selectable but nothing to
 * scroll; the whole (`FILE_TEXT_EXTENT.WHOLE`) stands up to a reading
 * height and scrolls inside itself past it, taking the keyboard so a reader
 * scrolls it from the keys too, and a brief one (`FILE_TEXT_EXTENT.BRIEF`)
 * does the same within a peek's height, for a card the text must not fill. Long lines wrap rather than run sideways.
 * It is a region named for a reader by `label`, the file it shows.
 */

/** How much of the file stands: its head, faded, or the whole of it in a scroller of a reading height or a peek's. */
export const FILE_TEXT_EXTENT = {
  PEEK: "peek",
  WHOLE: "whole",
  BRIEF: "brief",
} as const;

export type FileTextExtent = (typeof FILE_TEXT_EXTENT)[keyof typeof FILE_TEXT_EXTENT];

/** A file's text, as written, at the extent asked. */
export function FileText({
  text,
  label,
  extent = FILE_TEXT_EXTENT.WHOLE,
}: {
  text: string;
  /** What the file is, for a reader: "grill-me's SKILL.md". */
  label: string;
  extent?: FileTextExtent;
}): React.JSX.Element {
  const scrolls = extent !== FILE_TEXT_EXTENT.PEEK;
  return (
    <section
      className="luke-file-text"
      data-extent={extent}
      aria-label={label}
      // Note that only a peek does not scroll, so every other extent takes a place in the Tab order.
      tabIndex={scrolls ? 0 : undefined}
    >
      <pre className="luke-file-text-words">{text}</pre>
    </section>
  );
}
