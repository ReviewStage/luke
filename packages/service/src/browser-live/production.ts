/**
 * production.ts -- the live view's dependencies as the deployment stands them: the tab read and taken over in the store by the tabs contract's rules, the agent's sandbox session from its conversation, its browser over Vercel's REST API and the sandbox's PTY, and the terminal's lease.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the service stands, so the relay itself requires none.
 * A store that cannot take a lease's move is logged, since the panel's next
 * message tries again, as is a keep-alive of the sandbox Vercel did not
 * confirm; nothing a tab shows is.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  handBackBrowserTab,
  readTaskBrowserTab,
  renewBrowserTabTakeover,
  takeOverBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { standingSessionsNamed } from "@luke/database/models/recorded-session";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { Effect, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import { AgentBrowser, agentBrowserLayer } from "../agents/browser/agent-browser.js";
import { connectRestoring } from "../agents/browser/restore-tabs.js";
import { sandboxPtyLayer } from "../agents/sandbox-pty.js";
import { keepSessionSandboxAlive } from "../agents/session-sandboxes.js";
import type { BrowserLiveDependencies } from "./relay.js";

/** What the live view's dependencies answer over. */
export type BrowserLiveServices = DatabaseServices | HttpClient.HttpClient;

/** The live view's dependencies over the services the runtime holds now. */
export const browserLiveDependencies: Effect.Effect<
  BrowserLiveDependencies,
  never,
  BrowserLiveServices
> = Effect.gen(function* () {
  const context = yield* Effect.context<BrowserLiveServices>();
  const run = <A, E>(effect: Effect.Effect<A, E, BrowserLiveServices>) =>
    Effect.provideContext(effect, context);
  const browser = yield* Effect.provide(
    Effect.gen(function* () {
      return yield* AgentBrowser;
    }),
    agentBrowserLayer.pipe(Layer.provide(sandboxPtyLayer)),
  );
  return {
    readTab: (userId, taskId, tabId) => run(readTaskBrowserTab(userId, taskId, tabId)),
    // Note that the tab was read under the member's reach first, so its agent's conversation is read whoever started it.
    sessionOf: (conversationId) =>
      run(
        Effect.map(standingSessionsNamed([conversationId]), ([session]) =>
          Option.fromUndefinedOr(session?.sessionId),
        ),
      ),
    // Note that a connection reopens the agent's kept tabs where its browser started afresh.
    browser: {
      connect: (sessionId, conversationId) =>
        connectRestoring(sessionId, conversationId).pipe(
          Effect.provideService(AgentBrowser, browser),
          Effect.provide(context),
        ),
    },
    takeOver: (tabId, userId, heldUntil, now) =>
      run(takeOverBrowserTab(tabId, userId, heldUntil, now)),
    renew: (tabId, userId, heldUntil, now) =>
      run(renewBrowserTabTakeover(tabId, userId, heldUntil, now)),
    handBack: (tabId, userId) => run(handBackBrowserTab(tabId, userId)),
    hold: (conversationId, heldUntil) =>
      run(holdSandbox(conversationId, heldUntil)).pipe(
        Effect.catch(() => Effect.logWarning("a watched browser's lease was not moved on")),
      ),
    keepAlive: (sessionId) => run(keepSessionSandboxAlive(sessionId)),
  };
});
