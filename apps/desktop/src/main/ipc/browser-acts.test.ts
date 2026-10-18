import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { BROWSER_STEP, type BrowserBounds, type BrowserPage } from "@luke/features/browser-acts";
import { type ActRows, type ActSender, createActRouter } from "@luke/host/act-router";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import type { BrowserViews } from "../window/browser-views";
import { browserActRows } from "./browser-acts";

/**
 * The Browser tab's acts as main carries them, over views that answer from
 * a script: each act reaches the asking panel's own views; one naming a view
 * that panel never opened, one from a window that is no panel, and one sent
 * while the experiment is off are each refused in their kind's own words;
 * and a close is still carried with the experiment off, so a page never
 * outlives its tab. Synthetic ids and addresses throughout.
 */

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
  const rows = browserActRows({ views, experimentOn: () => experiment });
  // SAFETY: the router dispatches only the browser kinds these tests send.
  const router = createActRouter(rows as ActRows<WebContents>);
  return {
    router,
    heard,
    turnOff: () => {
      experiment = false;
    },
  };
}

/** The kind's own refusal, as the asking window hears it. */
const refusedAs = (kind: keyof typeof ACT) => ({
  status: ACT_OUTCOME_STATUS.REFUSED,
  reason: ACT[kind].refusal,
});

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

    assert.deepEqual(opened, { status: ACT_OUTCOME_STATUS.DONE, value: pageAt(ADDRESS) });
    assert.equal(moved.status, ACT_OUTCOME_STATUS.DONE);
    assert.equal(stepped.status, ACT_OUTCOME_STATUS.DONE);
    assert.equal(placed.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(still, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: "data:image/jpeg;base64,AAAA",
    });
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
    assert.deepEqual(still, { status: ACT_OUTCOME_STATUS.DONE, value: null });
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

    assert.equal(closed.status, ACT_OUTCOME_STATUS.DONE);
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
