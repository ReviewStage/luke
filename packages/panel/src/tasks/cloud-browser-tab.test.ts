// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_HISTORY,
  BROWSER_LIVE_REFUSAL,
  BROWSER_LIVE_SERVER,
} from "@luke/features/browser-live-wire";
import {
  BROWSER_TAB_OPEN_FAILURE,
  type TasksBrowserTabOpenParams,
} from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { COMMAND_KEY } from "@luke/settings/shortcuts";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Context, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { rendererRuntime } from "../renderer-runtime.js";
import { announcedAsAlert, mountAnnouncer } from "../testing/announcer.js";
import { fakeActPort, fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { onPhone } from "../testing/phone-tab.js";
import type { BrowserLiveListener } from "./cloud-browser-live.js";
import { CloudBrowserDraftPane, CloudBrowserPane } from "./cloud-browser-pane.js";
import {
  CLOUD_BROWSER_AGENT_RECENT,
  CLOUD_BROWSER_TABS_AGAIN,
  noteOpenedCloudTab,
  useCloudBrowserTabs,
} from "./cloud-browser-tabs.js";
import {
  type OpenTask,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel.js";

/**
 * The side panel's cloud Browser tabs: the task's tabs as the service lists
 * them, read only while the Browser tab experiment is on; each drawn in the
 * strip, kept chosen while the list is on its way, and closed in this window
 * alone; and one tab's pane, which waits quietly for the page, draws it once
 * a frame arrives, takes the tab over and hands it back, and steers it from
 * its bar; and a draft, which opens nothing until its bar's Enter. A
 * synthetic task and tab throughout, the live view over a fake door.
 */

/** Luke, whose browser a tab is in, wearing a plain glyph. */
const LUKE_OWNER = { name: "Luke", icon: createElement("span") };

/** An agent whose browser a draft opens in. */
const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const TAB = "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b";
const OTHER_TAB = "6b1f2a3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";

const LISTED: AgentBrowserTab = {
  id: TAB,
  agentId: null,
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: { kind: "agent" },
  driver: null,
  createdAt: 1_000,
  lastActedAt: 2_000,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** Lets the window's reads, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Draws an element under a fresh atom registry, as the window's root does. */
function draw(element: React.ReactElement): { rerender: (next: React.ReactElement) => void } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() => root.render(onRegistry(registry, element)));
  return { rerender: (next) => act(() => root.render(onRegistry(registry, next))) };
}

/** A task that has used every fixed tab. */
const USED: OpenTask = {
  id: TASK,
  holds: Object.fromEntries(SIDE_PANEL_TABS.map((tab) => [tab, true])),
};

/** A follow the test pushes changes through, as the host's stream tells them, and which it sees closed. */
function pushedFollow<View>(): {
  stream: AsyncIteratorObject<View, undefined, unknown>;
  push: (view: View) => void;
  closed: () => boolean;
} {
  const waiting: ((result: IteratorResult<View, undefined>) => void)[] = [];
  const queued: View[] = [];
  let ended = false;
  const close = () => {
    ended = true;
    for (const resolve of waiting.splice(0)) resolve({ done: true, value: undefined });
  };
  const stream: AsyncIteratorObject<View, undefined, unknown> = {
    next: () => {
      const view = queued.shift();
      if (view !== undefined) return Promise.resolve({ done: false, value: view });
      if (ended) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => waiting.push(resolve));
    },
    return: async () => {
      close();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: async () => close(),
  };
  return {
    stream,
    push: (view) => {
      const resolve = waiting.shift();
      if (resolve === undefined) queued.push(view);
      else resolve({ done: false, value: view });
    },
    closed: () => ended,
  };
}

test("the task's cloud Browser tabs are read once and then followed live, the agent's pointer moving with them, let go as no reader stands, and not read at all while the experiment is off", async () => {
  const asked: SentPortAct[] = [];
  const follow = pushedFollow<{ tabs: readonly AgentBrowserTab[] } | { failure: string }>();
  fakeActPortAnswering((request) => {
    asked.push(request);
    if (request.kind === ACT_KIND.TASKS_BROWSER_TABS_FOLLOW) {
      // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
      return Promise.resolve(follow.stream as unknown as WireBoundaryInput);
    }
    return Promise.resolve({ tabs: [LISTED] });
  });
  let read: readonly AgentBrowserTab[] | undefined;
  function Probe({ listing }: { listing: boolean }) {
    read = useCloudBrowserTabs(TASK, listing);
    return null;
  }

  const panel = draw(createElement(Probe, { listing: false }));
  await settle();
  assert.deepEqual(read, []);
  assert.deepEqual([...asked], []);

  panel.rerender(createElement(Probe, { listing: true }));
  await settle();
  assert.deepEqual(read, [LISTED]);
  assert.deepEqual(
    [...asked],
    [
      { kind: ACT_KIND.TASKS_BROWSER_TABS, payload: { taskId: TASK } },
      { kind: ACT_KIND.TASKS_BROWSER_TABS_FOLLOW, payload: { taskId: TASK } },
    ],
  );

  const pointed: AgentBrowserTab = {
    ...LISTED,
    lastActedAt: 3_000,
    cursor: { x: 640, y: 400, kind: "click", viewport: { width: 1280, height: 800 }, at: 3_000 },
  };
  await act(async () => follow.push({ tabs: [pointed] }));
  await settle();
  assert.deepEqual(read, [pointed], "a move the follow tells is drawn without another read");
  await act(async () => follow.push({ failure: "unanswered" }));
  await settle();
  assert.deepEqual(read, [pointed], "a change the host could not read keeps the list");
  assert.equal(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_BROWSER_TABS).length,
    1,
    "the tabs are never read again on a beat",
  );

  panel.rerender(createElement(Probe, { listing: false }));
  await settle();
  assert.ok(follow.closed(), "the follow is let go once no reader stands");
});

test("a follow the host refused is read and followed again on the beat, so the tabs still move", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const asked: SentPortAct[] = [];
  const follow = pushedFollow<{ tabs: readonly AgentBrowserTab[] }>();
  let follows = 0;
  fakeActPortAnswering((request) => {
    asked.push(request);
    if (request.kind !== ACT_KIND.TASKS_BROWSER_TABS_FOLLOW) {
      return Promise.resolve({ tabs: [LISTED] });
    }
    follows += 1;
    // The first follow is refused, as a host the window lost a moment would.
    if (follows === 1) return Promise.reject(new Error("The host is not answering."));
    // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
    return Promise.resolve(follow.stream as unknown as WireBoundaryInput);
  });
  let read: readonly AgentBrowserTab[] | undefined;
  function Probe() {
    read = useCloudBrowserTabs(TASK, true);
    return null;
  }
  try {
    draw(createElement(Probe));
    await settle();
    assert.deepEqual(read, [LISTED]);
    assert.equal(follows, 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(Duration.toMillis(CLOUD_BROWSER_TABS_AGAIN));
    });
    await settle();
    assert.equal(follows, 2, "followed again on the beat");
    const moved: AgentBrowserTab = { ...LISTED, lastActedAt: 4_000 };
    await act(async () => follow.push({ tabs: [moved] }));
    await settle();
    assert.deepEqual(read, [moved]);
  } finally {
    vi.useRealTimers();
  }
});

test("a listed cloud Browser tab stands in the strip, stays chosen while the list is on its way, and closes in this window alone", () => {
  let control: SidePanelControl | undefined;
  function Probe({ listed }: { listed: readonly string[] | undefined }) {
    control = useSidePanel(undefined, USED, [], [], [], [], [], undefined, listed);
    return null;
  }
  const current = () => {
    assert.ok(control);
    return control;
  };
  const panel = draw(createElement(Probe, { listed: [TAB, OTHER_TAB] }));
  assert.deepEqual(
    current().strip.filter((tab) => tab instanceof Object && "cloudBrowser" in tab),
    [{ cloudBrowser: TAB }, { cloudBrowser: OTHER_TAB }],
  );

  act(() => current().onChoose({ cloudBrowser: TAB }));
  panel.rerender(createElement(Probe, { listed: undefined }));
  assert.deepEqual(current().tab, { cloudBrowser: TAB }, "kept while the list is read again");

  panel.rerender(createElement(Probe, { listed: [TAB, OTHER_TAB] }));
  act(() => current().onClose({ cloudBrowser: TAB }));
  assert.deepEqual(
    current().strip.filter((tab) => tab instanceof Object && "cloudBrowser" in tab),
    [{ cloudBrowser: OTHER_TAB }],
  );
  assert.notDeepEqual(current().tab, { cloudBrowser: TAB });

  act(() => current().onChoose({ cloudBrowser: OTHER_TAB }));
  panel.rerender(createElement(Probe, { listed: [] }));
  assert.equal(current().tab, SIDE_PANEL_TAB.PLAN, "a tab the service no longer lists gives way");
});

test("a cloud Browser tab's pane spins while it waits for the page, draws it once a frame arrives, and takes the tab over and hands it back", async () => {
  const sent: unknown[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (target, heard) => {
      assert.deepEqual(target, { taskId: TASK, tabId: TAB });
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  const say = async (message: object) => {
    await act(async () => listener?.message(JSON.stringify(message)));
    await settle();
  };
  const press = async (name: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (each) => each.textContent === name,
    );
    assert.ok(button, `a ${name} button`);
    await act(async () => button.click());
  };
  // What stands over the page, apart from the line under the bar saying who has the tab.
  const status = () =>
    document.querySelector('.cloud-browser-body [role="status"]')?.textContent ?? undefined;

  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  assert.ok(listener, "the pane opened its view");
  // The window's own spinner stands while the page is on its way, its words for a screen reader alone.
  await vi.waitFor(() => assert.equal(status(), "Waiting for the page"));
  assert.ok(document.querySelector(".cloud-browser-notice .luke-spinner"), "the spinner is drawn");
  assert.ok(
    document.querySelector("section.ph-no-capture"),
    "the pane is left out of the recording",
  );

  await say({
    type: BROWSER_LIVE_SERVER.FRAME,
    data: "/9j/AA==",
    pageWidth: 1280,
    pageHeight: 800,
  });
  assert.equal(status(), undefined);

  await press("Take over");
  await say({
    type: BROWSER_LIVE_SERVER.DRIVER,
    driver: { userId: "user-dean", heldUntil: 60_000 },
    yours: true,
  });
  assert.ok(document.body.textContent?.includes("You're driving"));
  await press("Hand back");

  assert.deepEqual(
    sent.filter(
      (message) =>
        message instanceof Object &&
        "type" in message &&
        message.type !== BROWSER_LIVE_CLIENT.VIEWPORT,
    ),
    [{ type: BROWSER_LIVE_CLIENT.TAKE_OVER }, { type: BROWSER_LIVE_CLIENT.HAND_BACK }],
  );
});

test("a pane's view closes while its window's page is hidden, and a new one opens once it is shown again", async () => {
  const sockets: { closed: boolean }[] = [];
  fakeAppPlatform({
    openBrowserLive: () => {
      const socket = { closed: false };
      sockets.push(socket);
      return {
        send: () => undefined,
        close: () => {
          socket.closed = true;
        },
      };
    },
  });
  const turn = async (visibility: DocumentVisibilityState) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
  };
  try {
    draw(
      createElement(CloudBrowserPane, {
        taskId: TASK,
        tab: LISTED,
        owner: LUKE_OWNER,
        shown: true,
        memberName: () => undefined,
      }),
    );
    await settle();
    assert.deepEqual(sockets, [{ closed: false }], "the pane opened its view");

    await turn("hidden");
    assert.deepEqual(sockets, [{ closed: true }], "a hidden window holds no socket");

    await turn("visible");
    assert.deepEqual(sockets, [{ closed: true }, { closed: false }], "shown again, a new view");
  } finally {
    vi.restoreAllMocks();
  }
});

it.effect(
  "a visible pane nobody touches stays live past the relay's idle bound, saying it is watching each minute on the one socket",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const sent: { readonly type: string }[] = [];
      const closed: boolean[] = [];
      fakeAppPlatform({
        openBrowserLive: () => {
          closed.push(false);
          return {
            send: (text) => sent.push(JSON.parse(text)),
            close: () => {
              closed[closed.length - 1] = true;
            },
          };
        },
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const registry = AtomRegistry.make({
        initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
      });
      act(() =>
        root.render(
          onRegistry(
            registry,
            createElement(CloudBrowserPane, {
              taskId: TASK,
              tab: LISTED,
              owner: LUKE_OWNER,
              shown: true,
              memberName: () => undefined,
            }),
          ),
        ),
      );
      const landed = Effect.promise(settle);
      yield* landed;
      for (let minute = 0; minute < 6; minute += 1) {
        yield* TestClock.adjust(Duration.minutes(1));
        yield* landed;
      }

      assert.deepEqual(closed, [false], "one socket, still open");
      assert.equal(
        sent.filter((message) => message.type === BROWSER_LIVE_CLIENT.WATCHING).length,
        6,
        "watching said each minute, past the relay's five idle minutes",
      );
    }),
);

test("while the member drives, a paste reaches the page as text, Control-V and ⌘V leave the paste to the window, and the wheel scrolls the page alone", async () => {
  const sent: { type: string }[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  const canvas = document.querySelector("canvas");
  assert.ok(canvas);
  const wheel = () => {
    const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(wheel(), false, "watching, the wheel is the panel's");

  await act(async () =>
    listener?.message(
      JSON.stringify({
        type: BROWSER_LIVE_SERVER.DRIVER,
        driver: { userId: "user-dean", heldUntil: 60_000 },
        yours: true,
      }),
    ),
  );
  await settle();
  const keyDown = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      canvas.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  assert.equal(keyDown({ key: "v", code: "KeyV", ctrlKey: true }), false);
  assert.equal(keyDown({ key: "v", code: "KeyV", metaKey: true }), false);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(paste, { clipboardData: { getData: () => "hello" } });
  act(() => {
    canvas.dispatchEvent(paste);
  });
  assert.equal(wheel(), true, "driving, the wheel is the page's alone");

  assert.deepEqual(
    sent.filter(
      (message) =>
        message.type === BROWSER_LIVE_CLIENT.KEY || message.type === BROWSER_LIVE_CLIENT.TEXT,
    ),
    [{ type: BROWSER_LIVE_CLIENT.TEXT, text: "hello" }],
  );
});

test("off a Mac, while the member drives, a Ctrl chord the window has a command for goes to the page, and the window never hears it", async () => {
  const sent: { type: string; key?: string }[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    commandKey: COMMAND_KEY.CONTROL,
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  await act(async () =>
    listener?.message(
      JSON.stringify({
        type: BROWSER_LIVE_SERVER.DRIVER,
        driver: { userId: "user-dean", heldUntil: 60_000 },
        yours: true,
      }),
    ),
  );
  await settle();
  const canvas = document.querySelector("canvas");
  assert.ok(canvas);
  const heard: KeyboardEvent[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event);
  window.addEventListener("keydown", hear);
  act(() => {
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  window.removeEventListener("keydown", hear);

  assert.deepEqual(
    sent.filter((message) => message.type === BROWSER_LIVE_CLIENT.KEY).map(({ key }) => key),
    ["b"],
  );
  assert.deepEqual(heard, [], "the window's keymap yields the press, so the sidebar stays put");
});

test("a tab the member opened here is listed before the service lists it, and let go once it does", async () => {
  const opened: AgentBrowserTab = {
    ...LISTED,
    id: OTHER_TAB,
    openedBy: { kind: "member", userId: "user-dean" },
    driver: { userId: "user-dean", heldUntil: 60_000 },
  };
  const follow = pushedFollow<{ tabs: readonly AgentBrowserTab[] } | { failure: string }>();
  fakeActPortAnswering((request) => {
    if (request.kind === ACT_KIND.TASKS_BROWSER_TABS_FOLLOW) {
      // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
      return Promise.resolve(follow.stream as unknown as WireBoundaryInput);
    }
    return Promise.resolve({ tabs: [LISTED] });
  });
  let read: readonly AgentBrowserTab[] | undefined;
  function Probe() {
    read = useCloudBrowserTabs(TASK, true);
    return null;
  }

  noteOpenedCloudTab(TASK, opened);
  draw(createElement(Probe));
  await settle();
  assert.deepEqual(
    read?.map((tab) => tab.id),
    [TAB, OTHER_TAB],
    "listed beside what the service listed, before it lists it",
  );

  // The service lists it, and later its agent's browser closes it: it goes, as any listed tab would.
  await act(async () => follow.push({ tabs: [LISTED, opened] }));
  await settle();
  await act(async () => follow.push({ tabs: [LISTED] }));
  await settle();
  assert.deepEqual(
    read?.map((tab) => tab.id),
    [TAB],
  );
});

/** The bar's address field. */
function addressField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Address"]');
  assert.ok(field, "the bar's address");
  return field;
}

/** Types `value` into the bar's address as the page would hand it to React. */
function typeAddress(value: string): void {
  const field = addressField();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses Enter in the bar's address, which submits its form. */
async function pressEnter(): Promise<void> {
  await act(async () => addressField().form?.requestSubmit());
  await settle();
}

test("a draft opens nothing until its bar's Enter, then opens the tab in its agent's browser and hands it on; a refusal stays as a failure note over the kept address", async () => {
  mountAnnouncer();
  const asked: TasksBrowserTabOpenParams[] = [];
  let answer: WireBoundaryInput = { failure: BROWSER_TAB_OPEN_FAILURE.NOT_READY };
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      // SAFETY: the test hands back the wire's own answer, a tab or a failure.
      return Promise.resolve(answer as never);
    },
  });
  const handed: AgentBrowserTab[] = [];
  let discarded = 0;
  const owner = { name: "Invite expiry", icon: createElement("span") };
  draw(
    createElement(CloudBrowserDraftPane, {
      taskId: TASK,
      draft: { id: "draft-1", agentId: AGENT_ID },
      owner,
      onOpened: (tab) => handed.push(tab),
      onDiscard: () => {
        discarded += 1;
      },
    }),
  );
  await settle();
  assert.equal(document.activeElement, addressField(), "the bar's address is focused");
  assert.ok(
    document.body.textContent?.includes("Type an address to open it in Invite expiry's browser."),
    "the draft says whose browser it opens in",
  );

  typeAddress("localhost:3000");
  await settle();
  assert.deepEqual(asked, [], "typing opens nothing");

  await pressEnter();
  assert.deepEqual(asked, [{ taskId: TASK, agentId: AGENT_ID, address: "http://localhost:3000/" }]);
  assert.equal(
    document.querySelector(".cloud-browser-standing [role='alert']")?.textContent,
    "Invite expiry hasn't opened its sandbox yet. Try again once it has started working.",
    "a refusal is an alert, said once",
  );
  assert.equal(announcedAsAlert(), "", "the window's own alert does not say it again");
  assert.ok(
    document
      .querySelector(".cloud-browser-standing .luke-failure-note")
      ?.textContent?.includes("hasn't opened its sandbox"),
    "a refusal is said under the bar as a failure note",
  );
  assert.equal(
    addressField().value,
    "localhost:3000",
    "the refused address stays for Enter to retry",
  );
  assert.deepEqual(handed, []);

  const opened: AgentBrowserTab = {
    ...LISTED,
    agentId: AGENT_ID,
    address: "http://localhost:3000/",
    openedBy: { kind: "member", userId: "user-dean" },
  };
  answer = { tab: opened };
  await pressEnter();
  assert.deepEqual(handed, [opened]);
  assert.equal(discarded, 0);
});

test("in a draft, Escape clears the typed address first and discards the draft only on an empty field", async () => {
  fakeActPort({});
  let discarded = 0;
  draw(
    createElement(CloudBrowserDraftPane, {
      taskId: TASK,
      draft: { id: "draft-1", agentId: AGENT_ID },
      owner: { name: "Invite expiry", icon: createElement("span") },
      onOpened: () => undefined,
      onDiscard: () => {
        discarded += 1;
      },
    }),
  );
  await settle();
  const pressEscape = () =>
    act(async () =>
      addressField().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );

  typeAddress("localhost:3000");
  await settle();
  await pressEscape();
  assert.equal(addressField().value, "", "the first Escape clears the words");
  assert.equal(discarded, 0, "the draft stands while there were words to clear");

  await pressEscape();
  assert.equal(discarded, 1, "Escape on an empty field discards the draft");
});

test("a live tab's bar opens a typed address and steps back, forward, and reload over the live view, and says so where another member holds the tab", async () => {
  const sent: { type: string }[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  const say = async (message: object) => {
    await act(async () => listener?.message(JSON.stringify(message)));
    await settle();
  };
  const press = async (label: string) => {
    const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button, `a ${label} step`);
    await act(async () => button.click());
  };
  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: (userId) => (userId === "user-ada" ? "Ada" : undefined),
    }),
  );
  await settle();
  await say({ type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false });

  typeAddress("example.com/pricing");
  await pressEnter();
  await press("Back");
  await press("Forward");
  await press("Reload");

  assert.deepEqual(
    sent.filter((message) => message.type !== BROWSER_LIVE_CLIENT.VIEWPORT),
    [
      { type: BROWSER_LIVE_CLIENT.NAVIGATE, address: "https://example.com/pricing" },
      { type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.BACK },
      { type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.FORWARD },
      { type: BROWSER_LIVE_CLIENT.HISTORY, step: BROWSER_LIVE_HISTORY.RELOAD },
    ],
    "the bar steers the page without a Take over pressed first",
  );

  await say({
    type: BROWSER_LIVE_SERVER.DRIVER,
    driver: { userId: "user-ada", heldUntil: 60_000 },
    yours: false,
  });
  await say({ type: BROWSER_LIVE_SERVER.REFUSED, reason: BROWSER_LIVE_REFUSAL.HELD });
  assert.ok(
    document.body.textContent?.includes("Ada is driving this tab. Wait until they hand it back."),
  );
});

test("a bar's steps say why they are off while the tab is not live, reachable by the keyboard, and are named plainly once it is", async () => {
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: () => undefined, close: () => undefined };
    },
  });
  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  const back = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Back"]') ?? assert.fail("Back");
  const hint = () => document.querySelector('[role="tooltip"]')?.textContent;

  assert.equal(back().disabled, false, "an unavailable step stays in the tab order");
  assert.equal(back().getAttribute("aria-disabled"), "true");
  restOn(back());
  assert.equal(hint(), "Back: the browser is not live yet");

  await act(async () =>
    listener?.message(
      JSON.stringify({ type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false }),
    ),
  );
  await settle();
  assert.equal(back().getAttribute("aria-disabled"), null);
  act(() => back().dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  restOn(back());
  assert.equal(hint(), "Back");

  // A view the relay closed as idle needs Watch again, which is not a wait.
  act(() => back().dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  await act(async () => listener?.closed(BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.IDLE]));
  await settle();
  restOn(back());
  assert.equal(hint(), "Back: watch again to use it");
});

test("plain words typed in a cloud tab's bar search the web, in a draft and on a live tab alike", async () => {
  const asked: TasksBrowserTabOpenParams[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      return Promise.resolve({ failure: BROWSER_TAB_OPEN_FAILURE.UNANSWERED });
    },
  });
  const sent: { type: string }[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  const search = "https://www.google.com/search?q=acme%20pricing";

  const draft = draw(
    createElement(CloudBrowserDraftPane, {
      taskId: TASK,
      draft: { id: "draft-1", agentId: AGENT_ID },
      owner: { name: "Invite emails", icon: createElement("span") },
      onOpened: () => undefined,
      onDiscard: () => undefined,
    }),
  );
  await settle();
  assert.ok(
    document.body.textContent?.includes("Invite emails' browser"),
    "a name ending in an s takes the apostrophe alone",
  );
  typeAddress("acme pricing");
  await pressEnter();
  assert.deepEqual(asked, [{ taskId: TASK, agentId: AGENT_ID, address: search }]);

  draft.rerender(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: LUKE_OWNER,
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  await act(async () =>
    listener?.message(
      JSON.stringify({ type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false }),
    ),
  );
  await settle();
  typeAddress("acme pricing");
  await pressEnter();
  assert.deepEqual(
    sent.filter((message) => message.type === BROWSER_LIVE_CLIENT.NAVIGATE),
    [{ type: BROWSER_LIVE_CLIENT.NAVIGATE, address: search }],
  );
});

test("on a phone a Browser tab's bar keeps its address alone, the task's header's ⋯ offering its Back, Forward, and Reload, dimmed where the page cannot step", async () => {
  fakeActPort({});
  const { element, handed } = onPhone(
    createElement(CloudBrowserDraftPane, {
      taskId: TASK,
      draft: { id: "draft-1", agentId: AGENT_ID },
      owner: { name: "Invite expiry", icon: createElement("span") },
      onOpened: () => undefined,
      onDiscard: () => undefined,
    }),
  );
  draw(element);
  await settle();

  assert.ok(addressField(), "the address stands as the page's own field");
  assert.deepEqual(
    [...document.querySelectorAll(".cloud-browser-bar button")]
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => label === "Back" || label === "Forward" || label === "Reload"),
    [],
  );
  assert.deepEqual(handed.labels(), ["Back", "Forward", "Reload"]);
  assert.deepEqual(handed.item("Reload"), { disabled: true, detail: "no page is open yet" });
});

it.effect(
  "a tab says its agent is using it while the agent acted lately, and stops saying so once the recent span passes with nothing else redrawing the bar",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      fakeAppPlatform({
        openBrowserLive: () => ({ send: () => undefined, close: () => undefined }),
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const registry = AtomRegistry.make({
        initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
      });
      act(() =>
        root.render(
          onRegistry(
            registry,
            createElement(CloudBrowserPane, {
              taskId: TASK,
              tab: { ...LISTED, lastActedAt: 0 },
              owner: { name: "Ada", icon: createElement("span") },
              shown: true,
              memberName: () => undefined,
            }),
          ),
        ),
      );
      const says = () => document.body.textContent?.includes("Ada is using this tab") === true;
      const landed = Effect.promise(settle);

      yield* landed;
      assert.equal(says(), true, "said while the agent just acted");

      yield* TestClock.adjust(Duration.subtract(CLOUD_BROWSER_AGENT_RECENT, Duration.millis(1)));
      yield* landed;
      assert.equal(says(), true, "still said a moment before the span ends");

      yield* TestClock.adjust(Duration.millis(1));
      yield* landed;
      assert.equal(says(), false, "gone once the span passes, unprompted");
    }),
);
