import type { NavigationHistory } from "../renderer/navigation-history";

const ignore = () => undefined;

/** A window's history with nothing behind it and nothing ahead, every press ignored. */
export function navigationHistory(overrides: Partial<NavigationHistory> = {}): NavigationHistory {
  return {
    canGoBack: false,
    canGoForward: false,
    onBack: ignore,
    onForward: ignore,
    ...overrides,
  };
}
