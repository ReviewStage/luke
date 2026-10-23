import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  listAgentBrowserTabs,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_AGENT_ACTION, BROWSER_STEP_STATUS } from "@luke/features/browser-agent-actions";
import { BROWSER_CURSOR_BEAT } from "@luke/features/browser-agent-cdp";
import type { PageTarget } from "@luke/features/browser-cdp";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Clock, Duration, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  agentBrowserTestLayer,
  FAKE_RECORDING_PATH,
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
  type BrowserToolResult,
  browserModelOutput,
  browserTranscriptOf,
  runBrowserTool,
  storedBrowserOutput,
} from "./browser-tool.js";
import { RECORDER_SOURCE, RECORDING_START_OUTPUT } from "./sandbox-recorder.js";

/**
 * The `browser` tool over a fake Chromium behind the real CDP session and
 * the real tab store on a migrated database: a call runs its actions and
 * keeps the agent's tabs in step with the browser, an action on a tab a
 * member drives is refused with nothing after it run, a screenshot's
 * bounded copy reaches the model while its full-size copy is kept beside
 * the transcript and named by id, never as base64, a recording started and
 * stopped is kept beside the transcript as a video, and a browser that
 * cannot be reached answers why. Synthetic accounts and pages throughout.
 */

/** A WebM whose one video track states 1280 by 800, with no frames: what the sandbox's recorder leaves, as far as the service reads it. */
const RECORDED_WEBM = (() => {
  const ebml = (id: readonly number[], body: readonly number[]) => [
    ...id,
    0x80 | body.length,
    ...body,
  ];
  const video = ebml([0xe0], [...ebml([0xb0], [0x05, 0x00]), ...ebml([0xba], [0x03, 0x20])]);
  return new Uint8Array([
    ...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], [...Buffer.from("webm")])),
    ...ebml([0x18, 0x53, 0x80, 0x67], ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], video))),
  ]);
})();

/** The fake sandbox's browser on the peer, recording as the scenario says, and the commands its sandbox ran. */
function recordingBrowser(
  peer: FakeCdpPeer,
  recording: NonNullable<Parameters<typeof fakeSandboxApi>[0]["recording"]>,
) {
  const sandbox = fakeSandboxApi({ status: "running", sessionId: SESSION, recording });
  return {
    layer: Layer.succeed(AgentBrowser, agentBrowserOver(sandbox.api, fakeBridgePty(peer))),
    ran: sandbox.ran,
  };
}

const SESSION = "wrun_browser_tool_fixture";

const LAYOUT = {
  cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 },
  cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 },
};

const JPEG = "/9j/AAAA";

/** A synthetic JPEG whose frame header states 1280 by 800, as the transcript's copy of a page answers; no real picture. */
const KEPT_JPEG = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xc0,
  0x00,
  0x11,
  0x08,
  0x03,
  0x20,
  0x05,
  0x00,
  0x03,
  ...Array.from({ length: 64 }, () => 7),
]).toString("base64");

/** A synthetic PNG whose header states the same size, larger than the JPEG, so the JPEG is kept. */
const KEPT_PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x05,
  0x00,
  0x00,
  0x00,
  0x03,
  0x20,
  ...Array.from({ length: 256 }, () => 9),
]).toString("base64");

/** The commands a page answers with nothing much, as Chrome does once they are done. */
const PLAIN = new Set([
  "Target.detachFromTarget",
  "Target.activateTarget",
  "Input.dispatchMouseEvent",
  "Input.insertText",
]);

/** The blank page Chromium starts with, which no one opened. */
const START_PAGE: PageTarget = { targetId: "start-page", url: "about:blank", title: "about:blank" };

/** The title a page's own document gives it, once it has loaded. */
const titleAt = (url: string) => `Page at ${url}`;

/**
 * A fake Chromium whose pages move as a real one's do: a page opens titled
 * with its address, as Chromium titles one while it loads, and takes its own
 * title once it has loaded, after as many reads of its state as `loadAsks`
 * says; a page at the address `unopenable` names will not open; a navigation changes the tab's address and title, a page closes, and
 * every command it is sent is recorded.
 */
function browser(
  pages: readonly PageTarget[] = [],
  // Note that `unopenable` is read at each open, so a suite may let the page open later.
  options: { readonly loadAsks?: number; readonly unopenable?: string | undefined } = {},
) {
  return Effect.gen(function* () {
    const held: PageTarget[] = [...pages];
    const sent: FakeCdpCommand[] = [];
    let opened = 0;
    const sessions = new Map<string, string>();
    // How many more reads of its state each page still loading answers that it loads.
    const loading = new Map<string, number>();
    const readyState = (targetId: string) => {
      const left = loading.get(targetId);
      if (left === undefined) return "complete";
      if (left > 0) {
        loading.set(targetId, left - 1);
        return "loading";
      }
      loading.delete(targetId);
      const at = held.findIndex((page) => page.targetId === targetId);
      const page = held[at];
      if (page !== undefined) held.splice(at, 1, { ...page, title: titleAt(page.url) });
      return "complete";
    };
    const answer = (command: FakeCdpCommand): FakeCdpAnswer | undefined => {
      sent.push(command);
      const { params } = command;
      switch (command.method) {
        case "Target.getTargets":
          return { result: { targetInfos: held.map((page) => ({ ...page, type: "page" })) } };
        case "Target.createTarget": {
          if (params.url === options.unopenable) {
            return { error: { code: -32000, message: "Failed to open a new tab" } };
          }
          opened += 1;
          const targetId = `tab-${opened}`;
          held.push({ targetId, url: String(params.url), title: String(params.url) });
          loading.set(targetId, options.loadAsks ?? 0);
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
              title: titleAt(String(params.url)),
            });
          }
          return { result: { frameId: "frame-1" } };
        }
        case "Page.getLayoutMetrics":
          return { result: LAYOUT };
        case "Runtime.evaluate":
          return params.expression === "document.readyState"
            ? {
                result: {
                  result: { value: readyState(sessions.get(command.sessionId ?? "") ?? "") },
                },
              }
            : { result: { result: { value: 1 } } };
        case "Page.captureScreenshot":
          if (params.format === "png") return { result: { data: KEPT_PNG } };
          return { result: { data: params.quality === 85 ? KEPT_JPEG : JPEG } };
        default:
          return PLAIN.has(command.method) ? { result: {} } : undefined;
      }
    };
    const peer = yield* fakeCdpPeer({ answer });
    return { peer, sent, held };
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

/** The account each conversation the suite opened belongs to, so a call names the transcript it is written to. */
const owners = new Map<string, string>();

/** A new account and a conversation of its own, the one an agent's tabs are kept under. */
const openConversation = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  const [row] = yield* Database.use((db) =>
    db
      .insert(conversations)
      .values({ userId: id, kind: CONVERSATION_KIND.CODING_AGENT })
      .returning({ id: conversations.id }),
  );
  assert.ok(row);
  owners.set(row.id, id);
  return { userId: id, conversationId: row.id };
});

/** One call of the tool, as an agent's root makes it, on the browser given. */
function call(conversationId: string, input: unknown, browserLayer: Layer.Layer<AgentBrowser>) {
  const transcript = { userId: owners.get(conversationId) ?? "", conversationId };
  return runBrowserTool(
    { browserSession: SESSION, conversationId, transcript, openSandbox: async () => undefined },
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
        // A tab the agent closed never comes back, however the browser is reached next.
        const listed = ran(
          yield* call(conversationId, { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] }, layer),
        );
        assert.deepEqual(listed.tabs, []);
        assert.deepEqual(yield* keptTabs(conversationId), []);
      }),
  );

  it.effect(
    "a list keeps every page the browser holds, and a lost tab that would not reopen just now stays kept until the next call reopens it",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        yield* upsertBrowserTab({
          conversationId,
          targetId: "tab-lost",
          address: "https://lost.test/",
          title: "Lost",
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
        });
        const refusing = { unopenable: "https://lost.test/" as string | undefined };
        const { peer, held: pages } = yield* browser(
          [{ targetId: "tab-held", url: "https://held.test/", title: "Held" }],
          refusing,
        );
        const layer = yield* runningBrowser(peer);
        const list = { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] };

        ran(yield* call(conversationId, list, layer));
        const afterRefusal = yield* keptTabs(conversationId);
        refusing.unopenable = undefined;
        ran(yield* call(conversationId, list, layer));

        assert.deepEqual(afterRefusal.map(({ targetId }) => targetId).sort(), [
          "tab-held",
          "tab-lost",
        ]);
        assert.deepEqual((yield* keptTabs(conversationId)).map(({ address }) => address).sort(), [
          "https://held.test/",
          "https://lost.test/",
        ]);
        const held = new Set(pages.map(({ targetId }) => targetId));
        assert.ok((yield* keptTabs(conversationId)).every(({ targetId }) => held.has(targetId)));
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
    "a browser another call started afresh still reopens every kept tab, and a list after it keeps them",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
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
        // The sandbox resumed and a live view's connection started the browser, then went before it
        // reopened anything: the browser holds only the blank page it starts with.
        const { peer, held: pages } = yield* browser([START_PAGE]);
        const layer = yield* runningBrowser(peer);

        const listed = ran(
          yield* call(conversationId, { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] }, layer),
        );

        const step = listed.steps[0];
        assert.ok(step?.action === BROWSER_AGENT_ACTION.LIST && step.status === "done");
        assert.deepEqual(step.tabs.map(({ url }) => url).sort(), [
          "http://localhost:3000/admin",
          "https://shop.test/cart",
        ]);
        const reopened = yield* listAgentBrowserTabs(conversationId);
        assert.deepEqual(reopened.map(({ id }) => id).sort(), kept.map(({ id }) => id).sort());
        const held = new Set(pages.map((page) => page.targetId));
        assert.ok(reopened.every((row) => held.has(row.targetId)));
      }),
  );

  it.effect(
    "a tab a member opened in the agent's browser is listed to the agent as theirs, and stays theirs once listed",
    () =>
      Effect.gen(function* () {
        const { conversationId, userId } = yield* openConversation;
        const signIn = { targetId: "member-tab", url: "https://accounts.test/", title: "Sign in" };
        const { peer } = yield* browser([START_PAGE, signIn]);
        const layer = yield* runningBrowser(peer);
        yield* upsertBrowserTab({
          conversationId,
          targetId: signIn.targetId,
          address: signIn.url,
          title: signIn.title,
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.MEMBER, userId },
        });

        const listed = ran(
          yield* call(conversationId, { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] }, layer),
        );
        const again = ran(
          yield* call(conversationId, { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] }, layer),
        );

        const theirs = {
          tab: signIn.targetId,
          url: signIn.url,
          title: signIn.title,
          openedBy: AGENT_BROWSER_TAB_OPENER.MEMBER,
        };
        assert.deepEqual(listed.tabs, [theirs]);
        assert.deepEqual(again.tabs, [theirs], "the agent's own list does not make it the agent's");
      }),
  );

  it.effect(
    "the blank page Chromium starts with is never listed or kept, and a list's tabs are the result's",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser([START_PAGE]);
        const layer = yield* runningBrowser(peer);

        const opened = ran(
          yield* call(
            conversationId,
            {
              actions: [
                { action: BROWSER_AGENT_ACTION.OPEN, url: "https://shop.test/" },
                { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" },
              ],
            },
            layer,
          ),
        );
        const listed = ran(
          yield* call(conversationId, { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] }, layer),
        );

        const expected = [
          { tab: "tab-1", url: "https://shop.test/", title: titleAt("https://shop.test/") },
          {
            tab: "tab-2",
            url: "http://localhost:3000/",
            title: titleAt("http://localhost:3000/"),
          },
        ];
        assert.deepEqual(opened.tabs, expected);
        assert.deepEqual(listed.steps, [
          { action: BROWSER_AGENT_ACTION.LIST, status: BROWSER_STEP_STATUS.DONE, tabs: expected },
        ]);
        assert.deepEqual(listed.tabs, expected, "a list's tabs are the result's tabs too");
        assert.deepEqual((yield* keptTabs(conversationId)).map(({ targetId }) => targetId).sort(), [
          "tab-1",
          "tab-2",
        ]);
      }),
  );

  it.effect(
    "a click writes the agent's pointer to its tab's row, and a tab no row keeps yet takes none",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const page = { targetId: "tab-kept", url: "https://kept.test/", title: "Kept" };
        yield* upsertBrowserTab({
          conversationId,
          targetId: page.targetId,
          address: page.url,
          title: page.title,
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
        });
        const { peer } = yield* browser([page]);
        const layer = yield* runningBrowser(peer);
        const before = yield* Clock.currentTimeMillis;

        ran(
          yield* call(
            conversationId,
            {
              actions: [
                { action: BROWSER_AGENT_ACTION.CLICK, tab: page.targetId, x: 40.5, y: 60 },
                { action: BROWSER_AGENT_ACTION.OPEN, url: "https://new.test/" },
                { action: BROWSER_AGENT_ACTION.CLICK, x: 1, y: 2 },
              ],
            },
            layer,
          ),
        );

        const rows = yield* listAgentBrowserTabs(conversationId);
        const byTarget = rows.toSorted((one, other) => one.targetId.localeCompare(other.targetId));
        const cursors = byTarget.map((row) => ({
          targetId: row.targetId,
          x: row.cursorX,
          y: row.cursorY,
          kind: row.cursorKind,
          width: row.cursorViewportW,
          height: row.cursorViewportH,
          at: row.cursorAt?.getTime() ?? null,
        }));
        assert.deepEqual(cursors, [
          // The tab this call opened was kept only once the call ran, after its click.
          {
            targetId: "tab-1",
            x: null,
            y: null,
            kind: null,
            width: null,
            height: null,
            at: null,
          },
          {
            targetId: "tab-kept",
            x: 40.5,
            y: 60,
            kind: "click",
            width: 1280,
            height: 800,
            at: before,
          },
        ]);
      }),
  );

  it.effect(
    "a click waits the cursor's beat only while the agent's sandbox is held for someone watching",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const page = { targetId: "tab-kept", url: "https://kept.test/", title: "Kept" };
        yield* upsertBrowserTab({
          conversationId,
          targetId: page.targetId,
          address: page.url,
          title: page.title,
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
        });
        const { peer, sent } = yield* browser([page]);
        const layer = yield* runningBrowser(peer);
        const click = {
          actions: [{ action: BROWSER_AGENT_ACTION.CLICK, tab: page.targetId, x: 4, y: 5 }],
        };
        const presses = () =>
          sent.filter(
            (command) =>
              command.method === "Input.dispatchMouseEvent" &&
              command.params.type === "mousePressed",
          ).length;
        const pointed = Effect.map(
          listAgentBrowserTabs(conversationId),
          (rows) => rows[0]?.cursorX === 7,
        );

        // No one watches: the call runs through without the clock moving at all.
        ran(yield* call(conversationId, click, layer));
        const pressedUnwatched = presses();

        const now = yield* Clock.currentTimeMillis;
        yield* holdSandbox(conversationId, new Date(now + 60_000));
        const watchedClick = {
          actions: [{ action: BROWSER_AGENT_ACTION.CLICK, tab: page.targetId, x: 7, y: 5 }],
        };
        const pending = yield* Effect.forkChild(call(conversationId, watchedClick, layer));
        while (!(yield* pointed)) yield* Effect.yieldNow;
        let waited = 0;
        while (presses() === pressedUnwatched) {
          yield* TestClock.adjust("10 millis");
          waited += 10;
          for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
        }
        ran(yield* Fiber.join(pending));

        assert.equal(pressedUnwatched, 1);
        assert.ok(waited >= Duration.toMillis(BROWSER_CURSOR_BEAT), `pressed after ${waited} ms`);
      }),
  );

  it.effect(
    "a tab is kept, listed, and shown with the title its page settles on, not the address it shows while it loads",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer, sent } = yield* browser([], { loadAsks: 2 });
        const url = "https://shop.test/login";
        const asked = () =>
          sent.filter((command) => command.params.expression === "document.readyState").length;

        const pending = yield* Effect.forkChild(
          call(
            conversationId,
            {
              actions: [
                { action: BROWSER_AGENT_ACTION.OPEN, url },
                { action: BROWSER_AGENT_ACTION.LIST },
              ],
            },
            agentBrowserTestLayer(peer, SESSION),
          ),
        );
        // The page loads over its next reads of its state, each a poll later.
        for (let reads = 1; reads <= 3; reads += 1) {
          while (asked() < reads) yield* Effect.yieldNow;
          yield* TestClock.adjust("250 millis");
        }
        const opened = ran(yield* Fiber.join(pending));

        assert.deepEqual(opened.tabs, [{ tab: "tab-1", url, title: titleAt(url) }]);
        assert.deepEqual(opened.steps.at(-1), {
          action: BROWSER_AGENT_ACTION.LIST,
          status: BROWSER_STEP_STATUS.DONE,
          tabs: [{ tab: "tab-1", url, title: titleAt(url) }],
        });
        assert.deepEqual(yield* keptTabs(conversationId), [
          { targetId: "tab-1", address: url, title: titleAt(url) },
        ]);
      }),
  );

  it.effect("a list before a later action on its tab keeps the title it saw", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openConversation;
      const { peer } = yield* browser();
      const url = "https://shop.test/inbox";

      const result = ran(
        yield* call(
          conversationId,
          {
            actions: [
              { action: BROWSER_AGENT_ACTION.OPEN, url },
              { action: BROWSER_AGENT_ACTION.LIST },
              { action: BROWSER_AGENT_ACTION.CLICK, x: 10, y: 10 },
            ],
          },
          agentBrowserTestLayer(peer, SESSION),
        ),
      );

      assert.deepEqual(result.steps[1], {
        action: BROWSER_AGENT_ACTION.LIST,
        status: BROWSER_STEP_STATUS.DONE,
        tabs: [{ tab: "tab-1", url, title: url }],
      });
      assert.deepEqual(result.tabs, [{ tab: "tab-1", url, title: titleAt(url) }]);
    }),
  );

  it.effect(
    "a screenshot keeps the page at full size beside the transcript, the model sees its bounded copy, and the stored conversation names the kept picture without its base64",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser([
          { targetId: "tab-1", url: "https://shop.test/", title: "Shop" },
        ]);

        const result = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "tab-1" }] },
            agentBrowserTestLayer(peer, SESSION),
          ),
        );
        const [step] = result.steps;
        assert.ok(step !== undefined && "picture" in step);
        const kept = yield* readConversationPicture(conversationId, step.picture.id);
        const output = unparsedWire(result);
        const shown = browserModelOutput(output);
        const stored = storedBrowserOutput(output);

        assert.deepEqual(
          Option.map(kept, (picture) => [
            picture.contentType,
            Buffer.from(picture.bytes).toString("base64"),
          ]),
          Option.some(["image/jpeg", KEPT_JPEG]),
        );
        assert.deepEqual(
          { ...step.picture, id: "" },
          { id: "", mediaType: "image/jpeg", width: 1280, height: 800, byteCount: 76 },
        );
        assert.ok(shown.type === "content");
        assert.deepEqual(shown.value.at(-1), {
          type: "file",
          data: { type: "data", data: JPEG },
          mediaType: "image/jpeg",
        });
        assert.ok(!JSON.stringify(shown.value).includes(KEPT_JPEG));
        assert.ok(!JSON.stringify(shown.value.slice(0, -1)).includes(JPEG));
        assert.ok(!JSON.stringify(shown.value).includes(step.picture.id));
        assert.deepEqual(stored, {
          ...result,
          steps: [
            {
              action: "screenshot",
              status: "done",
              tab: "tab-1",
              image: { mime: "image/jpeg", width: 1280, height: 800 },
              picture: step.picture,
            },
          ],
        });
      }),
  );

  it.effect(
    "a worker's screenshot is kept beside its own transcript, the child of the call that started it",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        const transcript = browserTranscriptOf({ userId, conversationId }, "call-worker");
        yield* Database.use((db) =>
          db.insert(conversations).values({
            id: transcript.conversationId,
            userId,
            kind: CONVERSATION_KIND.CODING_AGENT,
            parentConversationId: conversationId,
          }),
        );
        const { peer } = yield* browser([
          { targetId: "tab-1", url: "https://shop.test/", title: "Shop" },
        ]);

        const result = ran(
          yield* runBrowserTool(
            {
              browserSession: SESSION,
              conversationId,
              transcript,
              openSandbox: async () => undefined,
            },
            unparsedWire({ actions: [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "tab-1" }] }),
          ).pipe(Effect.provide(agentBrowserTestLayer(peer, SESSION))),
        );
        const [step] = result.steps;
        assert.ok(step !== undefined && "picture" in step);

        assert.ok(
          Option.isSome(yield* readConversationPicture(transcript.conversationId, step.picture.id)),
        );
        assert.ok(Option.isNone(yield* readConversationPicture(conversationId, step.picture.id)));
      }),
  );

  it.effect(
    "an agent's first call opens its sandbox before it looks for its browser there, and a sandbox that would not open answers why",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
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
            transcript: { userId, conversationId },
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
            transcript: { userId, conversationId },
            openSandbox: async () => Promise.reject(new Error("Vercel refused")),
          },
          input,
        ).pipe(Effect.provide(unopened));

        assert.deepEqual(ran(first).tabs, [
          { tab: "tab-1", url: "http://localhost:3000/", title: titleAt("http://localhost:3000/") },
        ]);
        assert.deepEqual(refused, {
          status: BROWSER_TOOL_STATUS.NOT_RUN,
          reason: BROWSER_TOOL_REFUSAL.NO_SANDBOX,
        });
      }),
  );

  it.effect(
    "a recording started in one call and stopped with its caption in the next is kept beside the transcript as a video, named by id",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser();
        const { layer, ran: commands } = recordingBrowser(peer, {
          stop: JSON.stringify({ ok: true, seconds: 8.3, bytes: RECORDED_WEBM.byteLength }),
          video: RECORDED_WEBM,
        });

        const started = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.RECORD }] },
            layer,
          ),
        );
        const stopped = ran(
          yield* call(
            conversationId,
            {
              actions: [
                { action: BROWSER_AGENT_ACTION.STOP_RECORDING, caption: "Inviting a member" },
              ],
            },
            layer,
          ),
        );

        assert.deepEqual(started.steps, [
          {
            action: BROWSER_AGENT_ACTION.RECORD,
            status: BROWSER_STEP_STATUS.DONE,
            maxSeconds: 120,
          },
        ]);
        assert.ok(
          commands.some(({ ask }) => ask.args.includes(RECORDER_SOURCE)),
          "the recorder was started in the sandbox",
        );
        const [step] = stopped.steps;
        assert.ok(step !== undefined && step.action === BROWSER_AGENT_ACTION.STOP_RECORDING);
        assert.ok(step.status === BROWSER_STEP_STATUS.DONE && "picture" in step);
        assert.equal(step.seconds, 8.3);
        assert.equal(step.caption, "Inviting a member");
        assert.equal(step.path, FAKE_RECORDING_PATH, "the agent is answered where to post it from");
        assert.ok(step.picture !== undefined);
        assert.deepEqual(
          [step.picture.mediaType, step.picture.width, step.picture.height],
          ["video/webm", 1280, 800],
        );
        const kept = yield* readConversationPicture(conversationId, step.picture.id);
        assert.deepEqual(
          Option.map(kept, (picture) => [picture.contentType, [...picture.bytes]]),
          Option.some(["video/webm", [...RECORDED_WEBM]]),
        );
        assert.doesNotMatch(JSON.stringify(storedBrowserOutput(unparsedWire(stopped))), /GkXfo/u);

        // A stop asked again, as after a read that failed, keeps the same video once.
        const again = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.STOP_RECORDING }] },
            layer,
          ),
        );
        const [repeated] = again.steps;
        assert.ok(
          repeated !== undefined && "picture" in repeated && repeated.picture !== undefined,
        );
        assert.equal(repeated.picture.id, step.picture.id);
      }),
  );

  it.effect(
    "a record while one runs, and a stop with none running, fail in words the agent can act on",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openConversation;
        const { peer } = yield* browser();
        const { layer } = recordingBrowser(peer, {
          start: { exitCode: 0, stdout: `${RECORDING_START_OUTPUT.RUNNING}\n`, stderr: "" },
        });

        const again = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.RECORD }] },
            layer,
          ),
        );
        const none = ran(
          yield* call(
            conversationId,
            { actions: [{ action: BROWSER_AGENT_ACTION.STOP_RECORDING }] },
            layer,
          ),
        );

        assert.deepEqual(again.steps, [
          {
            action: BROWSER_AGENT_ACTION.RECORD,
            status: BROWSER_STEP_STATUS.FAILED,
            error: "a recording already runs: stop it with stop_recording first",
          },
        ]);
        assert.deepEqual(none.steps, [
          {
            action: BROWSER_AGENT_ACTION.STOP_RECORDING,
            status: BROWSER_STEP_STATUS.FAILED,
            error: "no recording runs: start one with record",
          },
        ]);
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
