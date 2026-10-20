import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { BROWSER_STEP, type BrowserBounds, type BrowserPage } from "@luke/features/browser-acts";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import type { ActSender } from "@luke/host/act-router";
import { BROWSER_ACT_KIND } from "@luke/host/contract";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import type { BrowserViews } from "../window/browser-views";
import { browserProcedures } from "./browser-acts";

/**
 * The Browser tab's acts as main carries them, over views that answer from
 * a script: each act reaches the asking panel's own views; one naming a view
 * that panel never opened, one from a window that is no panel, and one sent
 * while the experiment is off are each refused in their kind's own words;
 * and a close is still carried with the experiment off, so a page never
 * outlives its tab. Each is called on the act port, as the panel calls it.
 * Synthetic ids and addresses throughout.
 */

const ACT_KIND = BROWSER_ACT_KIND;

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const BROWSER_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const ADDRESS = "http://localhost:3000/";
const BOUNDS: BrowserBounds = { x: 640, y: 48, width: 480, height: 720 };

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const windowOf = (standing: Partial<ActSender<WebContents>> = {}): ActSender<WebContents> => ({
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
  ...standing,
});

const pageAt = (address: string): BrowserPage => ({
  browserId: BROWSER_ID,
  address,
  title: "",
  loading: true,
  back: false,
  forward: false,
});

/** Views as the test scripts them: each panel's opened ids, and every call they heard, by panel. */
function fixture(options: { experiment?: boolean } = {}) {
  const opened = new Map<WebContents, Set<string>>();
  const heard: string[] = [];
  let experiment = options.experiment ?? true;
  const has = (sender: WebContents, browserId: string) =>
    opened.get(sender)?.has(browserId) === true;
  const views: BrowserViews = {
    open: (sender, browserId, address) => {
      opened.set(sender, (opened.get(sender) ?? new Set()).add(browserId));
      heard.push(`open:${address}`);
      return pageAt(address);
    },
    navigate: (sender, browserId, address) => {
      heard.push(`navigate:${address}`);
      return has(sender, browserId);
    },
    step: (sender, browserId, step) => {
      heard.push(`step:${step}`);
      return has(sender, browserId);
    },
    place: (sender, browserId, bounds) => {
      heard.push(`place:${bounds === null ? "hidden" : `${bounds.width}x${bounds.height}`}`);
      return has(sender, browserId);
    },
    capture: (sender, browserId) =>
      Promise.resolve(has(sender, browserId) ? "data:image/jpeg;base64,AAAA" : null),
    close: (sender, browserId) => {
      heard.push(`close:${browserId}`);
      opened.get(sender)?.delete(browserId);
    },
  };
  const port = testActPort(browserProcedures({ views, experimentOn: () => experiment }));
  ports.push(port);
  return {
    router: {
      performAct: (
        act: { readonly kind: BrowserActKind; readonly payload?: WireBoundaryInput },
        actor: ActSender<WebContents>,
        options?: { readonly trusted?: boolean },
      ) => port.perform(act, actor, options),
    },
    heard,
    turnOff: () => {
      experiment = false;
    },
  };
}

type BrowserActKind = (typeof BROWSER_ACT_KIND)[keyof typeof BROWSER_ACT_KIND];

/** Each kind's own refusal, as the asking window hears it. */
const REFUSAL = {
  [ACT_KIND.BROWSER_OPEN]: "Could not open that page.",
  [ACT_KIND.BROWSER_NAVIGATE]: "Could not open that page.",
  [ACT_KIND.BROWSER_STEP]: "Could not move the page.",
  [ACT_KIND.BROWSER_PLACE]: "Could not show the page.",
  [ACT_KIND.BROWSER_CAPTURE]: "Could not draw the page.",
  [ACT_KIND.BROWSER_CLOSE]: "Could not close the page.",
} satisfies Record<BrowserActKind, string>;

const refusedAs = (kind: BrowserActKind) => ({ refused: REFUSAL[kind] });

/** An act carried, answered `answer`. */
const done = (answer?: WireBoundaryInput) => ({ answer });

it.effect("a panel opens a page, then moves, places, and catches it, each on its own view", () =>
  Effect.gen(function* () {
    const { router, heard } = fixture();
    const panel = windowOf();
    const payload = { browserId: BROWSER_ID, address: ADDRESS };

    const opened = yield* router.performAct({ kind: ACT_KIND.BROWSER_OPEN, payload }, panel);
    const moved = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_NAVIGATE, payload: { ...payload, address: "https://example.com/" } },
      panel,
    );
    const stepped = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_STEP, payload: { browserId: BROWSER_ID, step: BROWSER_STEP.BACK } },
      panel,
    );
    const placed = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_PLACE, payload: { browserId: BROWSER_ID, bounds: BOUNDS } },
      panel,
    );
    const still = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_CAPTURE, payload: { browserId: BROWSER_ID } },
      panel,
    );

    assert.deepEqual(opened, done(pageAt(ADDRESS)));
    assert.deepEqual([moved, stepped, placed], [done(), done(), done()]);
    assert.deepEqual(still, done("data:image/jpeg;base64,AAAA"));
    assert.deepEqual(heard, [
      `open:${ADDRESS}`,
      "navigate:https://example.com/",
      "step:back",
      "place:480x720",
    ]);
  }),
);

it.effect("a view another panel opened, or none opened, is refused rather than reached", () =>
  Effect.gen(function* () {
    const { router } = fixture();
    const payload = { browserId: BROWSER_ID, address: ADDRESS };
    yield* router.performAct({ kind: ACT_KIND.BROWSER_OPEN, payload }, windowOf());

    const other = windowOf();
    const moved = yield* router.performAct({ kind: ACT_KIND.BROWSER_NAVIGATE, payload }, other);
    const placed = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_PLACE, payload: { browserId: BROWSER_ID, bounds: null } },
      other,
    );
    const still = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_CAPTURE, payload: { browserId: BROWSER_ID } },
      other,
    );

    assert.deepEqual(moved, refusedAs(ACT_KIND.BROWSER_NAVIGATE));
    assert.deepEqual(placed, refusedAs(ACT_KIND.BROWSER_PLACE));
    assert.deepEqual(still, done(null));
  }),
);

it.effect("a window that is no panel, or a panel with the experiment off, reaches no page", () =>
  Effect.gen(function* () {
    const payload = { browserId: BROWSER_ID, address: ADDRESS };
    const voice = fixture();
    const fromVoice = yield* voice.router.performAct(
      { kind: ACT_KIND.BROWSER_OPEN, payload },
      windowOf({ panel: false, voice: true }),
    );
    const off = fixture({ experiment: false });
    const whileOff = yield* off.router.performAct(
      { kind: ACT_KIND.BROWSER_OPEN, payload },
      windowOf(),
    );

    assert.deepEqual(fromVoice, refusedAs(ACT_KIND.BROWSER_OPEN));
    assert.deepEqual(whileOff, refusedAs(ACT_KIND.BROWSER_OPEN));
    assert.deepEqual([...voice.heard, ...off.heard], []);
  }),
);

it.effect("a page opened before the experiment went off is still closed with its tab", () =>
  Effect.gen(function* () {
    const { router, heard, turnOff } = fixture();
    const panel = windowOf();
    const payload = { browserId: BROWSER_ID, address: ADDRESS };
    yield* router.performAct({ kind: ACT_KIND.BROWSER_OPEN, payload }, panel);
    turnOff();

    const closed = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_CLOSE, payload: { browserId: BROWSER_ID } },
      panel,
    );
    const stepped = yield* router.performAct(
      {
        kind: ACT_KIND.BROWSER_STEP,
        payload: { browserId: BROWSER_ID, step: BROWSER_STEP.RELOAD },
      },
      panel,
    );

    assert.deepEqual(closed, done());
    assert.deepEqual(stepped, refusedAs(ACT_KIND.BROWSER_STEP));
    assert.deepEqual(heard, [`open:${ADDRESS}`, `close:${BROWSER_ID}`]);
  }),
);

it.effect("an address of another scheme never reaches a view", () =>
  Effect.gen(function* () {
    const { router, heard } = fixture();
    const opened = yield* router.performAct(
      // A forged payload, as a window that skipped its own parse would send it.
      {
        kind: ACT_KIND.BROWSER_OPEN,
        payload: { browserId: BROWSER_ID, address: "file:///etc/passwd" },
      },
      windowOf(),
    );

    assert.deepEqual(opened, refusedAs(ACT_KIND.BROWSER_OPEN));
    assert.deepEqual(heard, []);
  }),
);

it.effect("a sender this build does not trust reaches no page, in each kind's own words", () =>
  Effect.gen(function* () {
    const { router, heard } = fixture();
    const untrusted = { trusted: false };
    const opened = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_OPEN, payload: { browserId: BROWSER_ID, address: ADDRESS } },
      windowOf(),
      untrusted,
    );
    const closed = yield* router.performAct(
      { kind: ACT_KIND.BROWSER_CLOSE, payload: { browserId: BROWSER_ID } },
      windowOf(),
      untrusted,
    );

    assert.deepEqual(opened, refusedAs(ACT_KIND.BROWSER_OPEN));
    assert.deepEqual(closed, refusedAs(ACT_KIND.BROWSER_CLOSE));
    assert.deepEqual(heard, []);
  }),
);

it.effect("a key the payload does not name is refused rather than dropped", () =>
  Effect.gen(function* () {
    const { router, heard } = fixture();
    const opened = yield* router.performAct(
      {
        kind: ACT_KIND.BROWSER_OPEN,
        payload: { browserId: BROWSER_ID, address: ADDRESS, frame: "top" },
      },
      windowOf(),
    );
    const placed = yield* router.performAct(
      {
        kind: ACT_KIND.BROWSER_PLACE,
        payload: { browserId: BROWSER_ID, bounds: { ...BOUNDS, depth: 1 } },
      },
      windowOf(),
    );

    assert.deepEqual(opened, refusedAs(ACT_KIND.BROWSER_OPEN));
    assert.deepEqual(placed, refusedAs(ACT_KIND.BROWSER_PLACE));
    assert.deepEqual(heard, []);
  }),
);
