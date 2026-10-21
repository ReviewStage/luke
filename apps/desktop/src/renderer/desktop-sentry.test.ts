// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PANEL_SPAN, PANEL_SPAN_ATTRIBUTE } from "@luke/panel/panel-spans";
import { getClient } from "@sentry/electron/renderer";
import { act, createElement } from "react";
import { afterEach, test, vi } from "vitest";
import { BLANK_WINDOW, startDesktopSentry } from "./desktop-sentry";
import { createReportingRoot } from "./desktop-sentry-root";

/**
 * A window loads Sentry's SDK only once it has drawn, so a window whose
 * state could not be read, or whose surface failed to render, reports
 * before the SDK stands; the report waits for it. This runs the SDK itself
 * and reads what it hands main over the window's IPC, the one boundary a
 * renderer's events cross, and runs the browser's idle callbacks by hand.
 */

// React's own test mode, so `act` waits for each commit and its effects.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** The idle callbacks the window armed, run by hand in the browser's place. */
const idleCallbacks: (() => void)[] = [];
vi.stubGlobal("requestIdleCallback", (callback: () => void) => idleCallbacks.push(callback));
vi.stubGlobal("cancelIdleCallback", () => undefined);

/** The envelopes the window handed main. */
const envelopes: string[] = [];

/** The status messages the window handed main's freeze watchdog, by their threshold. */
const watchdogThresholds: number[] = [];

/** Every window's SDK, and the panel's, which also has its page watched for freezes. */
const EVERY_WINDOW = { reportsFreezes: false } as const;
const PANEL_WINDOW = { reportsFreezes: true } as const;

/** The IPC a preload exposes for Sentry, as `@sentry/electron/preload` names it, answered here in main's place. */
const SENTRY_IPC = {
  "sentry-ipc": {
    sendRendererStart: () => undefined,
    sendScope: () => undefined,
    // Note that an envelope with no attachment is handed over as its text.
    sendEnvelope: (body: string) => {
      envelopes.push(body);
    },
    sendFeedback: async () => ({ statusCode: 200 }),
    sendStatus: (status: { config: { anrThreshold: number } }) => {
      watchdogThresholds.push(status.config.anrThreshold);
    },
    sendStructuredLog: () => undefined,
    sendMetric: () => undefined,
  },
};

afterEach(() => {
  envelopes.length = 0;
  watchdogThresholds.length = 0;
  idleCallbacks.length = 0;
  vi.restoreAllMocks();
  // Each test's window starts its SDK anew, as each window does once.
  Reflect.deleteProperty(window, "__SENTRY__RENDERER_INIT__");
});

/** A span as an envelope carries it to main, as far as these tests read it. */
interface SentSpan {
  readonly name?: string;
  readonly start_timestamp?: number;
  readonly end_timestamp?: number;
  readonly attributes?: Record<string, { readonly value?: unknown } | undefined>;
}

/** Every item of every envelope the window handed main, as JSON. */
function sentItems(): { readonly items?: readonly SentSpan[]; readonly [key: string]: unknown }[] {
  return envelopes.flatMap((body) =>
    body.split("\n").flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }),
  );
}

/** Each exception's message and mechanism in the envelopes the window handed main. */
function sentExceptions(): { value: string | undefined; mechanism: string | undefined }[] {
  return envelopes.flatMap((body) =>
    body
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
      .flatMap((item) => item?.exception?.values ?? [])
      .map((exception: { value?: string; mechanism?: { type?: string } }) => ({
        value: exception.value,
        mechanism: exception.mechanism?.type,
      })),
  );
}

test("a blank window reported before the SDK loads is handed to main once it has", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry(EVERY_WINDOW);

  sentry.reportBlankWindow(
    new Error("the window's state could not be read"),
    BLANK_WINDOW.FIRST_READ,
  );
  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  assert.deepEqual(sentExceptions(), [
    {
      value: "the window's state could not be read",
      mechanism: "auto.electron.renderer.first_read",
    },
  ]);
});

test("a window whose surface has committed loads the SDK in its next idle moment, and what was reported before is sent", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry(EVERY_WINDOW);
  const draw = createReportingRoot(document.createElement("div"), sentry);

  sentry.reportBlankWindow(new Error("said while the window drew"), BLANK_WINDOW.FIRST_READ);
  await act(async () => draw(createElement("p", null, "drawn")));
  for (const idle of idleCallbacks.splice(0)) idle();
  await sentry.settled;
  await getClient()?.flush(1_000);

  assert.deepEqual(
    sentExceptions().map((sent) => sent.value),
    ["said while the window drew"],
  );
});

test("a surface that fails its first render is handed to main as a blank window, with no commit to wait for", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry(EVERY_WINDOW);
  const draw = createReportingRoot(document.createElement("div"), sentry);
  const Broken = () => {
    throw new Error("the surface fell over");
  };
  // Note that React logs what the root's handler is handed; the test reads what reached main.
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  // Note that this renders outside `act`, which would keep the error from the
  // root's handler to throw it itself, and waits on the scheduler as a window does.
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  draw(createElement(Broken));
  await sentry.settled;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await getClient()?.flush(1_000);
  vi.restoreAllMocks();

  assert.deepEqual(sentExceptions(), [
    { value: "the surface fell over", mechanism: "auto.electron.renderer.render" },
  ]);
});

test("a span the panel timed before the SDK loads is sent once it has, with what it measured", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  // Note that the trace sample rate keeps a tenth of spans; this one is kept.
  vi.spyOn(Math, "random").mockReturnValue(0);
  const sentry = startDesktopSentry(EVERY_WINDOW);
  const startedAt = Date.now() - 1_500;

  sentry.recordSpan({
    name: PANEL_SPAN.TRANSCRIPT_FIRST_PAINT,
    startedAt,
    endedAt: startedAt + 1_200,
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: 42,
      [PANEL_SPAN_ATTRIBUTE.PAGE_BYTES]: 81_920,
    }),
  });
  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  const span = sentItems()
    .flatMap((item) => (Array.isArray(item.items) ? item.items : []))
    .find((each) => each.name === PANEL_SPAN.TRANSCRIPT_FIRST_PAINT);
  // Sentry reads span times in seconds: the span starts when the panel said, and lasts 1.2 s.
  assert.equal(span?.start_timestamp, startedAt / 1_000);
  assert.equal(span?.end_timestamp, (startedAt + 1_200) / 1_000);
  assert.deepEqual(
    [
      span?.attributes?.[PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]?.value,
      span?.attributes?.[PANEL_SPAN_ATTRIBUTE.PAGE_BYTES]?.value,
    ],
    [42, 81_920],
  );
});

test("a span the sample leaves out is never measured", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  const sentry = startDesktopSentry(EVERY_WINDOW);
  let measured = false;

  sentry.recordSpan({
    name: PANEL_SPAN.TASK_OPEN,
    startedAt: Date.now() - 800,
    endedAt: Date.now(),
    attributes: () => {
      measured = true;
      return { [PANEL_SPAN_ATTRIBUTE.PLAN_CHARS]: 4_000 };
    },
  });
  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  assert.equal(measured, false);
  assert.doesNotMatch(JSON.stringify(sentItems()), /task\.open/);
});

test("a window other than the panel has its page watched for no freeze", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry(EVERY_WINDOW);
  sentry.load();
  await sentry.settled;

  assert.deepEqual(watchdogThresholds, []);
});

// Note that this runs last, because the watchdog's heartbeat the SDK arms
// outlives the test.
test("the panel's page is watched for freezes past a second", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry(PANEL_WINDOW);
  sentry.load();
  await sentry.settled;

  assert.deepEqual(watchdogThresholds, [1_000]);
});
