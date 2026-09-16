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

function controlMetrics(element: HTMLDivElement, initial: MutableScrollMetrics) {
  const state = { ...initial };
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => state.scrollTop,
      set: (value: number) => {
        state.scrollTop = value;
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
