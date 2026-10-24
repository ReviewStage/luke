/**
 * live-region-guard.ts -- what the `no-hand-written-live-region` rule reads:
 * which roles and attributes make an element a live region. Anything read
 * aloud goes through `announce(ANNOUNCE.POLITE | ANNOUNCE.ALERT, words)` and
 * the one `Announcer` (`@luke/ui`), so outside `@luke/ui` no intrinsic
 * element is one. The rule started clean, so it takes no baseline.
 */
export const LIVE_REGION_GUARD_RULE = "anti-slop/no-hand-written-live-region";

/** The roles that are live regions of themselves. */
export const LIVE_REGION_ROLES: ReadonlySet<string> = new Set(["status", "alert", "log"]);

/** The attribute that makes any element one; even `off` is a region written by hand. */
export const LIVE_ATTRIBUTE = "aria-live";
