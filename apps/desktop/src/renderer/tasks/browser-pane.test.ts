// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BROWSER_STEP, type BrowserKey, type BrowserPage } from "@luke/features/browser-acts";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { BrowserPane } from "./browser-pane";
import type { OpenBrowser } from "./use-side-panel";

/**
 * A Browser tab as the developer meets it: a bar that opens what they type,
 * a dev server on the Mac over plain http, its steps following how main says
 * the page stands, the window's own chords answering over the page, a page
 * that failed saying why, and the view laid over the tab's body only while
 * nothing covers it, a still drawn in its place otherwise. Main is the
 * window's act and event doors, answering from a script; the frame clock is
 * driven a frame at a time. Synthetic ids and addresses throughout.
 */

/** A Browser tab's id, fresh for each tab, since how a page stands is kept by tab while the window stands. */
const OTHER_TAB = "3a5c7e9b-1d2f-4a6b-8c0d-2e4f6a8b0c1d";
const STILL = "data:image/jpeg;base64,AAAA";

/** The body's box, as the panel lays it out beside the document. */
const BODY = { x: 640, y: 80, width: 480, height: 700 };

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "elementFromPoint");
});

const pageAt = (
  browserId: string,
  address: string,
  standing: Partial<BrowserPage> = {},
): BrowserPage => ({
  browserId,
  address,
  title: "",
  loading: false,
  back: false,
  forward: false,
  ...standing,
});

/** Main as the window's doors reach it: every act it was sent, what it answers, and its two events; a capture held until `release` while `holdCapture`. */
function main(options: { holdCapture?: boolean } = {}) {
  const held: (() => void)[] = [];
  const sent: Act[] = [];
  let tellPage: ((page: BrowserPage) => void) | undefined;
  let tellKey: ((key: BrowserKey) => void) | undefined;
  const answer = (request: Act): ActOutcome => {
    if (request.kind === ACT_KIND.BROWSER_OPEN) {
      const { browserId, address } = request.payload;
      return { status: ACT_OUTCOME_STATUS.DONE, value: pageAt(browserId, address) };
    }
    if (request.kind === ACT_KIND.BROWSER_CAPTURE) {
      return { status: ACT_OUTCOME_STATUS.DONE, value: STILL };
    }
    return { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
  };
  fakeAppBridge({
    act: (request: Act) => {
      sent.push(request);
      if (options.holdCapture !== true || request.kind !== ACT_KIND.BROWSER_CAPTURE) {
        return Promise.resolve(answer(request));
      }
      return new Promise<ActOutcome>((resolve) => held.push(() => resolve(answer(request))));
    },
    onBrowserState: (listener: (page: BrowserPage) => void) => {
      tellPage = listener;
      return () => undefined;
    },
    onBrowserKey: (listener: (key: BrowserKey) => void) => {
      tellKey = listener;
      return () => undefined;
    },
    onBrowserFocus: () => () => undefined,
  });
  return {
    sent,
    kinds: () => sent.map((request) => request.kind),
    says: (page: BrowserPage) => act(() => tellPage?.(page)),
    hands: (key: BrowserKey) => act(() => tellKey?.(key)),
    release: () =>
      act(async () => {
        for (const resolve of held.splice(0)) resolve();
      }),
  };
}

/** The frame clock, run a frame at a time. */
function frames() {
  let queued: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.push(callback);
    return queued.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  return {
    run: async (count: number) => {
      for (let at = 0; at < count; at += 1) {
        const due = queued;
        queued = [];
        await act(async () => {
          for (const callback of due) callback(at * 16);
        });
      }
    },
  };
}

/** The window's hit test: the element drawn topmost at a point, the body's own unless a layer is laid over it there. */
function hitTest(body: () => Element) {
  const layers: { element: Element; box: typeof BODY }[] = [];
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) => {
      const over = layers.find(
        ({ box }) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height,
      );
      return over?.element ?? body();
    },
  });
  return {
    lay: (element: Element, box: typeof BODY) => void layers.push({ element, box }),
    lift: () => void layers.splice(0),
  };
}

/** A box laid out where `box` says, as the element's own reading of it. */
function laidOut(element: Element, box: typeof BODY): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: box.x, y: box.y, width: box.width, height: box.height }),
  );
}

/** Mounts the tab as it stands open, answering what it draws and what it said of its page. */
function mount(address: string | undefined, browserId: string = crypto.randomUUID()) {
  const opened: string[] = [];
  const open: OpenBrowser = { tab: { browser: browserId }, task: "task", address };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(BrowserPane, {
        open,
        shown: true,
        onOpened: (at: string) => void opened.push(at),
      }),
    ),
  );
  const field = () => {
    const found = container.querySelector<HTMLInputElement>('input[aria-label="Address"]');
    assert.ok(found);
    return found;
  };
  const go = async (typed: string) => {
    const input = field();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, typed);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form?.requestSubmit());
  };
  // A button is named by its label, or by its words where it has none, as Retry is.
  const press = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === label,
    );
    assert.ok(button);
    await act(async () => button.click());
  };
  const body = () => {
    const found = container.querySelector(".browser-view-body");
    assert.ok(found);
    return found;
  };
  const unmount = () => {
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
  };
  return { browserId, container, opened, field, go, press, body, unmount };
}

test("a blank tab asks for an address, and opens a dev server on the Mac over plain http", async () => {
  const doors = main();
  const tab = mount(undefined);
  assert.match(tab.container.textContent ?? "", /Type an address above/u);
  assert.ok(tab.container.querySelector(".browser-view.ph-no-capture"), "out of the recording");

  await tab.go("localhost:3000");

  assert.deepEqual(doors.sent[0], {
    kind: ACT_KIND.BROWSER_OPEN,
    payload: { browserId: tab.browserId, address: "http://localhost:3000/" },
  });
  assert.deepEqual(tab.opened, ["http://localhost:3000/"]);
  assert.equal(tab.field().value, "http://localhost:3000/");
});

test("the bar's steps follow how main says the page stands, and a typed line moves the open page", async () => {
  const doors = main();
  const tab = mount("https://example.com/");
  await act(async () => undefined);
  doors.says(pageAt(tab.browserId, "https://example.com/next", { back: true, loading: true }));

  const back = tab.container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
  assert.equal(back?.disabled, false);
  assert.equal(tab.field().value, "https://example.com/next");
  await tab.press("Back");
  await tab.press("Stop");
  await tab.go("vercel.com/docs");

  assert.deepEqual(doors.sent.slice(1), [
    { kind: ACT_KIND.BROWSER_STEP, payload: { browserId: tab.browserId, step: BROWSER_STEP.BACK } },
    { kind: ACT_KIND.BROWSER_STEP, payload: { browserId: tab.browserId, step: BROWSER_STEP.STOP } },
    {
      kind: ACT_KIND.BROWSER_NAVIGATE,
      payload: { browserId: tab.browserId, address: "https://vercel.com/docs" },
    },
  ]);
});

test("a chord pressed over the page answers on the window, and ⌘L takes the address", async () => {
  const doors = main();
  const tab = mount("https://example.com/");
  await act(async () => undefined);
  const heard: string[] = [];
  window.addEventListener("keydown", (event) => {
    heard.push(`${event.metaKey ? "⌘" : ""}${event.shiftKey ? "⇧" : ""}${event.key}`);
  });

  doors.hands({
    browserId: tab.browserId,
    key: "k",
    code: "KeyK",
    shift: false,
    alt: false,
    control: false,
  });
  doors.hands({
    browserId: OTHER_TAB,
    key: "w",
    code: "KeyW",
    shift: false,
    alt: false,
    control: false,
  });
  doors.hands({
    browserId: tab.browserId,
    key: "l",
    code: "KeyL",
    shift: false,
    alt: false,
    control: false,
  });

  assert.deepEqual(heard, ["⌘k", "⌘l"]);
  assert.equal(document.activeElement, tab.field());
});

test("a page that failed to load says why, and its retry reloads it", async () => {
  const doors = main();
  const tab = mount("http://localhost:4000/");
  await act(async () => undefined);
  doors.says(
    pageAt(tab.browserId, "http://localhost:4000/", { failure: "ERR_CONNECTION_REFUSED" }),
  );

  assert.match(tab.container.textContent ?? "", /could not be shown: ERR_CONNECTION_REFUSED/u);
  await tab.press("Retry");
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_STEP,
    payload: { browserId: tab.browserId, step: BROWSER_STEP.RELOAD },
  });
});

test("the page is laid over the body once it settles, and gives way to a still while a menu covers it", async () => {
  const doors = main();
  const clock = frames();
  const tab = mount("https://example.com/");
  await act(async () => undefined);
  laidOut(tab.body(), BODY);
  hitTest(tab.body);

  await clock.run(3);
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: BODY },
  });

  // A menu drawn over the window, over the body.
  const menu = document.createElement("div");
  document.body.append(menu);
  laidOut(menu, { x: 900, y: 100, width: 200, height: 160 });
  await clock.run(3);

  assert.deepEqual(doors.kinds().slice(-2), [ACT_KIND.BROWSER_CAPTURE, ACT_KIND.BROWSER_PLACE]);
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: null },
  });
  const still = tab.container.querySelector<HTMLImageElement>("img.browser-view-still");
  assert.equal(still?.getAttribute("src"), STILL);
  // Drawn at the size the page stood at, never at the image's own, which is in the screen's pixels.
  assert.deepEqual([still?.style.width, still?.style.height], ["480px", "700px"]);

  // The menu gone, the page is laid over the body again.
  menu.remove();
  await clock.run(3);
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: BODY },
  });
});

test("a menu drawn from inside the window's root over the body gives way to a still too", async () => {
  const doors = main();
  const clock = frames();
  const tab = mount("https://example.com/");
  await act(async () => undefined);
  laidOut(tab.body(), BODY);
  const hits = hitTest(tab.body);
  await clock.run(3);

  // The strip's "+" menu, drawn in the root over the body's top right.
  const menu = document.createElement("div");
  tab.container.append(menu);
  hits.lay(menu, { x: 1000, y: 80, width: 120, height: 220 });
  await clock.run(3);
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: null },
  });

  hits.lift();
  await clock.run(3);
  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: BODY },
  });
});

test("a thin menu crossing the body's edge between the hit test's points gives way to a still too", async () => {
  const doors = main();
  const clock = frames();
  const tab = mount("https://example.com/");
  await act(async () => undefined);
  laidOut(tab.body(), BODY);
  hitTest(tab.body);
  await clock.run(3);

  // A menu 25 pixels tall, standing over the body's top 20 pixels, where no point is tested.
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  tab.container.append(menu);
  laidOut(menu, { x: 700, y: 60, width: 200, height: 25 });
  await clock.run(3);

  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: tab.browserId, bounds: null },
  });
});

test("a still caught as the tab was left never hides the page once the tab is drawn again", async () => {
  const doors = main({ holdCapture: true });
  const clock = frames();
  const first = mount("https://example.com/");
  await act(async () => undefined);
  laidOut(first.body(), BODY);
  hitTest(first.body);
  await clock.run(3);
  const menu = document.createElement("div");
  document.body.append(menu);
  laidOut(menu, { x: 900, y: 100, width: 200, height: 160 });
  await clock.run(1);
  assert.equal(doors.kinds().at(-1), ACT_KIND.BROWSER_CAPTURE, "a still is being caught");

  // The tab left while its still is caught, and drawn again, the menu gone.
  first.unmount();
  menu.remove();
  const again = mount("https://example.com/", first.browserId);
  await act(async () => undefined);
  laidOut(again.body(), BODY);
  hitTest(again.body);
  await clock.run(3);
  await doors.release();
  await clock.run(3);

  assert.deepEqual(doors.sent.at(-1), {
    kind: ACT_KIND.BROWSER_PLACE,
    payload: { browserId: first.browserId, bounds: BODY },
  });
});
