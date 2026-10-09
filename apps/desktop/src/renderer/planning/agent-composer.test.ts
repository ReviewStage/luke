// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_DELIVERY,
  CODING_AGENT_STATUS,
  type CodingAgentDelivery,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AgentTabView } from "./agent-tab";
import { useAgentComposer } from "./use-agent-composer";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const PLAN: CodingAgentMessage = {
  id: "m-plan",
  role: "user",
  parts: [{ type: "text", text: "# Teammate invitations\n\nInvite a teammate by email." }],
};

const RUNNING_AGENT = { agent: { ...AGENT, status: CODING_AGENT_STATUS.RUNNING } } as const;

/** A row of the developer's as the service writes one: awaiting its delivery, or taken into its turn. */
function row(id: string, text: string, awaiting?: CodingAgentDelivery): CodingAgentMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
    ...(awaiting === undefined ? undefined : { metadata: { delivery: awaiting } }),
  };
}

interface Standing {
  status: CodingAgentStatus;
  messages: readonly CodingAgentMessage[];
}

/** One message sent, held until the test answers it. */
interface Sent {
  text: string;
  delivery: CodingAgentDelivery;
  answer: (answer: CodingAgentAgentAnswer) => void;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const ignore = () => undefined;

/**
 * The tab mounted over a scripted service: every message sent is held
 * until the test answers it, every status the answer moved is written
 * down, and the transcript is whatever the test says the service holds.
 */
function mount(initial: Standing) {
  const sends: Sent[] = [];
  const statuses: CodingAgentStatus[] = [];
  let stops = 0;
  let restand: ((next: (was: Standing) => Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    const composer = useAgentComposer({
      agentId: AGENT_ID,
      messages: held.messages,
      send: (_agentId, text, delivery) =>
        new Promise((answer) => {
          sends.push({ text, delivery, answer });
        }),
      onStatus: (_agentId, status) => {
        statuses.push(status);
        setHeld((was) => ({ ...was, status }));
      },
    });
    return createElement(AgentTabView, {
      agent: { ...AGENT, status: held.status },
      models: undefined,
      transcript: { messages: held.messages, reading: false, failed: false, onRetry: ignore },
      composer,
      onStop: () => {
        stops += 1;
        return Promise.resolve();
      },
      openGitHub: ignore,
      copyText: () => Promise.resolve(),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const field = (): HTMLTextAreaElement => {
    const found = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(found, "the box is drawn");
    return found;
  };
  return {
    container,
    sends,
    statuses,
    stops: () => stops,
    field,
    /** Types the words into the box, as a keyboard would. */
    type: (text: string) => {
      const box = field();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      assert.ok(setter);
      act(() => {
        setter.call(box, text);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    /** One key pressed in the box; whether the box left its default to the browser. */
    key: (init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      act(() => {
        field().dispatchEvent(event);
      });
      return !event.defaultPrevented;
    },
    answer: async (index: number, answer: CodingAgentAgentAnswer) => {
      const sent = sends[index];
      assert.ok(sent, `message ${index} was sent`);
      await act(async () => {
        sent.answer(answer);
        await Promise.resolve();
      });
      await settle();
    },
    stand: async (next: Partial<Standing>) => {
      act(() => restand?.((was) => ({ ...was, ...next })));
      await settle();
    },
    /** The developer's bubbles in the transcript, by their words. */
    bubbles: () =>
      [...container.querySelectorAll('[role="log"] .is-user')].map((each) => each.textContent),
    /** The queued rows above the box, by their words. */
    queued: () =>
      [...container.querySelectorAll("[data-queued-id]")].map((each) => ({
        id: each.getAttribute("data-queued-id"),
        words: each.querySelector("span:not([aria-hidden])")?.textContent,
      })),
    buttons: (label: string) => [
      ...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`),
    ],
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
  };
}

test("Enter sends the words now while a turn runs and the line stands in the transcript at once; Shift+Enter is the browser's new line", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(tab.field().placeholder, "Message the agent…");
  tab.type("Also expire them after a week.");

  // Shift+Enter is left to the browser, which is a new line; nothing goes.
  assert.equal(tab.key({ key: "Enter", shiftKey: true }), true);
  assert.deepEqual(tab.sends, []);

  assert.equal(tab.key({ key: "Enter" }), false);
  assert.deepEqual(
    tab.sends.map(({ text, delivery }) => ({ text, delivery })),
    [{ text: "Also expire them after a week.", delivery: CODING_AGENT_DELIVERY.STEER }],
  );
  // The box is held while the message is out, and the line is the developer's bubble already.
  assert.equal(tab.field().value, "");
  assert.equal(tab.field().disabled, true);
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);
  assert.deepEqual(tab.queued(), []);

  await tab.answer(0, RUNNING_AGENT);
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.statuses, [CODING_AGENT_STATUS.RUNNING]);

  // The service's own row for the line arrives, and takes the line's place: one bubble, not two.
  await tab.stand({
    messages: [PLAN, row("m-1", "Also expire them after a week.", CODING_AGENT_DELIVERY.STEER)],
  });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);
  await tab.stand({ messages: [PLAN, row("m-1", "Also expire them after a week.")] });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);
});

test("⌥Enter queues, and so does the menu on the send: the lines stand above the box marked Queued, in order, until their turn takes them", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.match(tab.container.querySelector(".agent-composer-hint")?.textContent ?? "", /queue/u);
  tab.type("Then add tests.");
  assert.equal(tab.key({ key: "Enter", altKey: true }), false);
  assert.deepEqual(
    tab.sends.map(({ text, delivery }) => ({ text, delivery })),
    [{ text: "Then add tests.", delivery: CODING_AGENT_DELIVERY.QUEUE }],
  );
  assert.deepEqual(
    tab.queued().map((each) => each.words),
    ["Then add tests."],
  );
  assert.match(tab.container.querySelector("[data-queued-id]")?.textContent ?? "", /Queued/u);
  assert.deepEqual(tab.bubbles(), []);
  await tab.answer(0, RUNNING_AGENT);

  tab.type("And docs.");
  const chevron = tab.buttons("How to send")[0];
  assert.ok(chevron);
  act(() => chevron.click());
  const menu = tab.container.querySelector('[role="menu"]');
  assert.ok(menu, "the menu opens");
  assert.deepEqual(
    [...menu.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent),
    ["Send now", "Queue for after this turn"],
  );
  const queue = menu.querySelector<HTMLButtonElement>(
    `[data-delivery="${CODING_AGENT_DELIVERY.QUEUE}"]`,
  );
  assert.ok(queue);
  act(() => queue.click());
  assert.equal(tab.container.querySelector('[role="menu"]'), null);
  assert.deepEqual(tab.sends[1]?.delivery, CODING_AGENT_DELIVERY.QUEUE);
  assert.deepEqual(
    tab.queued().map((each) => each.words),
    ["Then add tests.", "And docs."],
  );
  await tab.answer(1, RUNNING_AGENT);

  // The service's rows take the lines' places, in the same order, still waiting.
  await tab.stand({
    messages: [
      PLAN,
      row("m-1", "Then add tests.", CODING_AGENT_DELIVERY.QUEUE),
      row("m-2", "And docs.", CODING_AGENT_DELIVERY.QUEUE),
    ],
  });
  assert.deepEqual(tab.queued(), [
    { id: "m-1", words: "Then add tests." },
    { id: "m-2", words: "And docs." },
  ]);
  assert.deepEqual(tab.bubbles(), []);

  // Their turn takes them: the rows join the transcript and the queue clears.
  await tab.stand({ messages: [PLAN, row("m-1", "Then add tests."), row("m-2", "And docs.")] });
  assert.deepEqual(tab.queued(), []);
  assert.deepEqual(tab.bubbles(), ["Then add tests.", "And docs."]);
});

test("idle, a send opens a new turn: the status goes back to running and the Stop and the keys come with it", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  assert.equal(tab.field().placeholder, "Ask for changes or a follow-up…");
  assert.equal(tab.container.querySelector(".agent-composer-hint")?.textContent, "");
  assert.deepEqual(tab.buttons("Stop"), []);
  assert.deepEqual(tab.buttons("How to send"), []);
  // ⌥Enter idle goes the plain way, since an idle agent takes either as its next turn.
  tab.type("Also handle the empty case.");
  assert.equal(tab.key({ key: "Enter", altKey: true }), false);
  assert.deepEqual(
    tab.sends.map(({ text, delivery }) => ({ text, delivery })),
    [{ text: "Also handle the empty case.", delivery: CODING_AGENT_DELIVERY.STEER }],
  );

  await tab.answer(0, RUNNING_AGENT);
  assert.deepEqual(tab.statuses, [CODING_AGENT_STATUS.RUNNING]);
  assert.equal(tab.field().placeholder, "Message the agent…");
  assert.equal(tab.buttons("Stop").length, 1);
  assert.match(tab.container.querySelector(".agent-composer-hint")?.textContent ?? "", /send now/u);
});

test("a message that did not go comes back into the box with why and Retry, which sends it the same way; an agent ended for good closes the box with the reason", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Then add tests.");
  tab.key({ key: "Enter", altKey: true });
  assert.deepEqual(
    tab.queued().map((each) => each.words),
    ["Then add tests."],
  );

  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
  assert.equal(tab.field().value, "Then add tests.");
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.queued(), []);
  assert.match(tab.note() ?? "", /still starting/u);

  const retry = tab.container.querySelector<HTMLButtonElement>('[role="alert"] button');
  assert.ok(retry);
  act(() => retry.click());
  assert.deepEqual(
    tab.sends.map(({ text, delivery }) => ({ text, delivery })),
    [
      { text: "Then add tests.", delivery: CODING_AGENT_DELIVERY.QUEUE },
      { text: "Then add tests.", delivery: CODING_AGENT_DELIVERY.QUEUE },
    ],
  );
  assert.equal(tab.note(), undefined);

  await tab.answer(1, { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED });
  assert.equal(tab.container.querySelector("textarea"), null);
  assert.match(
    tab.container.querySelector(".agent-composer-closed")?.textContent ?? "",
    /ended for good/u,
  );
  assert.equal(tab.note(), undefined);
});

test("the tab has one Stop, the composer's, while a turn runs, and it stops the agent", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(tab.container.querySelector("header button"), null);
  const stops = tab.buttons("Stop");
  assert.equal(stops.length, 1);
  await act(async () => {
    stops[0]?.click();
    await Promise.resolve();
  });
  assert.equal(tab.stops(), 1);

  // A starting agent has no turn the service could cancel yet, so Stop waits for one.
  await tab.stand({ status: CODING_AGENT_STATUS.STARTING });
  assert.deepEqual(tab.buttons("Stop"), []);
});

test("the box takes focus as the tab opens unless the developer is typing elsewhere, Escape leaves it, and an empty box sends nothing", () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(document.activeElement, tab.field());
  tab.key({ key: "Escape" });
  assert.notEqual(document.activeElement, tab.field());
  tab.type("   ");
  assert.equal(tab.key({ key: "Enter" }), false);
  assert.deepEqual(tab.sends, []);

  const editor = document.createElement("input");
  document.body.append(editor);
  editor.focus();
  const other = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(document.activeElement, editor);
  assert.notEqual(document.activeElement, other.field());
});
