import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  listAgentBrowserTabs,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_AGENT_ACTION, BROWSER_STEP_STATUS } from "@luke/features/browser-agent-actions";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, type Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  agentBrowserTestLayer,
  type FakeCdpAnswer,
  type FakeCdpCommand,
  type FakeCdpPeer,
  fakeCdpPeer,
  noSandboxBrowserLayer,
} from "../../testing/agent-browser-fake.js";
import { AgentBrowser, type PageTarget } from "./agent-browser.js";
import {
  BROWSER_TOOL_STATUS,
  type BrowserToolResult,
  browserModelOutput,
  runBrowserTool,
  storedBrowserOutput,
} from "./browser-tool.js";

/**
 * The `browser` tool over a fake Chromium behind the real CDP session and
 * the real tab store on a migrated database: a call runs its actions and
 * keeps the agent's tabs in step with the browser, an action on a tab a
 * member drives is refused with nothing after it run, a screenshot reaches
 * the model and never the stored conversation, and a browser that cannot be
 * reached answers why. Synthetic accounts and pages throughout.
 */

const SESSION = "wrun_browser_tool_fixture";

const LAYOUT = {
  cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 },
  cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 },
};

const JPEG = "/9j/AAAA";

/** The commands a page answers with nothing much, as Chrome does once they are done. */
const PLAIN = new Set([
  "Target.detachFromTarget",
  "Target.activateTarget",
  "Input.dispatchMouseEvent",
  "Input.insertText",
]);

/**
 * A fake Chromium whose pages move as a real one's do: a navigation changes
 * the tab's address and title, a page opens and closes, and every command it
 * is sent is recorded.
 */
function browser(pages: readonly PageTarget[] = []) {
  return Effect.gen(function* () {
    const held: PageTarget[] = [...pages];
    const sent: FakeCdpCommand[] = [];
    let opened = 0;
    const sessions = new Map<string, string>();
    const answer = (command: FakeCdpCommand): FakeCdpAnswer | undefined => {
      sent.push(command);
      const { params } = command;
      switch (command.method) {
        case "Target.getTargets":
          return { result: { targetInfos: held.map((page) => ({ ...page, type: "page" })) } };
        case "Target.createTarget": {
          opened += 1;
          const targetId = `tab-${opened}`;
          held.push({ targetId, url: String(params.url), title: "New tab" });
          return { result: { targetId } };
        }
        case "Target.closeTarget": {
          const at = held.findIndex((page) => page.targetId === params.targetId);
          if (at < 0) return { error: { code: -32602, message: "No target with given id found" } };
          held.splice(at, 1);
          return { result: { success: true } };
        }
        case "Target.attachToTarget": {
          const sessionId = `session-${String(params.targetId)}`;
          sessions.set(sessionId, String(params.targetId));
          return { result: { sessionId } };
        }
        case "Page.navigate": {
          const page = held.find((one) => one.targetId === sessions.get(command.sessionId ?? ""));
          if (page !== undefined) {
            held.splice(held.indexOf(page), 1, {
              ...page,
              url: String(params.url),
              title: `Page at ${String(params.url)}`,
            });
          }
          return { result: { frameId: "frame-1" } };
        }
        case "Page.getLayoutMetrics":
          return { result: LAYOUT };
        case "Runtime.evaluate":
          return { result: { result: { value: 1 } } };
        case "Page.captureScreenshot":
          return { result: { data: JPEG } };
        default:
          return PLAIN.has(command.method) ? { result: {} } : undefined;
      }
    };
    const peer = yield* fakeCdpPeer({ answer });
    return { peer, sent };
  });
}

/** The fake sandbox's browser on the peer, already started, as a browser the agent used earlier in its sandbox's life is. */
function runningBrowser(peer: FakeCdpPeer) {
  const layer = agentBrowserTestLayer(peer, SESSION);
  const started = Effect.gen(function* () {
    const browser = yield* AgentBrowser;
    yield* browser.ensure(SESSION);
  });
  return Effect.as(Effect.provide(started, layer), layer);
}

/** A new account and a conversation of its own, the one an agent's tabs are kept under. */
const openConversation = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  const [row] = yield* Database.use((db) =>
    db
      .insert(conversations)
      .values({ userId: id, kind: CONVERSATION_KIND.TASK })
      .returning({ id: conversations.id }),
  );
  assert.ok(row);
  return { userId: id, conversationId: row.id };
});

/** One call of the tool, as an agent's root makes it, on the browser given. */
function call(conversationId: string, input: unknown, browserLayer: Layer.Layer<AgentBrowser>) {
  return runBrowserTool(
    { browserSession: SESSION, conversationId },
    unparsedWire(input as WireBoundaryInput),
  ).pipe(Effect.provide(browserLayer));
}

function ran(result: BrowserToolResult) {
  if (result.status !== BROWSER_TOOL_STATUS.RAN) return assert.fail(result.reason);
  return result;
}

/** The tabs the store keeps for the conversation, as an agent's own list reads them. */
const keptTabs = (conversationId: string) =>
  Effect.map(listAgentBrowserTabs(conversationId), (rows) =>
    rows.map(({ targetId, address, title }) => ({ targetId, address, title })),
  );

it.layer(getTestDB())("the browser tool", (it) => {
  it.effect(
    "a tab the agent opens and navigates is kept with its page as it now stands, and goes once closed",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser();
        const layer = agentBrowserTestLayer(peer, SESSION);

        const opened = ran(
          yield* call(
            conversationId,
            {
              actions: [
                { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" },
                { action: BROWSER_AGENT_ACTION.NAVIGATE, url: "http://localhost:3000/login" },
              ],
            },
            layer,
          ),
        );

        assert.deepEqual(opened.tabs, [
          {
            tab: "tab-1",
            url: "http://localhost:3000/login",
            title: "Page at http://localhost:3000/login",
          },
        ]);
        assert.deepEqual(yield* keptTabs(conversationId), [
          {
            targetId: "tab-1",
            address: "http://localhost:3000/login",
            title: "Page at http://localhost:3000/login",
          },
        ]);

        const closed = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.CLOSE, tab: "tab-1" }] },
            layer,
          ),
        );

        assert.deepEqual(closed.tabs, []);
        assert.deepEqual(yield* keptTabs(conversationId), []);
      }),
  );

  it.effect(
    "a list makes the kept tabs the browser's own: a page it holds is kept, a tab it lost is dropped",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        yield* upsertBrowserTab({
          conversationId,
          targetId: "tab-gone",
          address: "https://gone.test/",
          title: "Gone",
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
        });
        const { peer } = yield* browser([
          { targetId: "tab-held", url: "https://held.test/", title: "Held" },
        ]);

        ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] },
            yield* runningBrowser(peer),
          ),
        );

        assert.deepEqual(yield* keptTabs(conversationId), [
          { targetId: "tab-held", address: "https://held.test/", title: "Held" },
        ]);
      }),
  );

  it.effect(
    "an action on a tab a member drives is refused with words that say so, nothing after it runs, and once the takeover lapses it runs",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        const pages = [
          { targetId: "tab-free", url: "https://free.test/", title: "Free" },
          { targetId: "tab-driven", url: "https://driven.test/", title: "Driven" },
        ];
        const { peer, sent } = yield* browser(pages);
        const layer = yield* runningBrowser(peer);
        for (const page of pages) {
          yield* upsertBrowserTab({
            conversationId,
            targetId: page.targetId,
            address: page.url,
            title: page.title,
            openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
          });
        }
        const driven = (yield* listAgentBrowserTabs(conversationId)).find(
          (row) => row.targetId === "tab-driven",
        );
        assert.ok(driven);
        const now = yield* Clock.currentTimeMillis;
        assert.equal(
          yield* takeOverBrowserTab(driven.id, userId, new Date(now + 60_000), new Date(now)),
          true,
        );
        const actions = {
          actions: [
            { action: BROWSER_AGENT_ACTION.CLICK, tab: "tab-free", x: 10, y: 10 },
            { action: BROWSER_AGENT_ACTION.CLICK, tab: "tab-driven", x: 20, y: 20 },
            { action: BROWSER_AGENT_ACTION.TYPE, text: "hello" },
          ],
        };

        const refused = ran(yield* call(conversationId, actions, layer));

        assert.deepEqual(
          refused.steps.map((step) => [step.action, step.status, "tab" in step ? step.tab : null]),
          [
            [BROWSER_AGENT_ACTION.CLICK, BROWSER_STEP_STATUS.DONE, "tab-free"],
            [BROWSER_AGENT_ACTION.CLICK, BROWSER_STEP_STATUS.FAILED, "tab-driven"],
          ],
        );
        const failed = refused.steps[1];
        assert.ok(failed?.status === BROWSER_STEP_STATUS.FAILED);
        assert.match(failed.error, /a member is driving tab tab-driven/u);
        assert.match(failed.error, /hand it back/u);
        assert.equal(refused.skipped, 1);
        assert.deepEqual(
          sent.filter((command) => command.sessionId === "session-tab-driven"),
          [],
        );

        yield* TestClock.adjust("2 minutes");
        const after = ran(yield* call(conversationId, actions, layer));

        assert.deepEqual(
          after.steps.map((step) => step.status),
          [BROWSER_STEP_STATUS.DONE, BROWSER_STEP_STATUS.DONE, BROWSER_STEP_STATUS.DONE],
        );
      }),
  );

  it.effect(
    "a browser that started afresh reopens every kept tab at its last address as the same tab, a member's takeover with it",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        for (const [targetId, address] of [
          ["before-1", "https://shop.test/cart"],
          ["before-2", "http://localhost:3000/admin"],
        ] as const) {
          yield* upsertBrowserTab({
            conversationId,
            targetId,
            address,
            title: "Kept",
            openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
          });
        }
        const kept = yield* listAgentBrowserTabs(conversationId);
        const admin = kept.find((row) => row.targetId === "before-2");
        assert.ok(admin);
        const now = yield* Clock.currentTimeMillis;
        yield* takeOverBrowserTab(admin.id, userId, new Date(now + 60_000), new Date(now));
        // The sandbox resumed from its snapshot: the browser starts with none of the pages.
        const { peer } = yield* browser();

        const listed = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] },
            agentBrowserTestLayer(peer, SESSION),
          ),
        );

        const step = listed.steps[0];
        assert.ok(step?.action === BROWSER_AGENT_ACTION.LIST && step.status === "done");
        assert.deepEqual(step.tabs.map(({ url }) => url).sort(), [
          "http://localhost:3000/admin",
          "https://shop.test/cart",
        ]);
        const reopened = yield* listAgentBrowserTabs(conversationId);
        assert.deepEqual(
          reopened
            .map(({ id, address }) => ({ id, address }))
            .sort((a, b) => a.address.localeCompare(b.address)),
          kept
            .map(({ id, address }) => ({ id, address }))
            .sort((a, b) => a.address.localeCompare(b.address)),
        );
        const moved = reopened.find((row) => row.id === admin.id);
        assert.ok(moved);
        assert.ok(step.tabs.some(({ tab }) => tab === moved.targetId));
        assert.equal(moved.driverUserId, userId);

        const refused = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.SNAPSHOT, tab: moved.targetId }] },
            agentBrowserTestLayer(peer, SESSION),
          ),
        );
        assert.equal(refused.steps[0]?.status, BROWSER_STEP_STATUS.FAILED);
      }),
  );

  it.effect(
    "a screenshot reaches the model as an image and is left out of the stored conversation",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser([
          { targetId: "tab-1", url: "https://shop.test/", title: "Shop" },
        ]);

        const result = yield* call(
          conversationId,
          { actions: [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "tab-1" }] },
          agentBrowserTestLayer(peer, SESSION),
        );
        const output = unparsedWire(result);
        const shown = browserModelOutput(output);
        const stored = JSON.stringify(storedBrowserOutput(output));

        assert.equal(shown.type, "content");
        assert.ok(shown.type === "content");
        assert.deepEqual(shown.value.at(-1), {
          type: "file",
          data: { type: "data", data: JPEG },
          mediaType: "image/jpeg",
        });
        assert.ok(!JSON.stringify(shown.value.slice(0, -1)).includes(JPEG));
        assert.ok(!stored.includes(JPEG));
        assert.ok(stored.includes('"action":"screenshot"'));
      }),
  );

  it.effect("a browser that cannot be reached answers why, and keeps nothing", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openConversation;

      const result = yield* call(
        conversationId,
        { actions: [{ action: BROWSER_AGENT_ACTION.OPEN, url: "https://shop.test/" }] },
        noSandboxBrowserLayer,
      );

      assert.equal(result.status, BROWSER_TOOL_STATUS.NOT_RUN);
      assert.ok(result.status === BROWSER_TOOL_STATUS.NOT_RUN);
      assert.match(result.reason, /has not opened its sandbox yet/u);
      assert.deepEqual(yield* keptTabs(conversationId), []);
    }),
  );
});
