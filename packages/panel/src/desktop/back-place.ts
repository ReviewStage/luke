import type { NavigationHistory } from "../navigation-history.js";

const UNNAMED_PLACE = "the previous page";

export function backPlaceOf(history: NavigationHistory, fallback: string): string {
  if (!history.canGoBack) return fallback;
  return history.steps.back[0]?.title?.label ?? UNNAMED_PLACE;
}
