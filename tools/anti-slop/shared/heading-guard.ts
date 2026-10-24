/**
 * heading-guard.ts -- what the `no-raw-heading-outside-ui` rule reads: which
 * intrinsic elements are headings. Outside `@luke/ui`, words that head a
 * section are drawn with `Text`, which keeps the element for the outline
 * (`as`) and takes the look from a type role, so no sheet sets a heading's
 * font. The rule started clean, so it takes no baseline.
 */
export const HEADING_GUARD_RULE = "anti-slop/no-raw-heading-outside-ui";

/** The intrinsic elements that are headings. */
export const RAW_HEADING_ELEMENTS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
