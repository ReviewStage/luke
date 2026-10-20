// @vitest-environment jsdom

import assert from "node:assert/strict";
import { getClient } from "@sentry/electron/renderer";
import { test } from "vitest";
import { startDesktopSentry } from "./desktop-sentry";

/**
 * A window loads Sentry's SDK only once it has drawn, so a window whose
 * state could not be read reports before the SDK stands; the report waits
 * for it. This runs the SDK itself and reads what it hands main over the
 * window's IPC, the one boundary a renderer's events cross.
 */

/** How often the window's SDK told main it started, and the envelopes it handed main. */
let started = 0;
const envelopes: string[] = [];

/** The IPC a preload exposes for Sentry, as `@sentry/electron/preload` names it, answered here in main's place. */
const SENTRY_IPC = {
  "sentry-ipc": {
    sendRendererStart: () => {
      started += 1;
    },
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

test("a blank window reported before the SDK loads is handed to main once it has, and nothing loads until the window asks", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  const sentry = startDesktopSentry();

  sentry.reportBlankWindow(new Error("the window's state could not be read"));
  // A window that has not asked for the SDK has said nothing to main.
  await Promise.resolve();
  assert.equal(started, 0);

  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  assert.equal(started, 1);
  assert.deepEqual(sentExceptions(), [
    {
      value: "the window's state could not be read",
      mechanism: "auto.electron.renderer.first_read",
    },
  ]);
});
