import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  listAgentBrowserTabs,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import {
  claimMacCommands,
  macCommandsWaiting,
  markMacListening,
  settleMacBrowserResult,
  settleMacCommand,
} from "@luke/database/models/mac-command-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_STEP_STATUS,
  type BrowserAgentRun,
} from "@luke/features/browser-agent-actions";
import type { PageTarget } from "@luke/features/browser-cdp";
import {
  MAC_COMMAND_IMAGE_TYPE,
  MAC_COMMAND_KIND,
  type MacCommand,
} from "@luke/features/mac-command-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  agentBrowserTestLayer,
  type FakeCdpAnswer,
  type FakeCdpCommand,
  type FakeCdpPeer,
  fakeBridgePty,
  fakeCdpPeer,
  fakeSandboxApi,
  noSandboxBrowserLayer,
} from "../../testing/agent-browser-fake.js";
import { AgentBrowser, agentBrowserOver } from "./agent-browser.js";
import {
  BROWSER_TOOL_REFUSAL,
  BROWSER_TOOL_STATUS,
  type BrowserCall,
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
    { browserSession: SESSION, conversationId, openSandbox: async () => undefined },
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

  it.effect(
    "an agent's first call opens its sandbox before it looks for its browser there, and a sandbox that would not open answers why",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser();
        // No sandbox stands under the session until its door is opened, as before an agent's first sandbox call.
        let opened = false;
        const { api } = fakeSandboxApi({ status: "running", sessionId: SESSION });
        const unopened = Layer.succeed(
          AgentBrowser,
          agentBrowserOver(
            {
              ...api,
              listTagged: (session) => (opened ? api.listTagged(session) : Effect.succeed([])),
            },
            fakeBridgePty(peer),
          ),
        );
        const input = unparsedWire({
          actions: [{ action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" }],
        });

        const first = yield* runBrowserTool(
          {
            browserSession: SESSION,
            conversationId,
            openSandbox: async () => {
              opened = true;
            },
          },
          input,
        ).pipe(Effect.provide(unopened));
        const refused = yield* runBrowserTool(
          {
            browserSession: SESSION,
            conversationId,
            openSandbox: async () => Promise.reject(new Error("Vercel refused")),
          },
          input,
        ).pipe(Effect.provide(unopened));

        assert.deepEqual(ran(first).tabs, [
          { tab: "tab-1", url: "http://localhost:3000/", title: "New tab" },
        ]);
        assert.deepEqual(refused, {
          status: BROWSER_TOOL_STATUS.NOT_RUN,
          reason: BROWSER_TOOL_REFUSAL.NO_SANDBOX,
        });
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

/** The kinds a Mac that drives its Browser tabs names as it listens: shell, and the browser. */
const MAC_KINDS = [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.BROWSER];

const TASK_ID = "22222222-2222-4222-8222-222222222222";

/** A JPEG's first bytes, which is what the store reads an image's type off. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];

/** A small JPEG's base64, as the Mac sends a screenshot. */
const MAC_JPEG = (() => {
  const image = new Uint8Array(64);
  image.set(JPEG_SIGNATURE);
  return Buffer.from(image).toString("base64");
})();

/** A screenshot step as the Mac's run carries it: its picture left empty, since it goes as the result's image. */
function macScreenshot(tab: string) {
  return {
    action: BROWSER_AGENT_ACTION.SCREENSHOT,
    status: BROWSER_STEP_STATUS.DONE,
    tab,
    image: { mime: "image/jpeg", data: "", width: 1280, height: 800 },
  } as const;
}

/**
 * A call as a coding agent's root makes it, its starter's Mac given: the
 * sandbox it would open counted, so a call that never reaches the sandbox
 * is seen to leave it be.
 */
function macCall(conversationId: string, userId: string, taskId: string | null) {
  const opened = { count: 0 };
  const call: BrowserCall = {
    browserSession: SESSION,
    conversationId,
    openSandbox: async () => {
      opened.count += 1;
    },
    mac: { userId, taskId: Effect.succeed(taskId) },
  };
  return { call, opened };
}

/** One call of the tool on the call given, with no sandbox browser to reach. */
function callOn(call: BrowserCall, input: unknown) {
  return runBrowserTool(call, unparsedWire(input as WireBoundaryInput)).pipe(
    Effect.provide(noSandboxBrowserLayer),
  );
}

/** Lets a forked call's statements run until a command waits for the account. */
const untilQueued = (userId: string) =>
  Effect.gen(function* () {
    const since = new Date(yield* Clock.currentTimeMillis);
    while (!(yield* macCommandsWaiting(userId, since, MAC_KINDS))) yield* Effect.yieldNow;
  });

/**
 * The developer's Mac, as the store sees it: it listens for shell and
 * browser commands, takes the one a call queued, and settles it with the
 * answer given; what it took is answered for the test to read.
 */
function macAnswering(
  userId: string,
  pending: Fiber.Fiber<BrowserToolResult>,
  settle: (taken: MacCommand) => TaskStoreEffect<boolean>,
) {
  return Effect.gen(function* () {
    yield* untilQueued(userId);
    const [taken] = yield* claimMacCommands(userId, new Date(0), MAC_KINDS);
    assert.ok(taken);
    assert.equal(yield* settle(taken), true);
    yield* TestClock.adjust("1 second");
    return { taken, result: yield* Fiber.join(pending) };
  });
}

it.layer(getTestDB())("the browser tool on the developer's Mac", (it) => {
  it.effect(
    "a call on the Mac is sent to the starter's Mac as a browser command on the agent's task, and leaves the sandbox and its kept tabs be",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        yield* markMacListening(userId, MAC_KINDS);
        const { call, opened } = macCall(conversationId, userId, TASK_ID);
        const actions = [
          { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:5173/" },
          { action: BROWSER_AGENT_ACTION.SNAPSHOT },
        ];
        const run: BrowserAgentRun = {
          steps: [
            { action: BROWSER_AGENT_ACTION.OPEN, status: BROWSER_STEP_STATUS.DONE, tab: "mac-7" },
            {
              action: BROWSER_AGENT_ACTION.SNAPSHOT,
              status: BROWSER_STEP_STATUS.DONE,
              tab: "mac-7",
              url: "http://localhost:5173/",
              title: "My app",
              text: 'heading "Welcome"',
              truncated: false,
            },
          ],
          skipped: 0,
        };

        const pending = yield* Effect.forkChild(callOn(call, { actions, on: "mac" }));
        const { taken, result } = yield* macAnswering(userId, pending, (command) =>
          settleMacBrowserResult(userId, command.id, { output: run }),
        );

        assert.equal(taken.kind, MAC_COMMAND_KIND.BROWSER);
        assert.ok(taken.kind === MAC_COMMAND_KIND.BROWSER);
        assert.deepEqual(taken.params, { taskId: TASK_ID, actions });
        assert.deepEqual(result, {
          status: BROWSER_TOOL_STATUS.RAN,
          ...run,
          tabs: [{ tab: "mac-7", url: "http://localhost:5173/", title: "My app" }],
        });
        assert.equal(opened.count, 0, "the sandbox is never opened for the Mac");
        assert.deepEqual(yield* keptTabs(conversationId), []);
      }),
  );

  it.effect(
    "the Mac's screenshot reaches the model where its run took the last one, and never the stored conversation",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        yield* markMacListening(userId, MAC_KINDS);
        const { call } = macCall(conversationId, userId, TASK_ID);
        const actions = [
          { action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "mac-1" },
          { action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "mac-2" },
        ];
        const output = { steps: [macScreenshot("mac-1"), macScreenshot("mac-2")], skipped: 0 };

        const pending = yield* Effect.forkChild(callOn(call, { actions, on: "mac" }));
        const { result } = yield* macAnswering(userId, pending, (command) =>
          settleMacBrowserResult(userId, command.id, {
            output,
            image: { mediaType: MAC_COMMAND_IMAGE_TYPE.JPEG, data: MAC_JPEG },
          }),
        );
        const shown = browserModelOutput(unparsedWire(result));
        const stored = JSON.stringify(storedBrowserOutput(unparsedWire(result)));

        assert.ok(shown.type === "content");
        assert.deepEqual(shown.value.slice(1), [
          { type: "text", text: "The screenshot of tab mac-2:" },
          { type: "file", data: { type: "data", data: MAC_JPEG }, mediaType: "image/jpeg" },
        ]);
        assert.ok(!stored.includes(MAC_JPEG));
        assert.ok(stored.includes('"tab":"mac-2"'));
      }),
  );

  it.effect(
    "a Mac's run is given time for every wait it asks, and a tab whose page may have moved since it was read is not named by the old page",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        yield* markMacListening(userId, MAC_KINDS);
        const { call } = macCall(conversationId, userId, TASK_ID);
        const waits = Array.from({ length: 8 }, () => ({
          action: BROWSER_AGENT_ACTION.WAIT,
          timeoutMs: 30_000,
        }));
        // The snapshot reads the sign-in page; the waits after it may see it redirect.
        const actions = [{ action: BROWSER_AGENT_ACTION.SNAPSHOT, tab: "mac-1" }, ...waits];
        const output = {
          steps: [
            {
              action: BROWSER_AGENT_ACTION.SNAPSHOT,
              status: BROWSER_STEP_STATUS.DONE,
              tab: "mac-1",
              url: "https://app.test/login",
              title: "Sign in",
              text: 'button "Sign in" [e3]',
              truncated: false,
            },
            ...waits.map(() => ({
              action: BROWSER_AGENT_ACTION.WAIT,
              status: BROWSER_STEP_STATUS.DONE,
              tab: "mac-1",
            })),
          ],
          skipped: 0,
        };

        const pending = yield* Effect.forkChild(callOn(call, { actions, on: "mac" }));
        const { taken, result } = yield* macAnswering(userId, pending, (command) =>
          settleMacBrowserResult(userId, command.id, { output }),
        );

        assert.ok(taken.timeoutSeconds >= 8 * 30 + 20, "the Mac may take every action's own bound");
        assert.deepEqual(ran(result).tabs, []);
      }),
  );

  it.effect("a Mac that ran nothing is told in its own words, and so is no Mac listening", () =>
    Effect.gen(function* () {
      const { userId, conversationId } = yield* openConversation;
      const { call } = macCall(conversationId, userId, TASK_ID);
      const input = { actions: [{ action: BROWSER_AGENT_ACTION.LIST }], on: "mac" };

      const unheard = yield* callOn(call, input);
      yield* markMacListening(userId, MAC_KINDS);
      const pending = yield* Effect.forkChild(callOn(call, input));
      const words = "Not run: no window of Luke on this Mac shows the task.";
      const { result: refused } = yield* macAnswering(userId, pending, (command) =>
        settleMacCommand(userId, command.id, { refused: words }),
      );

      assert.equal(unheard.status, BROWSER_TOOL_STATUS.NOT_RUN);
      assert.ok(unheard.status === BROWSER_TOOL_STATUS.NOT_RUN);
      assert.match(unheard.reason, /no Mac of the developer's that can drive its Browser tabs/u);
      assert.deepEqual(refused, { status: BROWSER_TOOL_STATUS.NOT_RUN, reason: words });
    }),
  );

  it.effect(
    "an agent on no task, or one that reaches no Mac, is refused in words and sends the Mac nothing",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        yield* markMacListening(userId, MAC_KINDS);
        const since = new Date(yield* Clock.currentTimeMillis);
        const input = { actions: [{ action: BROWSER_AGENT_ACTION.LIST }], on: "mac" };
        const { call } = macCall(conversationId, userId, null);
        const { mac: _mac, ...macless } = call;

        const taskless = yield* callOn(call, input);
        const unreached = yield* callOn(macless, input);

        assert.deepEqual(taskless, {
          status: BROWSER_TOOL_STATUS.NOT_RUN,
          reason: BROWSER_TOOL_REFUSAL.TASKLESS,
        });
        assert.deepEqual(unreached, {
          status: BROWSER_TOOL_STATUS.NOT_RUN,
          reason: BROWSER_TOOL_REFUSAL.NO_MAC,
        });
        assert.equal(yield* macCommandsWaiting(userId, since, MAC_KINDS), false);
      }),
  );

  it.effect(
    "a call that names no place runs on the agent's own sandbox browser, even with a Mac listening",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        yield* markMacListening(userId, MAC_KINDS);
        const since = new Date(yield* Clock.currentTimeMillis);
        const { peer } = yield* browser();
        const { call } = macCall(conversationId, userId, TASK_ID);

        const result = yield* runBrowserTool(
          call,
          unparsedWire({
            actions: [{ action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" }],
          }),
        ).pipe(Effect.provide(agentBrowserTestLayer(peer, SESSION)));

        assert.deepEqual(ran(result).tabs, [
          { tab: "tab-1", url: "http://localhost:3000/", title: "New tab" },
        ]);
        assert.equal(yield* macCommandsWaiting(userId, since, MAC_KINDS), false);
      }),
  );
});
