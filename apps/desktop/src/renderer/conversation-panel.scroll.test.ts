// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_OUTPUT_STATUS } from "@sidecar/actions";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationViewInput,
  type ConversationViewSnapshot,
  selectConversationView,
  TOOL_PART_STATE,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ConversationPanel } from "./conversation-panel";
import {
  FIXTURE_INPUT,
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_SESSION,
  FIXTURE_TITLE,
  FIXTURE_TURN,
} from "./conversation-turns.fixtures";

type PanelProps = Parameters<typeof ConversationPanel>[0];

interface MutableScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function runningInput(replyParts?: StoredUIMessage["parts"]): ConversationViewInput {
  return {
    ...FIXTURE_INPUT,
    main: FIXTURE_INPUT.main
      .filter((row) => row.turnId === FIXTURE_TURN.RUNNING)
      .map((row) =>
        row.seq !== 8 || replyParts === undefined
          ? row
          : { ...row, message: { ...row.message, parts: replyParts } },
      ),
    observed: [],
    turns: FIXTURE_INPUT.turns.filter((turn) => turn.id === FIXTURE_TURN.RUNNING),
    events: [],
  };
}

function runningView(replyParts?: StoredUIMessage["parts"]): ConversationViewSnapshot {
  return { groups: selectConversationView(runningInput(replyParts)), settled: true };
}

const RUNNING_REPLY = FIXTURE_INPUT.main.find(
  (row) => row.turnId === FIXTURE_TURN.RUNNING && row.seq === 8,
)?.message;

if (RUNNING_REPLY === undefined) throw new Error("Missing running reply fixture.");

const EXTRA_REASONING = {
  type: "reasoning",
  text: "One more check: keep the newest tail rows visible while the turn grows.",
  state: "done",
} as const satisfies StoredUIMessage["parts"][number];

const EXTRA_TOOL = {
  type: "tool-send_session_message",
  toolCallId: "call_fixture_extra",
  state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
  input: {
    provider_id: FIXTURE_ROSTER[0]?.providerId ?? "conductor",
    provider_session_id: FIXTURE_SESSION.CREATED,
    text: "Keep going.",
  },
  output: {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: {
      providerId: FIXTURE_ROSTER[0]?.providerId ?? "conductor",
      providerSessionId: FIXTURE_SESSION.CREATED,
      title: FIXTURE_TITLE.CREATED,
      agentId: FIXTURE_ROSTER[0]?.agentId ?? "claude-code",
    },
  },
} as const satisfies StoredUIMessage["parts"][number];

const BASE_PROPS: PanelProps = {
  view: runningView(RUNNING_REPLY.parts),
  roster: FIXTURE_ROSTER,
  now: FIXTURE_NOW,
  live: [],
  spokenAskPending: false,
};

function renderPanel(props: PanelProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: PanelProps) => {
    act(() => {
      root.render(createElement(ConversationPanel, next));
    });
  };
  render(props);
  const scroll = container.querySelector(".conversation-scroll");
  if (!(scroll instanceof HTMLDivElement)) throw new Error("Missing conversation scroll box.");
  return {
    container,
    root,
    scroll,
    render,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * Fakes the scroll box's geometry, since jsdom lays nothing out. A browser
 * clamps the offset to what the thread can scroll, which only the case of a
 * thread that fits its window whole depends on; the other cases read the
 * offset a scroll asked for as it was asked, so the tail's pin shows plainly.
 */
function controlMetrics(
  element: HTMLDivElement,
  initial: MutableScrollMetrics,
  { clamp = false }: { clamp?: boolean } = {},
) {
  const state = { ...initial };
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => state.scrollTop,
      set: (value: number) => {
        state.scrollTop = clamp
          ? Math.min(Math.max(value, 0), Math.max(state.scrollHeight - state.clientHeight, 0))
          : value;
      },
    },
    scrollHeight: {
      configurable: true,
      get: () => state.scrollHeight,
    },
    clientHeight: {
      configurable: true,
      get: () => state.clientHeight,
    },
  });
  return {
    state,
    set(next: Partial<MutableScrollMetrics>) {
      Object.assign(state, next);
    },
  };
}

function jumpButton(container: HTMLDivElement): HTMLButtonElement | null {
  const button = container.querySelector(".conversation-jump-to-bottom");
  return button instanceof HTMLButtonElement ? button : null;
}

function scrollElement(element: HTMLDivElement, top: number): void {
  act(() => {
    element.scrollTop = top;
    element.dispatchEvent(new Event("scroll"));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("while the reader follows the tail, same-message tool and thinking rows keep the thread pinned", () => {
  const mounted = renderPanel(BASE_PROPS);
  const metrics = controlMetrics(mounted.scroll, {
    scrollTop: 200,
    scrollHeight: 320,
    clientHeight: 120,
  });
  const grown = runningView([...RUNNING_REPLY.parts, EXTRA_REASONING, EXTRA_TOOL]);
  metrics.set({ scrollHeight: 420 });
  mounted.render({ ...BASE_PROPS, view: grown });
  assert.equal(metrics.state.scrollTop, 420);
  assert.equal(jumpButton(mounted.container), null);
  mounted.unmount();
});

test("scrolling up pauses automatic scrolling until the jump-to-bottom control is pressed", () => {
  const mounted = renderPanel(BASE_PROPS);
  const metrics = controlMetrics(mounted.scroll, {
    scrollTop: 300,
    scrollHeight: 420,
    clientHeight: 120,
  });
  scrollElement(mounted.scroll, 160);
  const button = jumpButton(mounted.container);
  assert.ok(button);

  metrics.set({ scrollHeight: 480 });
  mounted.render({
    ...BASE_PROPS,
    live: [
      {
        entry: { kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Still working through it." },
        at: undefined,
      },
    ],
  });
  assert.equal(metrics.state.scrollTop, 160);
  assert.ok(jumpButton(mounted.container));

  act(() => {
    button.click();
  });
  assert.equal(metrics.state.scrollTop, 480);
  assert.equal(jumpButton(mounted.container), null);
  mounted.unmount();
});

/** The whole fixture thread as one view: several turns, so an older group can be prepended to a shorter one. */
const FULL_GROUPS = selectConversationView({ ...FIXTURE_INPUT, observed: [], events: [] });

/** A deferred answer to the load-older ask, so a test settles it when it means to; `count` is every ask made. */
function deferredLoad() {
  const pending: ((landed: boolean) => void)[] = [];
  let count = 0;
  const onLoadOlder = () =>
    new Promise<boolean>((resolve) => {
      count += 1;
      pending.push(resolve);
    });
  return {
    onLoadOlder,
    get count() {
      return count;
    },
    /** Answers every ask out, as a page that landed unless told otherwise. */
    async settle(landed = true) {
      for (const resolve of pending.splice(0)) resolve(landed);
      await act(async () => {
        await Promise.resolve();
      });
    },
  };
}

/** The first message row the list draws, which the panel keeps the reader's place by. */
function firstRow(container: HTMLDivElement): Element {
  const row = container.querySelector(".conversation-list > li:not(.conversation-break)");
  if (row === null) throw new Error("Missing first message row.");
  return row;
}

/** Lays a row out at `contentTop` within the scrolled content, since jsdom lays nothing out; the box's own rect stays at zero. */
function placeRow(row: Element, scroll: HTMLDivElement, contentTop: () => number) {
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: contentTop() - scroll.scrollTop }),
  });
}

test("reaching the top asks for older turns once while the view says they stand, and the rows that land above keep the reader's place", async () => {
  assert.ok(FULL_GROUPS.length >= 2);
  const newest = FULL_GROUPS.at(-1);
  assert.ok(newest);
  const load = deferredLoad();
  const shortView: ConversationViewSnapshot = { groups: [newest], settled: true, hasOlder: true };
  // Mounted over a thread with nothing older, then told older turns stand once
  // it has a size: jsdom lays nothing out, so a thread with no height reads as
  // fitting its window whole, which is the other test's case.
  const mounted = renderPanel({
    ...BASE_PROPS,
    view: { ...shortView, hasOlder: false },
    onLoadOlder: load.onLoadOlder,
  });
  const metrics = controlMetrics(mounted.scroll, {
    scrollTop: 300,
    scrollHeight: 420,
    clientHeight: 120,
  });
  const reading = firstRow(mounted.container);
  let readingTop = 0;
  placeRow(reading, mounted.scroll, () => readingTop);
  mounted.render({ ...BASE_PROPS, view: shortView, onLoadOlder: load.onLoadOlder });
  assert.equal(load.count, 0);
  // Scrolling up short of the top asks for nothing.
  scrollElement(mounted.scroll, 160);
  assert.equal(load.count, 0);
  // Reaching it asks once; a second reach while the ask is out asks nothing more.
  scrollElement(mounted.scroll, 20);
  assert.equal(load.count, 1);
  assert.ok(mounted.container.querySelector(".conversation-loading-older"));
  scrollElement(mounted.scroll, 0);
  assert.equal(load.count, 1);

  // The page lands above the reader while the tail grows too: the row they
  // were reading moves down by what landed above it, and so does the reader.
  readingTop = 300;
  metrics.set({ scrollHeight: 780 });
  mounted.render({
    ...BASE_PROPS,
    view: { groups: FULL_GROUPS, settled: true },
    onLoadOlder: load.onLoadOlder,
    live: [
      {
        entry: { kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Still working through it." },
        at: undefined,
      },
    ],
  });
  assert.notEqual(firstRow(mounted.container), reading);
  assert.equal(metrics.state.scrollTop, 300);
  await load.settle();
  assert.equal(mounted.container.querySelector(".conversation-loading-older"), null);
  // The beginning was reached, so reaching the top again asks for nothing.
  scrollElement(mounted.scroll, 0);
  assert.equal(load.count, 1);
  mounted.unmount();
});

test("a thread that fits its window whole asks for older turns as it lands, again once the view has moved, and once more for a page that landed while an ask was out", async () => {
  const newest = FULL_GROUPS.at(-1);
  assert.ok(newest);
  const load = deferredLoad();
  const props: PanelProps = {
    ...BASE_PROPS,
    view: { groups: [newest], settled: true, hasOlder: true },
    onLoadOlder: load.onLoadOlder,
  };
  // Nothing to scroll: the whole thread shows, and the top is where the reader already is.
  const mounted = renderPanel(props);
  controlMetrics(
    mounted.scroll,
    { scrollTop: 0, scrollHeight: 100, clientHeight: 120 },
    { clamp: true },
  );
  assert.equal(load.count, 1);
  // The same view carried again is not a page landing; nor is an ask that ended with nothing landing.
  mounted.render({ ...props, view: { ...props.view } });
  assert.equal(load.count, 1);
  await load.settle(false);
  assert.equal(load.count, 1);
  // A page that landed with nothing of it showing still moved the history on: the top asks again.
  mounted.render({ ...props, view: { ...props.view } });
  assert.equal(load.count, 1);
  scrollElement(mounted.scroll, 0);
  assert.equal(load.count, 2);
  await load.settle(true);
  assert.equal(load.count, 3);
  await load.settle(false);
  assert.equal(load.count, 3);
  // The view moving asks again.
  const grown = { groups: FULL_GROUPS.slice(-2), settled: true, hasOlder: true };
  mounted.render({ ...props, view: grown });
  assert.equal(load.count, 4);
  // A page landing while that ask is out waits for it to settle, then asks for the next.
  mounted.render({ ...props, view: { groups: FULL_GROUPS, settled: true, hasOlder: true } });
  assert.equal(load.count, 4);
  await load.settle();
  assert.equal(load.count, 5);
  // Once the view says nothing older stands, the settled ask asks for nothing.
  mounted.render({ ...props, view: { groups: FULL_GROUPS, settled: true } });
  await load.settle();
  assert.equal(load.count, 5);
  mounted.unmount();
});

test("without older turns to read, or without a way to ask, reaching the top asks for nothing", () => {
  const load = deferredLoad();
  const mounted = renderPanel({ ...BASE_PROPS, onLoadOlder: load.onLoadOlder });
  controlMetrics(mounted.scroll, { scrollTop: 300, scrollHeight: 420, clientHeight: 120 });
  scrollElement(mounted.scroll, 0);
  assert.equal(load.count, 0);
  mounted.unmount();
  const bare = renderPanel({ ...BASE_PROPS, view: { ...BASE_PROPS.view, hasOlder: true } });
  controlMetrics(bare.scroll, { scrollTop: 300, scrollHeight: 420, clientHeight: 120 });
  scrollElement(bare.scroll, 0);
  assert.equal(bare.container.querySelector(".conversation-loading-older"), null);
  bare.unmount();
});

test("older turns landing while the reader follows the tail leave them pinned to it", () => {
  const newest = FULL_GROUPS.at(-1);
  assert.ok(newest);
  const mounted = renderPanel({ ...BASE_PROPS, view: { groups: [newest], settled: true } });
  const metrics = controlMetrics(mounted.scroll, {
    scrollTop: 300,
    scrollHeight: 420,
    clientHeight: 120,
  });
  metrics.set({ scrollHeight: 720 });
  mounted.render({ ...BASE_PROPS, view: { groups: FULL_GROUPS, settled: true } });
  assert.equal(metrics.state.scrollTop, 720);
  mounted.unmount();
});
