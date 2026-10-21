// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import type { TranscriptCallRow } from "@luke/voice/transcript-model";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CodePane } from "./code-pane.js";
import { RUN_CARD } from "./turn-card.js";

/**
 * call-card.test.ts -- a call begins and ends in the Code tab's feed as in
 * its agent's transcript: the one divider, live while it stands, and once it
 * has ended the one closing line, hanging the call's card.
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
      lines: ["export const total = 0;"],
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

test("the Code tab begins and ends each call: a divider naming a teammate's call, live while it stands, and a closing line hanging the call's card", () => {
  const codeTab = mounted(
    createElement(CodePane, {
      shown: [shownOn(ENDED_CALL, "show-1"), shownOn(LIVE_CALL, "show-2")],
      calls: CALLS,
      onOpenFile: () => undefined,
    }),
  );

  const dividers = [...codeTab.querySelectorAll("[data-checkpoint]")];
  assert.equal(dividers.length, 2, "each call begins at a divider");
  assert.match(
    dividers[0]?.textContent ?? "",
    /Charles Pan’s call · /u,
    "a teammate's call is named over its code",
  );
  assert.match(
    dividers[1]?.textContent ?? "",
    /Live$/u,
    "the standing call's divider says it is live",
  );

  const codeLine = codeTab.querySelector<HTMLElement>("[data-call-ended]");
  assert.ok(codeLine, "the ended call closes on its line");
  assert.match(codeLine.textContent ?? "", /^Luke ended the call · 12m/u);
  assert.equal(
    codeTab.querySelectorAll("[data-call-ended]").length,
    1,
    "the standing call has not closed",
  );
  assert.ok(cardOf(codeLine), "the closing line hangs the call's card");
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

test("code an agent showed on a turn of its own stands under that turn's divider, which names the agent, each turn its own, and a turn of an agent not listed is headed by its time alone", () => {
  const typed: TaskCodeShowing = {
    ...shownOn(ENDED_CALL, "show-typed"),
    shownAt: ENDED_START + 15 * MINUTE_MS,
    agentId: "agent-invites",
  };
  const later: TaskCodeShowing = {
    ...shownOn(ENDED_CALL, "show-later"),
    shownAt: ENDED_START + 20 * MINUTE_MS,
    agentId: "agent-gone",
  };
  const codeTab = mounted(
    createElement(CodePane, {
      shown: [typed, later],
      calls: [],
      agentLabel: (agentId: string) => (agentId === "agent-invites" ? "Invite flow" : undefined),
      onOpenFile: () => undefined,
    }),
  );
  const order = [...codeTab.querySelectorAll("[data-checkpoint], .code-card")];
  const words = order.map((element) =>
    element.matches("[data-checkpoint]")
      ? (element.textContent ?? "")
      : element.getAttribute("data-call-id"),
  );
  assert.equal(words.length, 4);
  assert.match(words[0] ?? "", /^Invite flow · /u);
  assert.equal(words[1], "show-typed");
  assert.doesNotMatch(words[2] ?? "", /Invite flow/u);
  assert.equal(words[3], "show-later");
});
