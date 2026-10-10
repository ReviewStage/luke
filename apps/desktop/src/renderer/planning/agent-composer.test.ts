// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentTabView } from "./agent-tab";
import { useAgentComposer } from "./use-agent-composer";
import { useAgentModel } from "./use-agent-model";

/**
 * The message box under an agent's transcript: one card that reads the
 * same whatever the agent is doing, one button that is Send or Stop, Enter
 * to send, a send that stands in the transcript at once and is reconciled
 * with the service's row, and Retry under the card carrying the failed
 * send's key again; and at the card's foot the model chip, whose menu is
 * the Start button's (../desktop/start-agent-button.test.ts), drawing a
 * pick at once and taking a refused one off again. The card's look is the
 * shared composer's, held in ../ai-elements/prompt-input.test.ts.
 */

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

/** The agent's model with its fast version, and one other, as the catalog lists them. */
const MODELS: readonly CatalogModel[] = [
  {
    id: AGENT.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
  },
  {
    id: `${AGENT.model}-fast`,
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low"],
  },
];

const PLACEHOLDER = "Message the agent…";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A row of the developer's as the service writes one. */
function row(id: string, text: string): CodingAgentMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

interface Standing {
  status: CodingAgentStatus;
  messages: readonly CodingAgentMessage[];
  choice: ModelChoice;
}

/** One message sent, held until the test answers it. */
interface Sent {
  text: string;
  clientKey: string;
  answer: (answer: CodingAgentAgentAnswer) => void;
}

/** One change of model sent, held until the test answers it. */
interface Chosen {
  choice: ModelChoice;
  answer: (answer: CodingAgentAgentAnswer) => void;
}

const roots: Root[] = [];

beforeEach(installScrollIntoView);

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
 * The tab mounted over a scripted service: every message and every change
 * of model sent is held until the test answers it, every status the answer
 * moved is written down, and the transcript and the agent's choice are
 * whatever the test says the service holds.
 */
function mount(initial: Omit<Standing, "choice"> & { choice?: ModelChoice }) {
  const sends: Sent[] = [];
  const chooses: Chosen[] = [];
  const statuses: CodingAgentStatus[] = [];
  let stops = 0;
  let restand: ((next: (was: Standing) => Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState<Standing>({
      choice: { model: AGENT.model, effort: AGENT.effort },
      ...initial,
    });
    restand = setHeld;
    const model = useAgentModel({
      agent: { id: AGENT_ID, ...held.choice },
      choose: (_agentId, choice) =>
        new Promise((answer) => {
          chooses.push({ choice, answer });
        }),
    });
    const composer = useAgentComposer({
      agentId: AGENT_ID,
      messages: held.messages,
      send: (_agentId, text, clientKey) =>
        new Promise((answer) => {
          sends.push({ text, clientKey, answer });
        }),
      onStatus: (_agentId, status) => {
        statuses.push(status);
        setHeld((was) => ({ ...was, status }));
      },
    });
    return createElement(AgentTabView, {
      agent: { ...AGENT, ...held.choice, status: held.status },
      models: MODELS,
      readModels: ignore,
      transcript: {
        messages: held.messages,
        failure: undefined,
        reading: false,
        failed: false,
        onRetry: ignore,
      },
      composer,
      model,
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
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
    chooses,
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
    /** The model chip's words. */
    chip: () => container.querySelector(".agent-model-chip .plan-compose-chip-name")?.textContent,
    /** Opens the chip's menu and picks the row at the index. */
    pick: async (index: number) => {
      act(() => container.querySelector<HTMLButtonElement>(".agent-model-chip button")?.click());
      await settle();
      const row = container.querySelectorAll<HTMLElement>('[role="option"]')[index];
      assert.ok(row, `the menu lists row ${index}`);
      act(() => row.click());
    },
    chose: async (index: number, answer: CodingAgentAgentAnswer) => {
      const chosen = chooses[index];
      assert.ok(chosen, `change ${index} was sent`);
      await act(async () => {
        chosen.answer(answer);
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
    /** The one button at the card's right: its name and whether it takes a press; none drawn reads as none. The chips at the foot's left are not it. */
    control: () => {
      const buttons = [
        ...container.querySelectorAll<HTMLButtonElement>(".agent-composer button"),
      ].filter((each) => !each.classList.contains("plan-compose-chip"));
      const [one] = buttons.filter((each) => each.textContent !== "Retry");
      assert.equal(buttons.filter((each) => each.textContent !== "Retry").length, 1);
      if (one === undefined) return undefined;
      // A button that takes no press says so to assistive technology as well.
      assert.equal(one.getAttribute("aria-disabled") === "true", one.disabled);
      return { label: one.getAttribute("aria-label"), disabled: one.disabled, type: one.type };
    },
    stop: () =>
      container.querySelector<HTMLButtonElement>('.agent-composer button[aria-label="Stop"]'),
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
    retry: () => container.querySelector<HTMLButtonElement>('[role="alert"] button'),
  };
}

test("the box reads the same running or idle: one placeholder, no hint, no queue, and no menu; Enter sends under a fresh key and Shift+Enter is the browser's new line", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const same = () => {
    assert.equal(tab.field().placeholder, PLACEHOLDER);
    assert.equal(tab.container.querySelector(".agent-composer-hint"), null);
    assert.equal(tab.container.querySelector("[data-queued-id]"), null);
    assert.equal(tab.container.querySelector('[role="menu"], [role="listbox"]'), null);
    assert.equal(tab.container.querySelectorAll(".agent-composer textarea").length, 1);
  };
  same();
  tab.type("Also expire them after a week.");

  // Shift+Enter is left to the browser, which is a new line; nothing goes.
  assert.equal(tab.key({ key: "Enter", shiftKey: true }), true);
  assert.equal(tab.sends.length, 0);

  assert.equal(tab.key({ key: "Enter" }), false);
  assert.deepEqual(
    tab.sends.map(({ text }) => text),
    ["Also expire them after a week."],
  );
  assert.match(tab.sends[0]?.clientKey ?? "", UUID);
  await tab.answer(0, RUNNING_AGENT);

  // Idle, the box is the same box, and a modified Enter has no meaning of its own: it sends.
  await tab.stand({ status: CODING_AGENT_STATUS.COMPLETED });
  same();
  tab.type("And the docs.");
  assert.equal(tab.key({ key: "Enter", altKey: true }), false);
  assert.equal(tab.sends.length, 2);
  assert.equal(tab.sends[1]?.text, "And the docs.");
  assert.notEqual(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  await tab.stand({ status: CODING_AGENT_STATUS.STARTING });
  same();
});

test("the one button is Send with words, disabled with none while the agent is idle or starting, and Stop with none while a turn runs; Stop stops the agent, and Enter on an empty box does nothing", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
  tab.type("Also handle the empty case.");
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });
  tab.type("");
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });

  await tab.stand({ status: CODING_AGENT_STATUS.RUNNING });
  assert.deepEqual(tab.control(), { label: "Stop", disabled: false, type: "button" });
  assert.equal(tab.key({ key: "Enter" }), false);
  assert.equal(tab.sends.length, 0);
  assert.equal(tab.stops(), 0);
  tab.type("Push what you have.");
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });
  tab.type("");
  const stop = tab.stop();
  assert.ok(stop);
  await act(async () => {
    stop.click();
    await Promise.resolve();
  });
  assert.equal(tab.stops(), 1);
  assert.equal(tab.container.querySelector("header"), null);

  // A starting agent has no turn the service could cancel yet, so Stop waits for one.
  await tab.stand({ status: CODING_AGENT_STATUS.STARTING });
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
});

test("a send stands in the transcript at once as the developer's line and holds the box; the service's answer moves the status and frees it, and the service's own row takes the line's place", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  tab.type("Also expire them after a week.");
  tab.key({ key: "Enter" });
  assert.equal(tab.field().value, "");
  assert.equal(tab.field().disabled, true);
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);

  await tab.answer(0, RUNNING_AGENT);
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.statuses, [CODING_AGENT_STATUS.RUNNING]);
  assert.deepEqual(tab.control(), { label: "Stop", disabled: false, type: "button" });

  // The service's own row for the line arrives, and takes the line's place: one bubble, not two.
  await tab.stand({ messages: [PLAN, row("m-1", "Also expire them after a week.")] });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);
});

test("a message that did not go comes back into the box with why under the card and Retry, which sends it again under the same key; an edit is a new message under a new key; an agent ended for good keeps the box, disabled, with the reason and no Retry", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Then add tests.");
  tab.key({ key: "Enter" });
  assert.deepEqual(tab.bubbles(), ["Then add tests."]);

  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
  assert.equal(tab.field().value, "Then add tests.");
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.bubbles(), []);
  assert.match(tab.note() ?? "", /still starting/u);

  const retry = tab.retry();
  assert.ok(retry);
  act(() => retry.click());
  assert.deepEqual(
    tab.sends.map(({ text }) => text),
    ["Then add tests.", "Then add tests."],
  );
  assert.equal(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  assert.equal(tab.note(), undefined);

  // Editing the words is a new message: Retry goes with the edit, and the edit goes under a key of its own.
  await tab.answer(1, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.match(tab.note() ?? "", /didn't hear back/u);
  tab.type("Then add tests and docs.");
  assert.equal(tab.note(), undefined);
  assert.equal(tab.retry(), null);
  tab.key({ key: "Enter" });
  assert.equal(tab.sends[2]?.text, "Then add tests and docs.");
  assert.notEqual(tab.sends[2]?.clientKey, tab.sends[0]?.clientKey);

  await tab.answer(2, { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED });
  assert.equal(tab.field().placeholder, PLACEHOLDER);
  assert.equal(tab.field().disabled, true);
  assert.match(tab.note() ?? "", /ended for good/u);
  assert.equal(tab.retry(), null);
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
});

test("a send whose answer was lost and whose row has since landed is read back by that row when Retry sends it again under the same key, so the line is drawn once", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(tab.bubbles(), []);
  // The service had taken the words after all: its row lands before Retry is pressed.
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  const retry = tab.retry();
  assert.ok(retry);
  act(() => retry.click());
  assert.equal(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  // The service answers the repeat with nothing new written: the row that stands is the line's.
  await tab.answer(1, RUNNING_AGENT);
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  assert.equal(tab.field().value, "");
});

test("a send whose row lands while its request is still out, and whose answer is then lost, is read as taken: the box stays clear, nothing says Retry, and the line is drawn once", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  assert.equal(tab.field().value, "");
  assert.equal(tab.field().disabled, false);
  assert.equal(tab.note(), undefined);
  assert.equal(tab.retry(), null);
});

test("two lines of the same words sent before either is read back are read back one row at a time, across pages", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(0, RUNNING_AGENT);
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(1, RUNNING_AGENT);
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);

  // The first row lands on its own page: one line is read back, the other still stands.
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests."), row("m-2", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);
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

test("the model chip names the agent's model and effort, with Fast where it runs the fast version; a pick is drawn at once and sent for this agent, the service's answer is what it then reads, and a refusal takes the pick off with why under the box and no Retry", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(tab.chip(), "Claude Opus 5.5 · High");
  await tab.stand({ choice: { model: `${AGENT.model}-fast`, effort: "low" } });
  assert.equal(tab.chip(), "Claude Opus 5.5 · Low · Fast");

  await tab.pick(1);
  assert.equal(tab.chip(), "GPT-6.1 Sol · Low", "drawn before the service answers");
  assert.deepEqual(
    tab.chooses.map(({ choice }) => choice),
    [{ model: "openai/gpt-6.1-sol", effort: "low" }],
  );
  const chosen = { model: "openai/gpt-6.1-sol", effort: "low" };
  await tab.chose(0, { agent: { ...AGENT, ...chosen } });
  await tab.stand({ choice: chosen });
  assert.equal(tab.chip(), "GPT-6.1 Sol · Low");

  await tab.pick(0);
  assert.equal(tab.chip(), "Claude Opus 5.5 · High");
  await tab.chose(1, { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE });
  assert.equal(tab.chip(), "GPT-6.1 Sol · Low", "rolled back to what the agent runs on");
  assert.match(tab.note() ?? "", /isn't offered any more/u);
  assert.equal(tab.retry(), null, "the chip is the retry");
});
