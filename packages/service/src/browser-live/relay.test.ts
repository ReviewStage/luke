import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_HISTORY,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_MOUSE_ACTION,
  BROWSER_LIVE_MOUSE_BUTTON,
  BROWSER_LIVE_REFUSAL,
  BROWSER_LIVE_SERVER,
  type BrowserLiveClientMessage,
} from "@luke/features/browser-live-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { type Cause, Clock, Duration, Effect, Fiber, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { agentBrowserOver } from "../agents/browser/agent-browser.js";
import { CODER } from "../agents/coder-host/bounds.js";
import type { RelayFrame } from "../terminal/relay.js";
import {
  type FakeCdpCommand,
  type FakeCdpPeer,
  fakeBridgePty,
  fakeCdpPeer,
  fakeSandboxApi,
} from "../testing/agent-browser-fake.js";
import { BROWSER_LIVE_BOUNDS } from "./bounds.js";
import { type BrowserLiveDependencies, type BrowserLiveViewer, relayBrowserTab } from "./relay.js";

/**
 * One live view of one tab, over a fake Chromium behind the real browser
 * service and a store the scenario keeps, on the test clock: the tab's
 * frames reach the panel and are acknowledged no faster than the cap, its
 * page state follows, input is refused until the member takes the tab
 * over and reaches the page mapped onto it after, any socket of the member
 * whose takeover stands drives it, a member who does not control the agent
 * cannot take it, a close hands the tab back, and a
 * coding agent's sandbox is held while its tab is watched and Luke's is
 * not. A tab the browser no longer holds, or the store no longer lists,
 * closes as gone; an agent with no sandbox yet as not opened; and a panel
 * that sends nothing as idle.
 */

const SESSION = "wrun_live_fixture";
const TARGET = "page-live";
const TARGET_SESSION = "target-session-1";
const MEMBER = "member-1";
const ASK = {
  userId: MEMBER,
  taskId: "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c",
  tabId: "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d",
};
const CONVERSATION = "conversation-agent";
const FRAME_DATA = "ZmFrZS1mcmFtZQ==";

/** The tab as the store reads it, a coding agent's on the deployment's GitHub App unless another agent is named. */
function reachedTab(agent: ReachedBrowserTab["agent"] | undefined): ReachedBrowserTab {
  return {
    tab: {
      id: ASK.tabId,
      conversationId: CONVERSATION,
      taskId: ASK.taskId,
      targetId: TARGET,
      address: "https://example.test/start",
      title: "Start",
      openedBy: AGENT_BROWSER_TAB_OPENER.AGENT,
      openedByUserId: null,
      driverUserId: null,
      heldUntil: null,
      createdAt: new Date(0),
      lastActedAt: new Date(0),
      cursorX: null,
      cursorY: null,
      cursorKind: null,
      cursorViewportW: null,
      cursorViewportH: null,
      cursorAt: null,
    },
    agent:
      agent === undefined
        ? { id: "agent-1", userId: "starter-1", githubAccess: GITHUB_ACCESS.APP }
        : agent,
  };
}

/** The panel's socket as a test drives it: messages pushed in, and what the relay sent and how it closed, kept. */
const scriptedViewer = Effect.gen(function* () {
  const inbound = yield* Queue.make<RelayFrame, Cause.Done>();
  const sent: RelayFrame[] = [];
  const closed: number[] = [];
  const viewer: BrowserLiveViewer = {
    frames: Stream.fromQueue(inbound),
    send: (frame) => Effect.sync(() => void sent.push(frame)),
    close: (code) =>
      Effect.andThen(
        Effect.sync(() => void closed.push(code)),
        Queue.end(inbound),
      ),
    buffered: Effect.succeed(0),
  };
  const messages = () => sent.flatMap((frame) => ("text" in frame ? [JSON.parse(frame.text)] : []));
  return {
    viewer,
    push: (message: BrowserLiveClientMessage) =>
      Queue.offer(inbound, { text: JSON.stringify(message) }),
    leave: Queue.end(inbound),
    messages,
    ofType: (type: string) => messages().filter((message) => message.type === type),
    closed,
  };
});

/** A Chromium holding the tab, answering the live view's own commands, and every command it was sent, kept. */
function liveBrowser(
  options: {
    readonly pages?: readonly { targetId: string; url: string; title: string }[];
    /** Whether the browser never answers a mouse event, as one stuck behind a slow page. */
    readonly mouseHangs?: boolean;
  } = {},
) {
  return Effect.gen(function* () {
    const commands: FakeCdpCommand[] = [];
    const peer = yield* fakeCdpPeer({
      pages: options.pages ?? [
        { targetId: TARGET, url: "https://example.test/start", title: "Start" },
      ],
      answer: (command) => {
        commands.push(command);
        if (command.method === "Target.attachToTarget")
          return { result: { sessionId: TARGET_SESSION } };
        if (command.method === "Target.getTargets") return undefined;
        if (command.method === "Page.getNavigationHistory") {
          return { result: { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] } };
        }
        if (options.mouseHangs === true && command.method === "Input.dispatchMouseEvent") {
          return { silent: true };
        }
        return { result: {} };
      },
    });
    const sandbox = fakeSandboxApi({ status: "running", sessionId: SESSION });
    const browser = agentBrowserOver(sandbox.api, fakeBridgePty(peer));
    return { peer, browser, commands };
  });
}

/** The store as the scenario has it: one tab, its takeover kept on the store's own terms, and the lease. */
function world(
  browser: BrowserLiveDependencies["browser"],
  options: { readonly reached?: ReachedBrowserTab; readonly session?: Option.Option<string> } = {},
) {
  let row: ReachedBrowserTab | undefined = options.reached ?? reachedTab(undefined);
  const holds: number[] = [];
  const keptAlive: { readonly sessionId: string; readonly at: number }[] = [];
  const handedBack: string[] = [];
  const notedPages: { readonly targetId: string; readonly address: string }[] = [];
  const setDriver = (driverUserId: string | null, heldUntil: Date | null) => {
    if (row !== undefined) row = { ...row, tab: { ...row.tab, driverUserId, heldUntil } };
  };
  const drivenBy = (now: Date) => {
    const tab = row?.tab;
    if (tab?.driverUserId == null || tab.heldUntil === null) return null;
    return tab.heldUntil.getTime() > now.getTime() ? tab.driverUserId : null;
  };
  const deps: BrowserLiveDependencies = {
    readTab: () => Effect.sync(() => Option.fromUndefinedOr(row)),
    sessionOf: () => Effect.succeed(options.session ?? Option.some(SESSION)),
    browser,
    takeOver: (_tab, userId, heldUntil, now) =>
      Effect.sync(() => {
        const driver = drivenBy(now);
        if (driver !== null && driver !== userId) return false;
        setDriver(userId, heldUntil);
        return true;
      }),
    renew: (_tab, userId, heldUntil, now) =>
      Effect.sync(() => {
        if (drivenBy(now) !== userId) return false;
        setDriver(userId, heldUntil);
        return true;
      }),
    handBack: (_tab, userId) =>
      Effect.sync(() => {
        if (row?.tab.driverUserId !== userId) return false;
        handedBack.push(userId);
        setDriver(null, null);
        return true;
      }),
    notePage: (_tab, targetId, page) =>
      Effect.sync(() => void notedPages.push({ targetId, address: page.address })),
    hold: (_conversation, heldUntil) => Effect.sync(() => void holds.push(heldUntil.getTime())),
    keepAlive: (sessionId) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        Effect.sync(() => void keptAlive.push({ sessionId, at })),
      ),
  };
  return {
    deps,
    holds,
    keptAlive,
    handedBack,
    notedPages,
    close: () => {
      row = undefined;
    },
    driveAs: (userId: string, heldUntil: Date) => setDriver(userId, heldUntil),
    /** Moves the tab onto the target given, as a browser that started afresh reopens it. */
    reopenAs: (targetId: string) => {
      if (row !== undefined) row = { ...row, tab: { ...row.tab, targetId } };
    },
  };
}

/** Lets every fiber the last step woke, the fake PTY's readers among them, run until the condition holds. */
function until(condition: () => boolean) {
  return Effect.gen(function* () {
    for (let step = 0; step < 500 && !condition(); step += 1) yield* Effect.yieldNow;
    assert.ok(condition(), "the relay reached the state the test waits on");
  });
}

const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

const frameEvent = (frameId: number) => ({
  method: "Page.screencastFrame",
  params: {
    data: FRAME_DATA,
    sessionId: frameId,
    metadata: { deviceWidth: 1280, deviceHeight: 800 },
  },
  sessionId: TARGET_SESSION,
});

const acks = (commands: readonly FakeCdpCommand[]) =>
  commands
    .filter((command) => command.method === "Page.screencastFrameAck")
    .map((command) => command.params.sessionId);

const inputs = (commands: readonly FakeCdpCommand[]) =>
  commands.filter((command) => command.method.startsWith("Input."));

/** The relay running for one panel over the browser and store given, once its screencast has started. */
function started(peer: FakeCdpPeer, commands: readonly FakeCdpCommand[], run: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(run);
    yield* until(() => commands.some((command) => command.method === "Page.startScreencast"));
    return { fiber, peer };
  });
}

it.effect(
  "the tab's frames reach the panel, each acknowledged no sooner than the cap after the last",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const { deps } = world(browser);
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), deps)),
      );

      const attach = commands.find((command) => command.method === "Target.attachToTarget");
      assert.deepEqual(attach?.params, { targetId: TARGET, flatten: true });
      const screencast = commands.find((command) => command.method === "Page.startScreencast");
      assert.equal(
        screencast?.sessionId,
        TARGET_SESSION,
        "the screencast runs on the tab's own target",
      );
      assert.equal(screencast?.params.format, "jpeg");

      yield* TestClock.adjust(Duration.seconds(1));
      yield* peer.emit(frameEvent(1));
      yield* until(() => acks(commands).length === 1);
      yield* peer.emit(frameEvent(2));
      yield* settle;
      assert.deepEqual(acks(commands), [1], "a frame that came early waits out the cap");
      assert.equal(
        panel.ofType(BROWSER_LIVE_SERVER.FRAME).length,
        2,
        "it reaches the panel at once",
      );
      yield* TestClock.adjust(BROWSER_LIVE_BOUNDS.FRAME_EVERY);
      yield* until(() => acks(commands).length === 2);

      assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.FRAME)[0], {
        type: BROWSER_LIVE_SERVER.FRAME,
        data: FRAME_DATA,
        pageWidth: 1280,
        pageHeight: 800,
      });
      assert.ok(
        commands
          .filter((command) => command.method === "Page.screencastFrameAck")
          .every((command) => command.sessionId === TARGET_SESSION),
      );
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect("the tab's address, title, and loading state reach the panel as they change", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), world(browser).deps)),
    );

    yield* peer.emit({
      method: "Page.frameStartedLoading",
      params: { frameId: TARGET },
      sessionId: TARGET_SESSION,
    });
    yield* peer.emit({
      method: "Target.targetInfoChanged",
      params: {
        targetInfo: {
          targetId: TARGET,
          url: "https://example.test/next",
          title: "Next",
          type: "page",
        },
      },
    });
    yield* peer.emit({
      method: "Target.targetInfoChanged",
      params: {
        targetInfo: {
          targetId: "page-other",
          url: "https://example.test/other",
          title: "Other",
          type: "page",
        },
      },
    });
    yield* peer.emit({
      method: "Page.frameStoppedLoading",
      params: { frameId: TARGET },
      sessionId: TARGET_SESSION,
    });
    yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.PAGE).length === 3);

    assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.PAGE), [
      {
        type: BROWSER_LIVE_SERVER.PAGE,
        address: "https://example.test/start",
        title: "Start",
        loading: true,
      },
      {
        type: BROWSER_LIVE_SERVER.PAGE,
        address: "https://example.test/next",
        title: "Next",
        loading: true,
      },
      {
        type: BROWSER_LIVE_SERVER.PAGE,
        address: "https://example.test/next",
        title: "Next",
        loading: false,
      },
    ]);
    yield* panel.leave;
    yield* Fiber.join(fiber);
  }),
);

/** The tab's page moved to the address and title given, as Chromium tells it. */
const pageMoved = (targetId: string, url: string, title: string) => ({
  method: "Target.targetInfoChanged",
  params: { targetInfo: { targetId, url, title, type: "page" } },
});

it.effect(
  "each move of the tab's page the view sees is kept on the tab's own target, for a restart to reopen it there, but a blank page and another tab's",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser);
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );

      yield* peer.emit(pageMoved(TARGET, "https://example.test/dashboard", "Dashboard"));
      yield* peer.emit(pageMoved("page-other", "https://example.test/other", "Other"));
      yield* peer.emit(pageMoved(TARGET, "about:blank", ""));
      yield* until(() =>
        panel.ofType(BROWSER_LIVE_SERVER.PAGE).some((message) => message.address === "about:blank"),
      );

      assert.deepEqual(store.notedPages, [
        { targetId: TARGET, address: "https://example.test/dashboard" },
      ]);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

const VIEWPORT = { type: BROWSER_LIVE_CLIENT.VIEWPORT, width: 640, height: 400 } as const;
const CLICK = {
  type: BROWSER_LIVE_CLIENT.MOUSE,
  action: BROWSER_LIVE_MOUSE_ACTION.DOWN,
  x: 320,
  y: 100,
  button: BROWSER_LIVE_MOUSE_BUTTON.LEFT,
  buttons: 1,
  clickCount: 1,
  modifiers: 0,
} as const;

it.effect(
  "input is refused until the member takes the tab over, and reaches the page mapped onto it after",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(
          relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), world(browser).deps),
        ),
      );
      yield* peer.emit(frameEvent(1));
      yield* until(() => acks(commands).length === 1);

      yield* panel.push(VIEWPORT);
      yield* panel.push(CLICK);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.REFUSED), [
        { type: BROWSER_LIVE_SERVER.REFUSED, reason: BROWSER_LIVE_REFUSAL.NOT_DRIVING },
      ]);
      assert.deepEqual(inputs(commands), [], "a refused input never reaches the page");

      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));
      yield* panel.push(CLICK);
      yield* panel.push({
        type: BROWSER_LIVE_CLIENT.KEY,
        action: BROWSER_LIVE_KEY_ACTION.DOWN,
        key: "a",
        code: "KeyA",
        keyCode: 65,
        modifiers: 0,
      });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TEXT, text: "pässword" });
      yield* until(() => inputs(commands).length === 3);

      const [click, key, text] = inputs(commands);
      assert.equal(click?.sessionId, TARGET_SESSION);
      assert.deepEqual(click?.params, {
        type: "mousePressed",
        x: 640,
        y: 200,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
      });
      assert.equal(key?.method, "Input.dispatchKeyEvent");
      assert.equal(key?.params.type, "keyDown");
      assert.equal(key?.params.text, "a");
      assert.deepEqual(text, {
        method: "Input.insertText",
        params: { text: "pässword" },
        sessionId: TARGET_SESSION,
      });
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

/** The commands that move the tab's page, as a step from its bar sends them. */
const steering = (commands: readonly FakeCdpCommand[]) =>
  commands.filter((command) =>
    ["Page.navigate", "Page.reload", "Page.navigateToHistoryEntry"].includes(command.method),
  );

it.effect(
  "a step from the bar takes a tab nobody drives over for the member, then opens the address, steps back and forward, and reloads",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(
          relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), world(browser).deps),
        ),
      );

      yield* panel.push({
        type: BROWSER_LIVE_CLIENT.NAVIGATE,
        address: "https://example.test/next",
      });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.BACK });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.FORWARD });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.RELOAD });
      yield* until(() => steering(commands).length === 4);

      assert.equal(panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours, true);
      assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.REFUSED), []);
      assert.deepEqual(steering(commands), [
        {
          method: "Page.navigate",
          params: { url: "https://example.test/next" },
          sessionId: TARGET_SESSION,
        },
        {
          method: "Page.navigateToHistoryEntry",
          params: { entryId: 10 },
          sessionId: TARGET_SESSION,
        },
        {
          method: "Page.navigateToHistoryEntry",
          params: { entryId: 12 },
          sessionId: TARGET_SESSION,
        },
        { method: "Page.reload", params: {}, sessionId: TARGET_SESSION },
      ]);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect(
  "a step from the bar is refused while another member holds the tab, and an address no Browser tab loads is passed over",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser);
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );

      yield* panel.push({ type: BROWSER_LIVE_CLIENT.NAVIGATE, address: "file:///etc/hosts" });
      store.driveAs("member-2", AN_HOUR_IN);
      yield* panel.push({
        type: BROWSER_LIVE_CLIENT.NAVIGATE,
        address: "https://example.test/next",
      });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.RELOAD });
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 2);

      assert.deepEqual(
        panel.ofType(BROWSER_LIVE_SERVER.REFUSED).map((message) => message.reason),
        [BROWSER_LIVE_REFUSAL.HELD, BROWSER_LIVE_REFUSAL.HELD],
      );
      assert.equal(panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.driver?.userId, "member-2");
      assert.deepEqual(steering(commands), [], "nothing moved the page another member drives");
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect("a member who does not control the agent cannot take its tab over", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const ownToken = reachedTab({
      id: "agent-1",
      userId: "starter-1",
      githubAccess: GITHUB_ACCESS.TOKEN,
    });
    const store = world(browser, { reached: ownToken });
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, ownToken, store.deps)),
    );

    yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
    yield* panel.push(CLICK);
    yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 2);

    assert.deepEqual(
      panel.ofType(BROWSER_LIVE_SERVER.REFUSED).map((message) => message.reason),
      [BROWSER_LIVE_REFUSAL.NOT_PERMITTED, BROWSER_LIVE_REFUSAL.NOT_DRIVING],
    );
    assert.deepEqual(inputs(commands), []);
    yield* panel.leave;
    yield* Fiber.join(fiber);
  }),
);

it.effect(
  "a tab another member drives answers them as its driver, and a takeover that lapsed refuses input",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser);
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );
      yield* peer.emit(frameEvent(1));
      yield* until(() => acks(commands).length === 1);

      store.driveAs("member-2", new Date(Date.UTC(1970, 0, 1, 1)));
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() =>
        panel
          .ofType(BROWSER_LIVE_SERVER.DRIVER)
          .some((message) => message.driver?.userId === "member-2"),
      );
      assert.equal(panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1).yours, false);

      store.driveAs("member-2", new Date(0));
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours === true);
      // Another window's member takes the tab once this one's takeover lapsed with no input.
      yield* TestClock.adjust(Duration.minutes(2));
      store.driveAs("member-2", new Date(Date.UTC(1970, 0, 1, 1)));
      yield* panel.push(VIEWPORT);
      yield* panel.push(CLICK);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(inputs(commands), []);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect("a socket that closes hands back the takeover it took", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const store = world(browser);
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
    );

    yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
    yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));
    yield* panel.leave;
    yield* Fiber.join(fiber);

    assert.deepEqual(store.handedBack, [MEMBER]);
    assert.deepEqual(panel.closed, [], "a panel that left is sent no close");
  }),
);

it.effect("a watched coding agent's sandbox is held, and moved on as the panel acts", () =>
  Effect.gen(function* () {
    const coder = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const store = world(coder.browser);
    const { fiber } = yield* started(
      coder.peer,
      coder.commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
    );
    assert.equal(store.holds.length, 1, "connecting holds the sandbox");
    assert.ok((store.holds[0] ?? 0) > Duration.toMillis(BROWSER_LIVE_BOUNDS.IDLE));
    yield* TestClock.adjust(BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY);
    yield* panel.push(VIEWPORT);
    yield* until(() => store.holds.length === 2);
    assert.ok((store.holds[1] ?? 0) > (store.holds[0] ?? 0));
    yield* panel.leave;
    yield* Fiber.join(fiber);
  }),
);

it.effect(
  "a watched coding agent's sandbox is kept alive once its browser is reached, every keep-alive interval while the panel acts, and no longer once it closes",
  () =>
    Effect.gen(function* () {
      const coder = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(coder.browser);
      const every = Duration.toMillis(CODER.SANDBOX_KEEP_ALIVE_EVERY);
      const { fiber } = yield* started(
        coder.peer,
        coder.commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );
      // The panel acting every four minutes, inside the idle bound, for two keep-alive intervals.
      for (let acted = 0; acted < 2 * every; acted += Duration.toMillis(Duration.minutes(4))) {
        yield* TestClock.adjust(Duration.minutes(4));
        yield* panel.push(VIEWPORT);
        yield* settle;
      }
      yield* panel.leave;
      yield* Fiber.join(fiber);
      yield* TestClock.adjust(CODER.SANDBOX_KEEP_ALIVE_EVERY);

      assert.deepEqual(
        store.keptAlive,
        [0, every, 2 * every].map((at) => ({ sessionId: SESSION, at })),
      );
    }),
);

it.effect(
  "a tab the browser no longer holds closes as gone, and an agent with no sandbox yet as not opened",
  () =>
    Effect.gen(function* () {
      const missing = yield* liveBrowser({ pages: [] });
      const gonePanel = yield* scriptedViewer;
      yield* Effect.scoped(
        relayBrowserTab(gonePanel.viewer, ASK, reachedTab(undefined), world(missing.browser).deps),
      );
      assert.deepEqual(gonePanel.ofType(BROWSER_LIVE_SERVER.CLOSED), [
        { type: BROWSER_LIVE_SERVER.CLOSED, reason: BROWSER_LIVE_CLOSE_REASON.GONE },
      ]);
      assert.deepEqual(gonePanel.closed, [BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.GONE]]);

      const unopened = yield* liveBrowser();
      const unopenedPanel = yield* scriptedViewer;
      yield* Effect.scoped(
        relayBrowserTab(
          unopenedPanel.viewer,
          ASK,
          reachedTab(undefined),
          world(unopened.browser, { session: Option.none() }).deps,
        ),
      );
      assert.deepEqual(unopenedPanel.closed, [
        BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.NOT_OPENED],
      ]);
      assert.deepEqual(unopened.commands, [], "no browser is reached for an agent that never ran");
    }),
);

it.effect(
  "a tab its browser reopened on a new target as it started afresh is cast on that target, not closed as gone",
  () =>
    Effect.gen(function* () {
      const reopened = "page-reopened";
      const { peer, browser, commands } = yield* liveBrowser({
        pages: [{ targetId: reopened, url: "https://example.test/start", title: "Start" }],
      });
      const panel = yield* scriptedViewer;
      const store = world(browser);
      // The connection reopens the kept tab on a new target, as `connectRestoring` does after a resume.
      const deps: BrowserLiveDependencies = {
        ...store.deps,
        browser: {
          connect: (sessionId) =>
            Effect.andThen(
              Effect.sync(() => store.reopenAs(reopened)),
              browser.connect(sessionId),
            ),
        },
      };

      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), deps)),
      );

      const attach = commands.find((command) => command.method === "Target.attachToTarget");
      assert.deepEqual(attach?.params, { targetId: reopened, flatten: true });
      assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.CLOSED), []);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect(
  "a tab the member stopped reaching while its browser was reached is never cast, and a store that could not say closes as unavailable",
  () =>
    Effect.gen(function* () {
      const revoked = yield* liveBrowser();
      const revokedPanel = yield* scriptedViewer;
      const revokedStore = world(revoked.browser);
      yield* Effect.scoped(
        relayBrowserTab(revokedPanel.viewer, ASK, reachedTab(undefined), {
          ...revokedStore.deps,
          browser: {
            connect: (sessionId) =>
              Effect.andThen(
                Effect.sync(() => revokedStore.close()),
                revoked.browser.connect(sessionId),
              ),
          },
        }),
      );
      assert.deepEqual(revokedPanel.closed, [
        BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.GONE],
      ]);
      assert.ok(!revoked.commands.some((command) => command.method === "Page.startScreencast"));

      const failing = yield* liveBrowser();
      const failingPanel = yield* scriptedViewer;
      const failingStore = world(failing.browser);
      let connected = false;
      yield* Effect.scoped(
        relayBrowserTab(failingPanel.viewer, ASK, reachedTab(undefined), {
          ...failingStore.deps,
          readTab: (...args) =>
            connected ? Effect.fail("store unavailable") : failingStore.deps.readTab(...args),
          browser: {
            connect: (sessionId) =>
              Effect.andThen(
                Effect.sync(() => {
                  connected = true;
                }),
                failing.browser.connect(sessionId),
              ),
          },
        }),
      );
      assert.deepEqual(failingPanel.closed, [
        BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE],
      ]);
      assert.ok(!failing.commands.some((command) => command.method === "Page.startScreencast"));
    }),
);

it.effect("a tab its agent closed, or its browser destroyed, closes the socket as gone", () =>
  Effect.gen(function* () {
    const listed = yield* liveBrowser();
    const listedPanel = yield* scriptedViewer;
    const store = world(listed.browser);
    const { fiber } = yield* started(
      listed.peer,
      listed.commands,
      Effect.scoped(relayBrowserTab(listedPanel.viewer, ASK, reachedTab(undefined), store.deps)),
    );
    store.close();
    yield* TestClock.adjust(BROWSER_LIVE_BOUNDS.TAB_CHECK_EVERY);
    yield* Fiber.join(fiber);
    assert.deepEqual(listedPanel.closed, [BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.GONE]]);

    const destroyed = yield* liveBrowser();
    const destroyedPanel = yield* scriptedViewer;
    const relay = yield* started(
      destroyed.peer,
      destroyed.commands,
      Effect.scoped(
        relayBrowserTab(
          destroyedPanel.viewer,
          ASK,
          reachedTab(undefined),
          world(destroyed.browser).deps,
        ),
      ),
    );
    yield* destroyed.peer.emit({ method: "Target.targetDestroyed", params: { targetId: TARGET } });
    yield* Fiber.join(relay.fiber);
    assert.deepEqual(destroyedPanel.closed, [
      BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.GONE],
    ]);
  }),
);

it.effect("a panel that sends nothing for the idle bound closes as idle", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), world(browser).deps)),
    );

    yield* TestClock.adjust(Duration.minutes(4));
    yield* panel.push(VIEWPORT);
    yield* settle;
    yield* TestClock.adjust(Duration.minutes(4));
    assert.deepEqual(panel.closed, [], "a message keeps the socket open");
    yield* TestClock.adjust(Duration.minutes(2));
    yield* Fiber.join(fiber);

    assert.deepEqual(panel.ofType(BROWSER_LIVE_SERVER.CLOSED).at(-1), {
      type: BROWSER_LIVE_SERVER.CLOSED,
      reason: BROWSER_LIVE_CLOSE_REASON.IDLE,
    });
    assert.deepEqual(panel.closed, [BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.IDLE]]);
  }),
);

it.effect(
  "closing one window leaves the tab to the same member's other window that moved the takeover on since",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const first = yield* scriptedViewer;
      const second = yield* scriptedViewer;
      const store = world(browser);
      const relay = (panel: Effect.Success<typeof scriptedViewer>) =>
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps));
      const one = yield* started(peer, commands, relay(first));
      yield* first.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => first.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));

      yield* TestClock.adjust(Duration.seconds(20));
      const two = yield* Effect.forkChild(relay(second));
      yield* until(() => second.ofType(BROWSER_LIVE_SERVER.DRIVER).length > 0);
      yield* second.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(
        () =>
          second.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours === true &&
          second.ofType(BROWSER_LIVE_SERVER.DRIVER).length > 1,
      );
      yield* first.leave;
      yield* Fiber.join(one.fiber);
      assert.deepEqual(store.handedBack, [], "the other window still drives");

      yield* second.leave;
      yield* Fiber.join(two);
      assert.deepEqual(store.handedBack, [MEMBER], "the last window's close hands the tab back");
    }),
);

it.effect(
  "input queued behind a slow browser never lands once the member handed the tab back",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser({ mouseHangs: true });
      const panel = yield* scriptedViewer;
      const store = world(browser);
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );
      yield* peer.emit(frameEvent(1));
      yield* until(() => acks(commands).length === 1);
      yield* panel.push(VIEWPORT);
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));

      yield* panel.push(CLICK);
      yield* until(() => inputs(commands).length === 1);
      yield* panel.push({ ...CLICK, action: BROWSER_LIVE_MOUSE_ACTION.UP });
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HAND_BACK });
      yield* until(() => store.handedBack.length === 1);
      yield* TestClock.adjust(Duration.seconds(31));
      yield* settle;

      assert.equal(
        inputs(commands).length,
        1,
        "the click queued before the hand-back went nowhere",
      );
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect(
  "a renewal the store cannot answer keeps input going only until the last write lapses",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser);
      const deps = { ...store.deps, renew: () => Effect.fail("store down") };
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), deps)),
      );
      yield* peer.emit(frameEvent(1));
      yield* until(() => acks(commands).length === 1);
      yield* panel.push(VIEWPORT);
      yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));

      yield* TestClock.adjust(Duration.seconds(30));
      yield* panel.push(CLICK);
      yield* until(() => inputs(commands).length === 1);
      yield* TestClock.adjust(Duration.seconds(31));
      yield* panel.push(CLICK);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);

      assert.equal(inputs(commands).length, 1);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect("a hand-back the store did not take is tried again as the socket closes", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const store = world(browser);
    let refusals = 1;
    const deps: BrowserLiveDependencies = {
      ...store.deps,
      handBack: (tab, userId) => {
        if (refusals === 0) return store.deps.handBack(tab, userId);
        refusals -= 1;
        return Effect.fail("store down");
      },
    };
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), deps)),
    );
    yield* panel.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
    yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));
    yield* panel.push({ type: BROWSER_LIVE_CLIENT.HAND_BACK });
    yield* until(() => refusals === 0);
    assert.deepEqual(store.handedBack, []);

    yield* panel.leave;
    yield* Fiber.join(fiber);
    assert.deepEqual(store.handedBack, [MEMBER]);
  }),
);

it.effect("the tab's screencast is stopped as the view ends", () =>
  Effect.gen(function* () {
    const { peer, browser, commands } = yield* liveBrowser();
    const panel = yield* scriptedViewer;
    const { fiber } = yield* started(
      peer,
      commands,
      Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), world(browser).deps)),
    );
    yield* panel.leave;
    yield* Fiber.join(fiber);

    const stop = commands.find((command) => command.method === "Page.stopScreencast");
    assert.equal(stop?.sessionId, TARGET_SESSION);
    assert.ok(commands.some((command) => command.method === "Target.detachFromTarget"));
  }),
);

const KEY_A = {
  type: BROWSER_LIVE_CLIENT.KEY,
  action: BROWSER_LIVE_KEY_ACTION.DOWN,
  key: "a",
  code: "KeyA",
  keyCode: 65,
  modifiers: 0,
} as const;

/** The tab as the store reads it while the member given holds a takeover until the instant given. */
function drivenTab(userId: string, heldUntil: Date, agent?: ReachedBrowserTab["agent"]) {
  const reached = reachedTab(agent);
  return { ...reached, tab: { ...reached.tab, driverUserId: userId, heldUntil } };
}

const AN_HOUR_IN = new Date(Date.UTC(1970, 0, 1, 1));

it.effect(
  "a reconnecting socket of the takeover's member drives without taking the tab over again, and another member's socket is refused",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const own = yield* scriptedViewer;
      const other = yield* scriptedViewer;
      const store = world(browser, { reached: drivenTab(MEMBER, AN_HOUR_IN) });
      const relay = (panel: Effect.Success<typeof scriptedViewer>, userId: string) =>
        Effect.scoped(
          relayBrowserTab(panel.viewer, { ...ASK, userId }, reachedTab(undefined), store.deps),
        );
      const mine = yield* started(peer, commands, relay(own, MEMBER));
      const theirs = yield* Effect.forkChild(relay(other, "member-2"));
      yield* until(() => other.ofType(BROWSER_LIVE_SERVER.DRIVER).length > 0);
      assert.equal(own.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours, true);
      assert.equal(other.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours, false);

      yield* other.push(KEY_A);
      yield* until(() => other.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(inputs(commands), [], "another member's input never reaches the page");

      yield* own.push(KEY_A);
      yield* until(() => inputs(commands).length === 1);
      assert.deepEqual(own.ofType(BROWSER_LIVE_SERVER.REFUSED), []);
      assert.equal(inputs(commands)[0]?.sessionId, TARGET_SESSION);

      yield* own.leave;
      yield* other.leave;
      yield* Fiber.join(mine.fiber);
      yield* Fiber.join(theirs);
      assert.deepEqual(store.handedBack, [MEMBER], "the socket that moved it on hands it back");
    }),
);

it.effect(
  "a member who holds the takeover but no longer controls the agent is not told it is theirs, and is refused",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const ownToken = { id: "agent-1", userId: "starter-1", githubAccess: GITHUB_ACCESS.TOKEN };
      const driven = drivenTab(MEMBER, AN_HOUR_IN, ownToken);
      const store = world(browser, { reached: driven });
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, driven, store.deps)),
      );
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).length > 0);
      assert.equal(panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours, false);

      yield* panel.push(KEY_A);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(inputs(commands), []);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect(
  "a reconnecting socket is refused once the member's takeover lapsed, and drives again once another of their windows moved it on",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser, { reached: drivenTab(MEMBER, new Date(3000)) });
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).length > 0);

      // The takeover lapses before the tab is read again.
      yield* TestClock.adjust(Duration.seconds(4));
      yield* panel.push(KEY_A);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(inputs(commands), [], "a lapsed takeover's input never reaches the page");

      store.driveAs(MEMBER, AN_HOUR_IN);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours === true);
      yield* panel.push(KEY_A);
      yield* until(() => inputs(commands).length === 1);
      assert.equal(panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length, 1);
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);

it.effect(
  "closing one of two sockets of the same member keeps the takeover for the other, which drives without taking it over",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const first = yield* scriptedViewer;
      const second = yield* scriptedViewer;
      const store = world(browser);
      const relay = (panel: Effect.Success<typeof scriptedViewer>) =>
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps));
      const one = yield* started(peer, commands, relay(first));
      yield* first.push({ type: BROWSER_LIVE_CLIENT.TAKE_OVER });
      yield* until(() => first.ofType(BROWSER_LIVE_SERVER.DRIVER).some((message) => message.yours));

      yield* TestClock.adjust(Duration.seconds(20));
      const two = yield* Effect.forkChild(relay(second));
      yield* until(() => second.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours === true);
      yield* second.push(KEY_A);
      yield* until(() => inputs(commands).length === 1);

      yield* first.leave;
      yield* Fiber.join(one.fiber);
      assert.deepEqual(store.handedBack, [], "the other socket still drives");
      yield* TestClock.adjust(BROWSER_LIVE_BOUNDS.RENEW_EVERY);
      yield* second.push(KEY_A);
      yield* until(() => inputs(commands).length === 2);
      assert.deepEqual(second.ofType(BROWSER_LIVE_SERVER.REFUSED), []);

      yield* second.leave;
      yield* Fiber.join(two);
      assert.deepEqual(store.handedBack, [MEMBER], "the last socket's close hands the tab back");
    }),
);

it.effect(
  "a reconnecting socket of the takeover's member hands the tab back before it sends any input",
  () =>
    Effect.gen(function* () {
      const { peer, browser, commands } = yield* liveBrowser();
      const panel = yield* scriptedViewer;
      const store = world(browser, { reached: drivenTab(MEMBER, AN_HOUR_IN) });
      const { fiber } = yield* started(
        peer,
        commands,
        Effect.scoped(relayBrowserTab(panel.viewer, ASK, reachedTab(undefined), store.deps)),
      );
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.yours === true);

      yield* panel.push({ type: BROWSER_LIVE_CLIENT.HAND_BACK });
      yield* until(() => store.handedBack.length === 1);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.DRIVER).at(-1)?.driver === null);
      yield* panel.push(KEY_A);
      yield* until(() => panel.ofType(BROWSER_LIVE_SERVER.REFUSED).length === 1);
      assert.deepEqual(inputs(commands), [], "input after the hand-back never reaches the page");
      yield* panel.leave;
      yield* Fiber.join(fiber);
    }),
);
