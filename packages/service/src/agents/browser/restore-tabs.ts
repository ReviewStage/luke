/**
 * restore-tabs.ts -- an agent's Browser tabs brought back whenever its browser lost them: each tab the service keeps that the browser no longer holds reopened at its last address, as the same tab.
 *
 * A sandbox's stop snapshots its disk, the browser's profile among it, and
 * not the pages the browser held, so a browser that starts in a resumed
 * sandbox holds none of the tabs the service still lists for its agent
 * (`@luke/database/models/agent-browser-tabs`). Whoever reaches the
 * browser, the agent's `browser` tool or a member's live view, connects
 * through `connectRestoring`, which reopens every kept tab the browser does
 * not hold at its address and moves its row onto the new target, keeping
 * its id, its opener, and a member's takeover, so a window that lists the
 * task's tabs sees the same tabs as before.
 *
 * Note that this is read from the browser on every connection rather than
 * from whether this connection's start began the browser, because that
 * answer reaches one caller once: a caller whose connection failed or was
 * given up on after the start, as a live view's often is during a minute's
 * resume, would leave every later caller attached to a browser without the
 * tabs, and the agent's next `list` would then drop them for good. Two
 * callers reopening at once each open a page, and the row moves for the one
 * whose move lands first; the other closes its page again, as a caller
 * does whose move the store could not take. A tab that would not reopen
 * keeps its row, for the next connection to try again, since only the
 * agent's own `close` drops a tab, and a browser that could not list its
 * pages is left for the next connection too. Nothing a page holds is
 * logged, a failure only by its kind.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { listAgentBrowserTabs, retargetBrowserTab } from "@luke/database/models/agent-browser-tabs";
import type { CdpSession } from "@luke/features/browser-cdp";
import { Effect, type Scope } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { AgentBrowser, type BrowserUnreachable } from "./agent-browser.js";

/**
 * Reopens each tab kept for the agent whose conversation is named that the
 * browser does not hold, at its last address, in the order it was first
 * opened, and moves its row onto the new target. A tab the browser already
 * holds is left as it is.
 */
export function restoreBrowserTabs(
  conversationId: string,
  cdp: CdpSession,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.gen(function* () {
    const rows = yield* listAgentBrowserTabs(conversationId);
    if (rows.length === 0) return;
    // Note that a browser that could not say which pages it holds is left as it is, since every
    // kept tab would otherwise read as lost and be opened twice; the next connection asks again.
    const pages = yield* Effect.result(cdp.pages);
    if (pages._tag === "Failure") {
      return yield* Effect.logWarning(`The Browser tabs were not read: ${pages.failure.kind}`);
    }
    const held = new Set(pages.success.map((page) => page.targetId));
    for (const row of rows) {
      if (held.has(row.targetId)) continue;
      const reopened = yield* Effect.result(cdp.openPage(row.address));
      if (reopened._tag === "Failure") {
        yield* Effect.logWarning(`A Browser tab did not reopen: ${reopened.failure.kind}`);
        continue;
      }
      const page = reopened.success;
      // A page whose row did not move, because the store failed or another caller moved it first, goes.
      const unkept = Effect.ignore(cdp.closePage(page));
      const moved = yield* retargetBrowserTab(conversationId, row.id, row.targetId, page).pipe(
        Effect.onError(() => unkept),
      );
      if (!moved) yield* unkept;
    }
  }).pipe(Effect.tapError(logStoreFailure), Effect.ignore);
}

/**
 * Connects to the agent's browser in the sandbox the session names, for the
 * caller's scope, every kept tab it does not hold reopened first.
 */
export function connectRestoring(
  browserSession: string,
  conversationId: string,
): Effect.Effect<CdpSession, BrowserUnreachable, AgentBrowser | DatabaseServices | Scope.Scope> {
  return Effect.gen(function* () {
    const browser = yield* AgentBrowser;
    const cdp = yield* browser.connect(browserSession);
    yield* restoreBrowserTabs(conversationId, cdp);
    return cdp;
  });
}
