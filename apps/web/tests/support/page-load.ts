/**
 * page-load.ts -- the browser saying how it loaded the page, as `performance` answers for its navigation entry: by a navigation, a reload, a Back or Forward, or saying nothing at all.
 */

import { vi } from "vitest";

/** The browser saying it loaded the page by `type`, or saying nothing, until `vi.restoreAllMocks()`. */
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
