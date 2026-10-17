// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { TRANSCRIPT_REGION, type TranscriptCallRow } from "@luke/voice/transcript-model";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CodePane } from "./code-pane";
import { TaskCall } from "./task-call";
import { RUN_CARD } from "./turn-card";

/**
 * call-card.test.ts -- a call begins and ends the same in the Call tab's
 * thread and the Code tab's feed: the one divider, live while it stands,
 * and once it has ended the one closing line, hanging the call's card.
 */

const MINUTE_MS = 60_000;

/** An hour after the epoch, so every time said is a day long past. */
const ENDED_START = 60 * MINUTE_MS;

/** A teammate's call Luke ended twelve minutes in, its record held; synthetic throughout. */
const ENDED_CALL: TranscriptCallRow = {
  key: "call-ended",
  startedAt: ENDED_START,
  live: false,
  lukeEnded: true,
  record: { endedAt: ENDED_START + 12 * MINUTE_MS },
  messages: [],
  caller: { userId: "user-charles", name: "Charles Pan" },
};

/** A call standing now. */
const LIVE_CALL: TranscriptCallRow = {
  key: "call-live",
  startedAt: ENDED_START + 30 * MINUTE_MS,
  live: true,
  lukeEnded: false,
  messages: [],
};

const CALLS = [ENDED_CALL, LIVE_CALL];

/** A snippet of `src/invoice.ts` shown a minute into the call given. */
function shownOn(call: TranscriptCallRow, callId: string): TaskCodeShowing {
  return {
    callId,
    turnId: `turn-${callId}`,
    shownAt: call.startedAt + MINUTE_MS,
    code: {
      ref: { path: "src/invoice.ts", startLine: 1, endLine: 1 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 1,
      lines: [[{ text: "export const total = 0;" }]],
    },
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The view drawn into the page, for a test to read as a reader would. */
function mounted(view: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(view));
  return container;
}

/** The card a closing line hangs while the pointer rests on it, the newest hung where an earlier one is still on its way out. */
function cardOf(line: HTMLElement): string | undefined {
  act(() => {
    line.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return [
    ...document.querySelectorAll(`.luke-tooltip-card > [data-run-card="${RUN_CARD.CALL}"]`),
  ].at(-1)?.outerHTML;
}

test("the Code tab begins and ends each call as the Call tab does: the same divider, naming a teammate's call, live while it stands, and the same closing line hanging the call's card", () => {
  const callTab = mounted(
    createElement(TaskCall, {
      region: { kind: TRANSCRIPT_REGION.READY, earlierOmitted: false, calls: CALLS },
      onRetry: () => undefined,
      conversation: undefined,
      callLive: true,
      onLoadEarlier: () => Promise.resolve(),
      onOpenSubagent: () => undefined,
      shown: true,
    }),
  );
  const codeTab = mounted(
    createElement(CodePane, {
      shown: [shownOn(ENDED_CALL, "show-1"), shownOn(LIVE_CALL, "show-2")],
      calls: CALLS,
      onOpenFile: () => undefined,
    }),
  );

  const dividers = (tab: HTMLElement) =>
    [...tab.querySelectorAll("[data-checkpoint]")].map((each) => each.outerHTML);
  assert.equal(dividers(callTab).length, 2, "each call begins at a divider");
  assert.deepEqual(dividers(codeTab), dividers(callTab));
  assert.match(
    codeTab.querySelectorAll("[data-checkpoint]")[0]?.textContent ?? "",
    /Charles Pan’s call · /u,
    "a teammate's call is named over its code as over its lines",
  );
  assert.match(
    codeTab.querySelectorAll("[data-checkpoint]")[1]?.textContent ?? "",
    /Live$/u,
    "the standing call's divider says it is live",
  );

  const closing = (tab: HTMLElement) => tab.querySelector<HTMLElement>("[data-call-ended]");
  const callLine = closing(callTab);
  const codeLine = closing(codeTab);
  assert.ok(callLine, "the ended call closes on its line in the Call tab");
  assert.ok(codeLine, "and in the Code tab");
  assert.equal(codeLine.textContent, callLine.textContent);
  assert.match(codeLine.textContent ?? "", /^Luke ended the call · 12m/u);
  assert.equal(
    codeTab.querySelectorAll("[data-call-ended]").length,
    1,
    "the standing call has not closed",
  );
  const card = cardOf(codeLine);
  assert.ok(card, "the Code tab's closing line hangs the call's card");
  assert.equal(card, cardOf(callLine));
});

test("code a turn showed after a call ended stands after that call's closing line, under its own turn's divider, and not inside the call", () => {
  const after: TaskCodeShowing = {
    ...shownOn(ENDED_CALL, "show-after"),
    shownAt: ENDED_START + 15 * MINUTE_MS,
  };
  const codeTab = mounted(
    createElement(CodePane, {
      shown: [shownOn(ENDED_CALL, "show-during"), after],
      calls: [ENDED_CALL],
      onOpenFile: () => undefined,
    }),
  );
  const order = [...codeTab.querySelectorAll("[data-checkpoint], [data-call-ended], .code-card")];
  const at = (selector: string) => {
    const element = codeTab.querySelector(selector);
    return element === null ? -1 : order.indexOf(element);
  };
  const during = at('[data-call-id="show-during"]');
  const closing = at("[data-call-ended]");
  const later = at('[data-call-id="show-after"]');
  assert.ok(during < closing && closing < later, "the call closes before the later code");
  assert.equal(
    order[later - 1]?.matches("[data-checkpoint]"),
    true,
    "the later code has a divider of its own",
  );
});
