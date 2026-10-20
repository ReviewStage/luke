/**
 * annotation-bands.ts -- which notes under a diff's lines continue the change band of the line they stand under: an added line's or a removed line's, so a comment in the middle of a change reads as standing in it rather than cutting it in two.
 *
 * Pierre draws a note under a line as a row of its own in the code's column,
 * a `[data-line-annotation]` right after the line's row, and a buffer of the
 * same height in the numbers' column beside it, the column's buffers in the
 * order the column's notes stand. Neither says what the line above it is, so
 * each is marked here with the band of that line (`ANNOTATION_BAND_ATTRIBUTE`),
 * read off the line's own `data-line-type`, as the file is drawn; the
 * diff's look paints a marked row's code and numbers as that line's, and its
 * change bar beside them (`index.ts`'s `LOOK_CSS`). A note under an
 * unchanged line, above a file's first hunk, or in a diff drawn with no
 * backgrounds (`data-background` gone from its `pre`) is left unmarked, so
 * it keeps the diff's plain ground.
 */

/** The attribute a note's row and its numbers' buffer wear, saying which change's band it continues. */
export const ANNOTATION_BAND_ATTRIBUTE = "data-band";

/** Which change's band a note continues. */
export const ANNOTATION_BAND = {
  ADDITION: "addition",
  DELETION: "deletion",
} as const;

type AnnotationBand = (typeof ANNOTATION_BAND)[keyof typeof ANNOTATION_BAND];

/** The band of a line, by the type Pierre writes on its row; none for a line no change band runs through. */
function bandOfLine(row: Element | null): AnnotationBand | undefined {
  switch (row?.getAttribute("data-line-type")) {
    case "change-addition":
      return ANNOTATION_BAND.ADDITION;
    case "change-deletion":
      return ANNOTATION_BAND.DELETION;
    default:
      return undefined;
  }
}

/** Marks an element with a band, or takes the mark off where none is given. */
function mark(element: Element | undefined, band: AnnotationBand | undefined): void {
  if (element === undefined) return;
  if (band === undefined) element.removeAttribute(ANNOTATION_BAND_ATTRIBUTE);
  else element.setAttribute(ANNOTATION_BAND_ATTRIBUTE, band);
}

/**
 * Marks every note drawn in a file's shadow root, its row and its buffer in
 * the numbers' column beside it, with the band of the line it stands
 * under; a diff drawn with no backgrounds marks none.
 */
export function markAnnotationBands(root: ParentNode): void {
  const banded = root.querySelector("pre[data-background]") !== null;
  for (const content of root.querySelectorAll("[data-content]")) {
    const gutter = [...(content.parentElement?.children ?? [])].find((sibling) =>
      sibling.hasAttribute("data-gutter"),
    );
    const buffers = [...(gutter?.children ?? [])].filter(
      (child) => child.getAttribute("data-gutter-buffer") === "annotation",
    );
    const rows = [...content.children].filter((child) =>
      child.hasAttribute("data-line-annotation"),
    );
    rows.forEach((row, at) => {
      const band = banded ? bandOfLine(row.previousElementSibling) : undefined;
      mark(row, band);
      mark(buffers[at], band);
    });
  }
}
