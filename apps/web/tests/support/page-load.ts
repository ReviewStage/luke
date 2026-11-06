import { vi } from "vitest";

export function pageLoadedBy(type: NavigationTimingType | undefined): void {
  const loaded = {
    name: location.href,
    entryType: "navigation",
    startTime: 0,
    duration: 0,
    type,
    toJSON: () => ({ type }),
  };
  vi.spyOn(performance, "getEntriesByType").mockImplementation((kind) =>
    kind === "navigation" && type !== undefined ? [loaded] : [],
  );
}
