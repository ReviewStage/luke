/**
 * bar-radius.ts -- the corner a chart's bars are rounded with.
 *
 * Recharts rounds a bar from a number of pixels, which a CSS value cannot
 * stand in for, so the number is read from the radius token the stylesheet
 * draws every other small corner with, once, rather than written beside each
 * bar. Where no stylesheet is loaded (a test's bare document) the bars stand
 * square rather than at a corner of the chart's own. The admin is drawn in the
 * browser alone, so there is always a document to read.
 */

const BAR_RADIUS_TOKEN = "--luke-radius-6";

let barRadiusPixels: number | undefined;

/** The corner of a bar that stands alone, in pixels. */
export function barRadius(): number {
  if (barRadiusPixels !== undefined) return barRadiusPixels;
  const pixels = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(BAR_RADIUS_TOKEN),
  );
  // Held only once read, so a bar drawn before the stylesheet loads does not fix square corners.
  if (Number.isNaN(pixels)) return 0;
  barRadiusPixels = pixels;
  return pixels;
}

/** The corners of the top bar of a stack, or of a column: rounded above, square below. */
export function barTopRadius(): [number, number, number, number] {
  const radius = barRadius();
  return [radius, radius, 0, 0];
}
