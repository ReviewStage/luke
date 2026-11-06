// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PANEL_SPAN, PANEL_SPAN_ATTRIBUTE } from "@repo/panel/panel-spans";
import { getClient } from "@sentry/electron/renderer";
import { act, createElement } from "react";
import { afterEach, test, vi } from "vitest";
import { BLANK_WINDOW, startDesktopSentry } from "./desktop-sentry";
import { createReportingRoot } from "./desktop-sentry-root";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const idleCallbacks: (() => void)[] = [];
vi.stubGlobal("requestIdleCallback", (callback: () => void) => idleCallbacks.push(callback));
vi.stubGlobal("cancelIdleCallback", () => undefined);

const envelopes: string[] = [];

const SENTRY_IPC = {
  "sentry-ipc": {
    sendRendererStart: () => undefined,
    sendScope: () => undefined,
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
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SENTRY__RENDERER_INIT__");
});

interface SentSpan {
  readonly name?: string;
  readonly start_timestamp?: number;
  readonly end_timestamp?: number;
  readonly attributes?: Record<string, { readonly value?: unknown } | undefined>;
}

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
  vi.spyOn(console, "error").mockImplementation(() => undefined);

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
  vi.spyOn(Math, "random").mockReturnValue(0);
  const sentry = startDesktopSentry();
  const startedAt = Date.now() - 1_500;

  sentry.recordSpan({
    name: PANEL_SPAN.TRANSCRIPT_FIRST_PAINT,
    startedAt,
    endedAt: startedAt + 1_200,
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: 42,
      [PANEL_SPAN_ATTRIBUTE.HELD_BYTES]: 81_920,
    }),
  });
  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  const span = sentItems()
    .flatMap((item) => (Array.isArray(item.items) ? item.items : []))
    .find((each) => each.name === PANEL_SPAN.TRANSCRIPT_FIRST_PAINT);
  assert.equal(span?.start_timestamp, startedAt / 1_000);
  assert.equal(span?.end_timestamp, (startedAt + 1_200) / 1_000);
  assert.deepEqual(
    [
      span?.attributes?.[PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]?.value,
      span?.attributes?.[PANEL_SPAN_ATTRIBUTE.HELD_BYTES]?.value,
    ],
    [42, 81_920],
  );
});

test("a span the sample leaves out is never measured", async () => {
  Object.assign(window, { __SENTRY_IPC__: SENTRY_IPC });
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  const sentry = startDesktopSentry();
  let measured = false;

  sentry.recordSpan({
    name: PANEL_SPAN.TASK_OPEN,
    startedAt: Date.now() - 800,
    endedAt: Date.now(),
    attributes: () => {
      measured = true;
      return { [PANEL_SPAN_ATTRIBUTE.DESCRIPTION_CHARS]: 4_000 };
    },
  });
  sentry.load();
  await sentry.settled;
  await getClient()?.flush(1_000);

  assert.equal(measured, false);
  assert.doesNotMatch(JSON.stringify(sentItems()), /task\.open/);
});
