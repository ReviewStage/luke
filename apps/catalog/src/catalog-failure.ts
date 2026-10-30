/**
 * catalog-failure.ts -- the failure every catalog example of a failure drawn in place stands on: reported nowhere, its details a fixed block like the one the panel builds, copied to the browser's own clipboard.
 */

import type { ReportedFailure } from "@luke/ui/reported-failure";

/** What a failure's Copy details puts on the clipboard, as the panel builds it from the failure's report. */
const FAILURE_DETAILS = [
  "Luke showed an error. Find it in Sentry and the logs by these details:",
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: tasks.read",
  "failure.kind: unexpected",
  "failure.code: unread",
].join("\n");

/** A failure as the panel would hand it, for an example to draw. */
export const CATALOG_FAILURE: ReportedFailure = {
  shown: () => FAILURE_DETAILS,
  hidden: () => undefined,
  copy: (text) => navigator.clipboard.writeText(text),
};
