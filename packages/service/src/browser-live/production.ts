import type { DatabaseServices } from "@repo/database/core/query";
import {
  handBackBrowserTab,
  noteBrowserTabPage,
  readBrowserTab,
  renewBrowserTabTakeover,
  takeOverBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { readVisibleAgentWorkspace } from "@repo/database/models/agent-store";
import { standingSessionsNamed } from "@repo/database/models/recorded-session";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { Effect, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import { AgentBrowser, agentBrowserLayer } from "../agents/browser/agent-browser.js";
import { connectRestoring } from "../agents/browser/restore-tabs.js";
import { sandboxPtyLayer } from "../agents/sandbox-pty.js";
import { keepSessionSandboxAlive } from "../agents/session-sandboxes.js";
import { recordServerEventIn, SERVER_EVENT } from "../events/server-events.js";
import type { BrowserLiveDependencies } from "./relay.js";

export type BrowserLiveServices = DatabaseServices | HttpClient.HttpClient;

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
    readTab: (userId, place, tabId) => run(readBrowserTab(userId, place, tabId)),
    sessionOf: (conversationId) =>
      run(
        Effect.map(standingSessionsNamed([conversationId]), ([session]) =>
          Option.fromUndefinedOr(session?.sessionId),
        ),
      ),
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
    counted: (userId, agentId, tool) =>
      run(
        recordServerEventIn(
          SERVER_EVENT.AGENT_TOOL_OPEN,
          userId,
          readVisibleAgentWorkspace(userId, agentId),
          { tool },
        ),
      ),
    notePage: (tabId, targetId, page) =>
      run(noteBrowserTabPage(tabId, targetId, page)).pipe(
        Effect.catch(() => Effect.logWarning("a watched tab's page was not kept")),
        Effect.asVoid,
      ),
    hold: (conversationId, heldUntil) =>
      run(holdSandbox(conversationId, heldUntil)).pipe(
        Effect.catch(() => Effect.logWarning("a watched browser's lease was not moved on")),
      ),
    keepAlive: (sessionId) => run(keepSessionSandboxAlive(sessionId)),
  };
});
