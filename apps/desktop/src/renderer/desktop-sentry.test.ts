// @vitest-environment jsdom

import assert from "node:assert/strict";
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
    sendStatus: () => undefined,
    sendStructuredLog: () => undefined,
    sendMetric: () => undefined,
  },
};

afterEach(() => {
  envelopes.length = 0;
  idleCallbacks.length = 0;
});

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
  const sentry = startDesktopSentry();

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
  const sentry = startDesktopSentry();
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
  const sentry = startDesktopSentry();
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
