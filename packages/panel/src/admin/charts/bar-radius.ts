const BAR_RADIUS_TOKEN = "--ui-radius-6";

let barRadiusPixels: number | undefined;

export function barRadius(): number {
  if (barRadiusPixels !== undefined) return barRadiusPixels;
  const pixels = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(BAR_RADIUS_TOKEN),
  );
  if (Number.isNaN(pixels)) return 0;
  barRadiusPixels = pixels;
  return pixels;
}

export function barTopRadius(): [number, number, number, number] {
  const radius = barRadius();
  return [radius, radius, 0, 0];
}
