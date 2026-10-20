/**
 * sentry-early-reports.ts -- what a window or a tab reports before its Sentry SDK, a chunk loaded off the critical path, stands: kept for it, a few at most, and said once it does.
 *
 * The web tab (`apps/web/src/app/web-sentry.ts`) and each desktop window
 * (`apps/desktop/src/renderer/desktop-sentry.ts`) load the SDK as a chunk of
 * their own rather than parse it before they draw, so a report can come
 * before the SDK it is said to. This module names no SDK: each caller hands
 * the promise of its own, and the reports are said to whatever it answers.
 */

/** One report, said to the SDK once it stands. */
type EarlyReport<Sdk> = (sdk: Sdk) => void;

/** Where reports are said before the SDK may stand, and when it has, or never will. */
export interface EarlyReports<Sdk> {
  /** Whether the report was sent or kept to be sent; false where it was dropped. */
  readonly say: (report: EarlyReport<Sdk>) => boolean;
  /** Settles once the SDK stands, or never will, and what was said before then was sent or dropped. */
  readonly settled: Promise<void>;
}

/**
 * Says each report to the SDK once `started` settles: at once where it
 * stands, kept until then where it does not yet (the first `kept` of them,
 * so a surface failing in a loop while the chunk loads holds no more than
 * these), and dropped where it never will, `started` answering nothing.
 */
export function reportsOnceStarted<Sdk>(
  started: Promise<Sdk | undefined>,
  kept: number,
): EarlyReports<Sdk> {
  let standing: Sdk | undefined;
  let early: EarlyReport<Sdk>[] | undefined = [];
  const settled = started.then((sdk) => {
    const waiting = early ?? [];
    standing = sdk;
    early = undefined;
    if (sdk !== undefined) for (const report of waiting) report(sdk);
  });
  const say = (report: EarlyReport<Sdk>): boolean => {
    if (standing !== undefined) report(standing);
    else if (early !== undefined && early.length < kept) early.push(report);
    else return false;
    return true;
  };
  return { say, settled };
}
