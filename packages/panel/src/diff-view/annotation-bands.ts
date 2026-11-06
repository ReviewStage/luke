export const ANNOTATION_BAND_ATTRIBUTE = "data-band";

export const ANNOTATION_BAND = {
  ADDITION: "addition",
  DELETION: "deletion",
} as const;

type AnnotationBand = (typeof ANNOTATION_BAND)[keyof typeof ANNOTATION_BAND];

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

function mark(element: Element | undefined, band: AnnotationBand | undefined): void {
  if (element === undefined) return;
  if (band === undefined) element.removeAttribute(ANNOTATION_BAND_ATTRIBUTE);
  else element.setAttribute(ANNOTATION_BAND_ATTRIBUTE, band);
}

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
