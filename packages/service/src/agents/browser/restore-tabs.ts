import type { DatabaseServices } from "@repo/database/core/query";
import { listAgentBrowserTabs, retargetBrowserTab } from "@repo/database/models/agent-browser-tabs";
import type { CdpSession } from "@repo/features/browser-cdp";
import { Effect, type Scope } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { AgentBrowser, type BrowserUnreachable } from "./agent-browser.js";

export function restoreBrowserTabs(
  conversationId: string,
  cdp: CdpSession,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.gen(function* () {
    const rows = yield* listAgentBrowserTabs(conversationId);
    if (rows.length === 0) return;
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
      const unkept = Effect.ignore(cdp.closePage(page));
      const moved = yield* retargetBrowserTab(conversationId, row.id, row.targetId, page).pipe(
        Effect.onError(() => unkept),
      );
      if (!moved) yield* unkept;
    }
  }).pipe(Effect.tapError(logStoreFailure), Effect.ignore);
}

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
