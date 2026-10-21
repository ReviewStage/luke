/**
 * restore-tabs.ts -- an agent's Browser tabs brought back once its browser started afresh: each tab the service keeps reopened at its last address, as the same tab.
 *
 * A sandbox's stop snapshots its disk, the browser's profile among it, and
 * not the pages the browser held, so a browser that starts in a resumed
 * sandbox holds none of the tabs the service still lists for its agent
 * (`@luke/database/models/agent-browser-tabs`). Whoever reaches the
 * browser, the agent's `browser` tool or a member's live view, connects
 * through `connectRestoring`: where making sure of the browser started it,
 * every kept tab is opened again at its address and its row moved onto the
 * new target, keeping its id, its opener, and a member's takeover, so a
 * window that lists the task's tabs sees the same tabs as before. A browser
 * that was already running is left as it is. A tab that would not reopen
 * keeps its row, which the agent's next `list` reconciles; nothing a page
 * holds is logged, a failure only by its kind.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { listAgentBrowserTabs, retargetBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { Effect, type Scope } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { AgentBrowser, type BrowserUnreachable, type CdpSession } from "./agent-browser.js";

/**
 * Reopens each tab kept for the agent whose conversation is named at its
 * last address, in the order it was first opened, and moves its row onto
 * the new target. A tab the browser already holds is left as it is.
 */
export function restoreBrowserTabs(
  conversationId: string,
  cdp: CdpSession,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.gen(function* () {
    const rows = yield* listAgentBrowserTabs(conversationId);
    const held = new Set(
      (yield* Effect.orElseSucceed(cdp.pages, () => [])).map((page) => page.targetId),
    );
    for (const row of rows) {
      if (held.has(row.targetId)) continue;
      const reopened = yield* Effect.result(cdp.openPage(row.address));
      if (reopened._tag === "Failure") {
        yield* Effect.logWarning(`A Browser tab did not reopen: ${reopened.failure.kind}`);
        continue;
      }
      yield* retargetBrowserTab(conversationId, row.id, reopened.success);
    }
  }).pipe(Effect.tapError(logStoreFailure), Effect.ignore);
}

/**
 * Connects to the agent's browser in the sandbox the session names, for the
 * caller's scope, its kept tabs reopened first where making sure of the
 * browser started it.
 */
export function connectRestoring(
  browserSession: string,
  conversationId: string,
): Effect.Effect<CdpSession, BrowserUnreachable, AgentBrowser | DatabaseServices | Scope.Scope> {
  return Effect.gen(function* () {
    const browser = yield* AgentBrowser;
    const { started } = yield* browser.ensure(browserSession);
    const cdp = yield* browser.connect(browserSession);
    if (started) yield* restoreBrowserTabs(conversationId, cdp);
    return cdp;
  });
}
