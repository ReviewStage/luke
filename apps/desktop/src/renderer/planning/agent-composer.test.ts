// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  type CodingAgentContext,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type CodingAgentUsage,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { builtStylesheet, cssRules, ownDeclarations } from "#testing/css-rules";
import { assertOpensWhatItNames } from "#testing/popup";
import { relayout } from "#testing/resize-observer";
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
  title: null,
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

/** What a started agent's box says it takes; a draft's asks to make changes (../desktop/desktop-plans.test.ts). */
const FOLLOW_UP = "Send a follow up";

/** What would draw a bar across the panel between the transcript and the box: a rule at a box's edge, or a shadow cast over the lines above. */
const BAR_PROPERTIES: ReadonlySet<string> = new Set([
  "border",
  "border-top",
  "border-top-width",
  "border-block",
  "border-block-start",
  "border-width",
  "box-shadow",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A row of the developer's as the service writes one. */
function row(id: string, text: string): CodingAgentMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

interface Standing {
  status: CodingAgentStatus;
  messages: readonly CodingAgentMessage[];
  choice: ModelChoice;
  usage?: CodingAgentUsage;
  context?: CodingAgentContext;
}

/** One message sent, held until the test answers it. */
interface Sent {
  text: string;
  clientKey: string;
  attachments: readonly CodingAgentAttachment[];
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
      send: (_agentId, text, clientKey, attachments) =>
        new Promise((answer) => {
          sends.push({ text, clientKey, attachments, answer });
        }),
      onStatus: (_agentId, { status }) => {
        statuses.push(status);
        setHeld((was) => ({ ...was, status }));
      },
    });
    return createElement(AgentTabView, {
      agent: { ...AGENT, ...held.choice, status: held.status },
      models: MODELS,
      startedAt: undefined,
      delegationStarts: undefined,
      readModels: ignore,
      transcript: {
        messages: held.messages,
        failure: undefined,
        usage: held.usage,
        turnUsage: undefined,
        context: held.context,
        runStartedAt: undefined,
        pageStatus: undefined,
        pageTitle: undefined,
        subagentTitles: new Map(),
        delegations: new Map(),
        subagents: new Map(),
        reading: false,
        failed: false,
        onRetry: ignore,
      },
      composer,
      model,
      servers: { disabled: [], onSwitch: ignore, onOpenSettings: ignore },
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
      onStop: () => {
        stops += 1;
        return Promise.resolve();
      },
      openGitHub: ignore,
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
    chip: () => container.querySelector(".agent-model-chip .model-label")?.textContent,
    /** Opens the chip's menu, reads the muted line at its foot, null where the menu has none, and closes it again. */
    footNote: async () => {
      const chip = container.querySelector<HTMLButtonElement>(".agent-model-chip button");
      act(() => chip?.click());
      await settle();
      const note = container.querySelector(".agent-model-menu [data-foot-note]")?.textContent;
      act(() => chip?.click());
      await settle();
      return note ?? null;
    },
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
      ].filter(
        (each) =>
          !each.matches(
            ".plan-compose-chip, .agent-model-button, .agent-servers-button, .agent-composer-attach, .dictate-button, .attached-file-face, .corner-dismiss",
          ),
      );
      const [one] = buttons.filter((each) => each.textContent !== "Retry");
      assert.equal(buttons.filter((each) => each.textContent !== "Retry").length, 1);
      if (one === undefined) return undefined;
      // A button that takes no press says so to assistive technology as well.
      assert.equal(one.getAttribute("aria-disabled") === "true", one.disabled);
      return { label: one.getAttribute("aria-label"), disabled: one.disabled, type: one.type };
    },
    stop: () =>
      container.querySelector<HTMLButtonElement>('.agent-composer button[aria-label="Stop"]'),
    /** The files the system's picker hands the box, as the hidden input's change carries them. */
    pickFiles: async (files: readonly File[]) => {
      const input = container.querySelector<HTMLInputElement>('.agent-composer input[type="file"]');
      assert.ok(input, "the box holds a file picker");
      Object.defineProperty(input, "files", { value: files, configurable: true });
      act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    /** Files pasted into the box; whether the box left the paste to the browser. */
    paste: async (files: readonly File[]): Promise<boolean> => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { files, types: ["Files"] } });
      act(() => {
        field().dispatchEvent(event);
      });
      await settle();
      return !event.defaultPrevented;
    },
    /** Files dragged over the card, then dropped on it; whether the card took the drag as a drop target. */
    drop: async (files: readonly File[]): Promise<boolean> => {
      const card = container.querySelector(".agent-composer");
      assert.ok(card);
      const dragged = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"] } });
        return event;
      };
      const over = dragged("dragover");
      act(() => {
        card.dispatchEvent(over);
      });
      const dropping = card.hasAttribute("data-dropping");
      act(() => {
        card.dispatchEvent(dragged("drop"));
      });
      await settle();
      assert.equal(card.hasAttribute("data-dropping"), false, "a drop puts the highlight away");
      return over.defaultPrevented && dropping;
    },
    /** The chips over the box's words: an image by its thumbnail's name, any other file by its words. */
    chips: () =>
      [...container.querySelectorAll(".agent-composer .attached-file")].map(
        (each) => each.querySelector("img")?.alt ?? each.textContent,
      ),
    /** The chips over the developer's bubbles in the transcript, read the same way. */
    sentChips: () =>
      [...container.querySelectorAll('[role="log"] .attached-file')].map(
        (each) => each.querySelector("img")?.alt ?? each.textContent,
      ),
    /** Waits for files being read on this machine to land, as the check given reads them. */
    landed: (check: () => void) =>
      vi.waitFor(async () => {
        await settle();
        check();
      }),
    /** Takes the chip of the name off the box. */
    unattach: (name: string) => {
      const remove = container.querySelector<HTMLButtonElement>(
        `.agent-composer button[aria-label="Remove ${name}"]`,
      );
      assert.ok(remove, `${name} has its way off`);
      act(() => remove.click());
    },
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
    retry: () => container.querySelector<HTMLButtonElement>('[role="alert"] button'),
  };
}

test("the box reads the same running or idle: one follow-up placeholder, no hint, no queue, and no menu; Enter sends under a fresh key and Shift+Enter is the browser's new line", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const same = () => {
    assert.equal(tab.field().placeholder, FOLLOW_UP);
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

test("a started agent's box asks for a follow up even before its transcript is read, because its conversation opened on its plan or task", () => {
  const tab = mount({ status: CODING_AGENT_STATUS.STARTING, messages: [] });
  assert.equal(tab.field().placeholder, FOLLOW_UP);
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
  assert.equal(tab.field().placeholder, FOLLOW_UP);
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
  assert.equal(tab.chip(), "Opus 5.5 High");
  await tab.stand({ choice: { model: `${AGENT.model}-fast`, effort: "low" } });
  assert.equal(tab.chip(), "Opus 5.5 Low Fast");

  await tab.pick(1);
  assert.equal(tab.chip(), "GPT-6.1 Sol Low", "drawn before the service answers");
  assert.deepEqual(
    tab.chooses.map(({ choice }) => choice),
    [{ model: "openai/gpt-6.1-sol", effort: "low" }],
  );
  const chosen = { model: "openai/gpt-6.1-sol", effort: "low" };
  await tab.chose(0, { agent: { ...AGENT, ...chosen } });
  await tab.stand({ choice: chosen });
  assert.equal(tab.chip(), "GPT-6.1 Sol Low");

  await tab.pick(0);
  assert.equal(tab.chip(), "Opus 5.5 High");
  await tab.chose(1, { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE });
  assert.equal(tab.chip(), "GPT-6.1 Sol Low", "rolled back to what the agent runs on");
  assert.match(tab.note() ?? "", /isn't offered any more/u);
  assert.equal(tab.retry(), null, "the chip is the retry");
});

test("the model button is the pair alone and a chevron: no mark before it, the effort dimmed after the model with no dot between them, and the chevron last", () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const button = tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button");
  assert.ok(button);
  assert.equal(button.textContent, "Opus 5.5 High");
  assert.equal(button.querySelector(".model-label-detail")?.textContent, "High");
  assert.equal(button.querySelector(".provider-mark"), null, "no mark");
  assert.equal(button.firstElementChild?.matches(".model-label"), true, "the words come first");
  assert.equal(button.lastElementChild?.matches("svg"), true, "the chevron comes last");
  assert.equal(button.querySelectorAll("svg").length, 1, "the chevron is its one glyph");
  act(() => button.click());
  assertOpensWhatItNames(button);
});

test("the chip's menu ends on one muted line with what the agent has cost: tokens and dollars, tokens alone where the service priced none, and nothing before a turn settled", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(await tab.footNote(), null);
  await tab.stand({ usage: { inputTokens: 1_180_000, outputTokens: 24_000, costUsd: 0.4213 } });
  assert.equal(await tab.footNote(), "This agent: 1.2M tokens · $0.42");
  await tab.stand({ usage: { inputTokens: 812, outputTokens: 40 } });
  assert.equal(await tab.footNote(), "This agent: 852 tokens");
});

test("no bar stands between the transcript and the box: nothing that holds the card under the log draws a rule or a shadow", async () => {
  const rules = cssRules(await builtStylesheet());
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const section = tab.container.querySelector(".agent-tab");
  assert.ok(section);
  const holders: Element[] = [];
  for (
    let at = tab.container.querySelector(".agent-composer");
    at !== null && at !== section;
    at = at.parentElement
  ) {
    holders.push(at);
  }
  assert.ok(holders.length >= 2, "the box and the room it stands in");
  const drawn = holders.flatMap((holder) =>
    ownDeclarations(rules, holder)
      .filter(
        ({ property, value }) => BAR_PROPERTIES.has(property) && value !== "none" && value !== "0",
      )
      .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`),
  );
  assert.deepEqual(drawn, []);
});

test("the log runs right up to the card's top edge and fades over `--scroll-fade` there, its foot padded past the fade so the newest line, or a control focused from below, stands whole above it", async () => {
  const rules = cssRules(await builtStylesheet());
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const log = tab.container.querySelector('[role="log"]');
  const composer = tab.container.querySelector(".agent-composer");
  assert.ok(log && composer);
  /** What the sheet's unlayered rules, which outrank every utility, give the box. */
  const own = (element: Element, property: string) =>
    ownDeclarations(rules, element)
      .filter((each) => each.property === property)
      .filter((each) =>
        rules.some((rule) => rule.layer === undefined && rule.selectors.includes(each.selector)),
      )
      .map((each) => each.value);
  // Nothing stands between the log's foot and the card: the room around the card gives none above it.
  const room = composer.parentElement;
  assert.ok(room);
  assert.equal(own(composer, "padding")[0]?.split(" ")[0], "0");
  for (const box of [composer, room]) {
    assert.deepEqual(own(box, "padding-top"), []);
    assert.deepEqual(
      own(box, "margin-top").filter((value) => value !== "auto"),
      [],
    );
  }
  // The log's foot fades out over the fade's length and pads past it.
  const [mask] = own(log, "mask-image");
  assert.match(mask ?? "", /#000 calc\(100% - var\(--scroll-fade\)\), transparent\)$/u);
  const [foot] = own(log, "padding-bottom");
  assert.match(foot ?? "", /^calc\(var\(--scroll-fade\) \+ var\(--space-\d+\)\)$/u);
  // A control focused from below is scrolled in past the fade too, not just to the log's edge.
  assert.deepEqual(own(log, "scroll-padding-bottom"), [foot]);
});

/** A step that read 620k of a 1M window whose compaction is at 900k. */
const CONTEXT: CodingAgentContext = {
  windowTokens: 1_000_000,
  compactionThresholdTokens: 900_000,
  inputTokens: 620_000,
  outputTokens: 2_400,
  cachedInputTokens: 600_000,
  estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800, briefTokens: 600 },
  measuredAt: 1,
};

test("once a step has ended, a ring stands beside the model chip, coloured by how near eve's compaction the context is, and its press opens what fills it, which Escape and the × close again", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const ring = () =>
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Context usage"]');
  const popover = () =>
    tab.container.querySelector<HTMLElement>('[role="dialog"][aria-label="Context usage"]');
  assert.equal(ring(), null, "no ring before a step ended");

  await tab.stand({ context: CONTEXT });
  const button = ring();
  assert.ok(button);
  assert.equal(
    button.closest(".agent-context")?.previousElementSibling?.classList.contains("agent-servers"),
    true,
    "the ring stands right after the MCP servers button",
  );
  assert.equal(button.dataset.level, "room");
  act(() => {
    button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.body.querySelector('[role="tooltip"]')?.textContent, "62% of context used");

  act(() => button.click());
  const shown = popover();
  assert.ok(shown);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(shown.querySelector(".agent-context-full")?.textContent, "62% full");
  assert.equal(shown.querySelector(".agent-context-total")?.textContent, "~620.0k / 1M tokens");
  assert.deepEqual(
    [...shown.querySelectorAll(".agent-context-legend li")].map((row) => row.textContent),
    ["System prompt~1.2k", "Tool definitions~2.8k", "Plan~600", "Conversation~615.4k"],
  );
  act(() => {
    shown.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(popover(), null);
  assert.equal(document.activeElement, button, "focus goes back to the ring");

  // Near the compaction the ring turns amber, and at it red.
  await tab.stand({ context: { ...CONTEXT, inputTokens: 880_000 } });
  assert.equal(ring()?.dataset.level, "near");
  await tab.stand({ context: { ...CONTEXT, inputTokens: 950_000 } });
  assert.equal(ring()?.dataset.level, "over");

  act(() => ring()?.click());
  const close = popover()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  assert.ok(close);
  act(() => close.click());
  assert.equal(popover(), null);
});

/**
 * The boxes the composer's popovers are placed from, as a layout would
 * measure them: the side panel, the model chip, the ring, and the layer the
 * popover stands in, every other box empty.
 */
function measureBoxes(boxes: {
  room: DOMRect;
  chip: DOMRect;
  ring: DOMRect;
  height: number;
}): () => void {
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches("[data-popover-room]")) return boxes.room;
    if (this.matches(".agent-model-chip")) return boxes.chip;
    if (this.matches(".agent-context")) return boxes.ring;
    if (this.matches(".anchored-popover")) return new DOMRect(0, 0, 340, boxes.height);
    return new DOMRect();
  });
  return () => spy.mockRestore();
}

/** Where a popover's layer stands against the box that holds its button: its side, its left edge from the button's, and its width. */
function placeOf(layer: Element | null | undefined) {
  assert.ok(layer instanceof HTMLElement, "the popover hangs in its anchored layer");
  return {
    side: layer.dataset.side,
    left: Number.parseFloat(layer.style.left),
    width: Number.parseFloat(layer.style.width),
  };
}

test("each composer popover opens right above the button that opened it, from its trailing edge since the buttons stand at the foot's right, from its leading edge where the trailing one would run past the panel's left, pushed back inside where neither stays inside, and Escape hands focus back to the button", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.container.setAttribute("data-popover-room", "");
  await tab.stand({ context: CONTEXT });
  const chip = tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button");
  const ring = tab.container.querySelector<HTMLButtonElement>('button[aria-label="Context usage"]');
  assert.ok(chip && ring);
  const menuLayer = () => tab.container.querySelector(".agent-model-chip > .anchored-popover");
  const ringLayer = () => tab.container.querySelector(".agent-context > .anchored-popover");
  const pressEscape = (from: Element | null) =>
    act(() => {
      from?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  // Full screen, the chip and the ring at the foot's right: each popover ends where its button does.
  const boxes = {
    room: new DOMRect(0, 0, 1024, 768),
    chip: new DOMRect(760, 700, 130, 28),
    ring: new DOMRect(894, 700, 28, 28),
    height: 320,
  };
  const restore = measureBoxes(boxes);
  try {
    act(() => chip.click());
    assert.deepEqual(placeOf(menuLayer()), { side: "above", left: 130 - 340, width: 340 });
    pressEscape(document.activeElement);
    assert.equal(menuLayer(), null);
    assert.equal(document.activeElement, chip, "focus goes back to the chip");

    act(() => ring.click());
    assert.deepEqual(placeOf(ringLayer()), { side: "above", left: 28 - 340, width: 340 });
    pressEscape(document.activeElement);
    assert.equal(document.activeElement, ring, "focus goes back to the ring");

    // Neither of the ring's edges leaves the popover inside a 400px panel, so it is pushed back in to the panel's left inset.
    boxes.room = new DOMRect(600, 0, 400, 768);
    boxes.ring = new DOMRect(834, 700, 28, 28);
    act(() => ring.click());
    assert.deepEqual(placeOf(ringLayer()), { side: "above", left: 608 - 834, width: 340 });
    pressEscape(document.activeElement);

    // A ring too near the panel's left for the popover to end at it, which starts where the ring does instead.
    boxes.room = new DOMRect(0, 0, 1024, 768);
    boxes.ring = new DOMRect(100, 700, 28, 28);
    act(() => ring.click());
    assert.deepEqual(placeOf(ringLayer()), { side: "above", left: 0, width: 340 });
  } finally {
    restore();
  }
});

test("the foot reads as its keys go: the + at its left, then at its right the model, the MCP servers, the context ring, the microphone, and the round button", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  await tab.stand({ context: CONTEXT });
  const name = (button: HTMLButtonElement) =>
    button.matches(".agent-model-button") ? "model" : button.getAttribute("aria-label");
  const presses = (within: string) =>
    [...tab.container.querySelectorAll<HTMLButtonElement>(`${within} button`)].map(name);

  assert.deepEqual(presses(".agent-composer form"), [
    "Attach files",
    "model",
    "MCP servers",
    "Context usage",
    "Dictate",
    "Stop",
  ]);
  assert.deepEqual(presses(".agent-composer-actions"), [
    "model",
    "MCP servers",
    "Context usage",
    "Dictate",
    "Stop",
  ]);
});

test("at the panel's narrowest the popovers are no wider than the panel leaves, held inside its edges, and one whose button stands too near the top for it turns below", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.container.setAttribute("data-popover-room", "");
  await tab.stand({ context: CONTEXT });
  const chip = tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button");
  const ring = tab.container.querySelector<HTMLButtonElement>('button[aria-label="Context usage"]');
  assert.ok(chip && ring);
  const boxes = {
    room: new DOMRect(744, 0, 280, 768),
    chip: new DOMRect(764, 700, 130, 28),
    ring: new DOMRect(898, 700, 28, 28),
    height: 320,
  };
  const restore = measureBoxes(boxes);
  try {
    act(() => chip.click());
    // An 8px inset on each side of a 280px panel: 264px wide, from the panel's left plus 8.
    const menu = placeOf(tab.container.querySelector(".agent-model-chip > .anchored-popover"));
    assert.deepEqual(menu, { side: "above", left: 752 - 764, width: 264 });
    act(() => chip.click());

    act(() => ring.click());
    const popover = placeOf(tab.container.querySelector(".agent-context > .anchored-popover"));
    assert.deepEqual(popover, { side: "above", left: 752 - 898, width: 264 });
    act(() => ring.click());

    boxes.chip = new DOMRect(764, 100, 130, 28);
    act(() => chip.click());
    assert.equal(
      placeOf(tab.container.querySelector(".agent-model-chip > .anchored-popover")).side,
      "below",
    );
  } finally {
    restore();
  }
});

test("an open popover is placed again as it grows past the room above its button, and as its panel is dragged narrower, with the window left the same", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.container.setAttribute("data-popover-room", "");
  const chip = tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button");
  assert.ok(chip);
  // The menu opens short, while it reads the models, under a chip 300px below the panel's top.
  const boxes = {
    room: new DOMRect(600, 0, 400, 768),
    chip: new DOMRect(620, 300, 130, 28),
    ring: new DOMRect(),
    height: 80,
  };
  const restore = measureBoxes(boxes);
  const layer = () => tab.container.querySelector(".agent-model-chip > .anchored-popover");
  try {
    act(() => chip.click());
    assert.deepEqual(placeOf(layer()), { side: "above", left: 0, width: 340 });

    // The rows arrive, and the menu no longer fits above.
    boxes.height = 360;
    act(() => relayout());
    assert.equal(placeOf(layer()).side, "below");

    // The panel's edge is dragged to its narrowest.
    boxes.room = new DOMRect(744, 0, 280, 768);
    boxes.chip = new DOMRect(764, 300, 130, 28);
    act(() => relayout());
    assert.deepEqual(placeOf(layer()), { side: "below", left: 752 - 764, width: 264 });
  } finally {
    restore();
  }
});

test("in a full-screen panel whose composer keeps to a centred column, each popover is positioned against the box holding its own button, never the padded composer, so it stands over its button and not at the panel's edge", async () => {
  // The sheets that position the composer, its chips, and their layers, which jsdom does not load on its own.
  const sheet = document.createElement("style");
  sheet.textContent = ["desktop.css", "planning.css"]
    .map((name) => readFileSync(join(import.meta.dirname, "..", "styles", name), "utf8"))
    .join("\n");
  document.head.append(sheet);
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.container.classList.add("side-panel-content");
  tab.container.setAttribute("data-popover-room", "");
  await tab.stand({ context: CONTEXT });
  const chip = tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button");
  const ring = tab.container.querySelector<HTMLButtonElement>('button[aria-label="Context usage"]');
  assert.ok(chip && ring);
  // A 1400px full-screen panel, its centred column's foot holding the chip and the ring far from either edge of the window.
  const boxes = {
    room: new DOMRect(0, 0, 1400, 800),
    chip: new DOMRect(640, 730, 130, 28),
    ring: new DOMRect(774, 730, 28, 28),
    height: 320,
  };
  /** The class of the box a layer's left and bottom are measured from: its nearest positioned ancestor. */
  const positionedFrom = (layer: Element) => {
    for (let at = layer.parentElement; at !== null; at = at.parentElement) {
      if (getComputedStyle(at).position !== "static") return at.className;
    }
    return undefined;
  };
  const restore = measureBoxes(boxes);
  try {
    act(() => chip.click());
    const menu = tab.container.querySelector(".anchored-popover");
    assert.ok(menu);
    assert.equal(getComputedStyle(menu).position, "absolute");
    assert.equal(positionedFrom(menu), "agent-model-chip", "measured from the chip's own box");
    assert.deepEqual(placeOf(menu), { side: "above", left: 130 - 340, width: 340 });
    act(() => chip.click());

    act(() => ring.click());
    const popover = tab.container.querySelector(".anchored-popover");
    assert.ok(popover);
    assert.equal(positionedFrom(popover), "agent-context", "measured from the ring's own box");
    assert.deepEqual(placeOf(popover), { side: "above", left: 28 - 340, width: 340 });
  } finally {
    restore();
    sheet.remove();
  }
});

/** A file as the system's picker, the clipboard, or a drag hands one over. */
function file(name: string, bytes: readonly number[] | Uint8Array, type = ""): File {
  return new File([Uint8Array.from(bytes)], name, { type });
}

/** A PNG's signature, which is all a thumbnail here needs. */
const PNG = file("design.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png");

/** A Markdown file: "# Notes" in UTF-8, under a type the picker leaves empty. */
const NOTES = file("notes.md", [0x23, 0x20, 0x4e, 0x6f, 0x74, 0x65, 0x73]);

test('"Attach files" is the "+" at the foot\'s left, opening the system\'s picker: picked files stand as chips over the words, one that cannot come says why, and the send carries them, draws them on its line at once, and brings them back with the words when it did not go', async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  assert.equal(
    tab.container.querySelector(".agent-composer-attach")?.closest(".agent-composer-actions"),
    null,
    "the + stands at the foot's left, apart from the presses at its right",
  );
  const picker = tab.container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(picker);
  let opened = 0;
  picker.click = () => {
    opened += 1;
  };
  act(() => tab.container.querySelector<HTMLButtonElement>(".agent-composer-attach")?.click());
  assert.equal(opened, 1);

  await tab.pickFiles([PNG, NOTES, file("tool.bin", [0x00, 0x01, 0x02])]);
  await tab.landed(() => assert.deepEqual(tab.chips(), ["design.png", "notes.md1 KB"]));
  assert.equal(tab.note(), "tool.bin can't be attached. Attach images, PDFs, or text files.");

  tab.unattach("notes.md");
  assert.deepEqual(tab.chips(), ["design.png"]);
  assert.equal(tab.note(), undefined);
  tab.type("Match this design.");
  tab.key({ key: "Enter" });
  const shot = { name: "design.png", mediaType: "image/png", data: "iVBORw0KGgo=" };
  assert.deepEqual(tab.sends[0]?.attachments, [shot]);
  assert.deepEqual(tab.chips(), []);
  assert.deepEqual(tab.sentChips(), ["design.png"]);

  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
  assert.equal(tab.field().value, "Match this design.");
  assert.deepEqual(tab.chips(), ["design.png"]);
  assert.deepEqual(tab.sentChips(), []);
  const retry = tab.retry();
  assert.ok(retry);
  act(() => retry.click());
  assert.deepEqual(tab.sends[1]?.attachments, [shot]);
  assert.equal(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
});

test("files alone are a message: Send stands under the box's own placeholder with no words written, Enter sends them, and the line draws only their chips, with no empty bubble beside them", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  const placeholder = tab.field().placeholder;
  await tab.pickFiles([PNG]);
  await tab.landed(() => assert.deepEqual(tab.chips(), ["design.png"]));
  assert.equal(tab.field().placeholder, placeholder);
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });

  tab.key({ key: "Enter" });
  assert.deepEqual(
    tab.sends.map(({ text, attachments }) => ({ text, attachments })),
    [
      {
        text: "",
        attachments: [{ name: "design.png", mediaType: "image/png", data: "iVBORw0KGgo=" }],
      },
    ],
  );
  assert.deepEqual(tab.sentChips(), ["design.png"]);
  const line = [...tab.container.querySelectorAll('[role="log"] .is-user')].at(-1);
  assert.deepEqual(
    [...(line?.children ?? [])].map((each) => each.getAttribute("aria-label")),
    ["Attached files"],
  );
});

test("an image pasted into the box is taken, while any other paste is left to the browser, and files dropped on the card are taken, the card lighting as the drop target while they are over it", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(await tab.paste([PNG]), false);
  await tab.landed(() => assert.deepEqual(tab.chips(), ["design.png"]));
  assert.equal(await tab.paste([NOTES]), true);
  assert.equal(await tab.drop([NOTES]), true);
  await tab.landed(() => assert.deepEqual(tab.chips(), ["design.png", "notes.md1 KB"]));
});

test("a message holds ten files, and an empty file and a PDF past its bound are refused, each saying why under the card while the files that fit still come", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  await tab.pickFiles([file("empty.txt", [])]);
  await tab.landed(() => assert.equal(tab.note(), "empty.txt is empty."));
  assert.deepEqual(tab.chips(), []);
  await tab.pickFiles([
    file("big.pdf", new Uint8Array(CODING_AGENT_BOUNDS.MAX_PDF_BYTES + 1), "application/pdf"),
  ]);
  await tab.landed(() => assert.equal(tab.note(), "big.pdf is too large to attach."));
  assert.deepEqual(tab.chips(), []);
  const many = Array.from({ length: CODING_AGENT_BOUNDS.MAX_ATTACHMENTS + 1 }, (_, index) =>
    file(`note-${String(index)}.txt`, [0x68, 0x69]),
  );
  await tab.pickFiles(many);
  await tab.landed(() => assert.equal(tab.chips().length, CODING_AGENT_BOUNDS.MAX_ATTACHMENTS));
  assert.equal(tab.note(), "A message can carry up to 10 files.");
});

test("the developer's row read back from the service draws its files over the bubble: an image as its thumbnail, any other file by its name and size, and one the service kept no bytes of by its name; a press on one opens it", () => {
  const tab = mount({
    status: CODING_AGENT_STATUS.COMPLETED,
    messages: [
      PLAN,
      {
        id: "m-files",
        role: "user",
        parts: [
          { type: "text", text: "Read these." },
          {
            type: "file",
            mediaType: "image/png",
            filename: "shot.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "spec.pdf",
            url: `data:application/pdf;base64,${"A".repeat(2_000_000)}`,
          },
          { type: "file", mediaType: "image/png", filename: "staged.png", url: "" },
        ],
      },
    ],
  });
  assert.deepEqual(tab.sentChips(), ["shot.png", "spec.pdf1.5 MB", "staged.png"]);
  assert.deepEqual(tab.bubbles().at(-1)?.endsWith("Read these."), true);

  // A sent file opens over the window from its chip, as one in the box does.
  act(() =>
    tab.container
      .querySelector<HTMLButtonElement>('[role="log"] button[aria-label="Open spec.pdf"]')
      ?.click(),
  );
  const viewer = document.querySelector('[role="dialog"]');
  assert.equal(viewer?.querySelector("h2")?.textContent, "spec.pdf");
  assert.ok(viewer?.querySelector('button[aria-label="Download"]'));
});

test("files are taken after whatever the box holds as their read lands: two hand-offs read at once both stand, a chip taken off while another file is read stays off, and Send waits while a file is still being read", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  tab.type("Look at these.");
  await tab.pickFiles([PNG]);
  // The screenshot is still being read, so the words wait for it rather than going without it.
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
  await tab.pickFiles([NOTES]);
  await tab.landed(() => assert.deepEqual([...tab.chips()].sort(), ["design.png", "notes.md1 KB"]));
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });

  tab.unattach("design.png");
  await tab.pickFiles([file("shot.png", [0x89, 0x50, 0x4e, 0x47], "image/png")]);
  tab.unattach("notes.md");
  await tab.landed(() => assert.deepEqual(tab.chips(), ["shot.png"]));
});
