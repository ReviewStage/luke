import type { WindowHistory } from "../renderer/navigation-history";

const ignore = () => undefined;

/** A window's history with nothing behind it and nothing ahead, every press ignored. */
export function navigationHistory(overrides: Partial<WindowHistory> = {}): WindowHistory {
  return {
    canGoBack: false,
    canGoForward: false,
    onBack: ignore,
    onForward: ignore,
    onLeaveVersionHistory: ignore,
    ...overrides,
  };
}
