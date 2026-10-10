// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentTabView } from "./agent-tab";
import { useAgentModel } from "./use-agent-model";

/**
 * The model chip at the agent box's foot: it names what the agent runs on,
 * its menu is the Start button's (held in ../desktop/start-agent-button.test.ts),
 * a choice is drawn at once and sent for the agent alone, and a refusal
 * takes it off again with why under the box.
 */

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high", "max"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "xhigh"],
  },
];

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
};

/** One change sent, held until the test answers it. */
interface Sent {
  agentId: string;
  choice: ModelChoice;
  answer: (answer: CodingAgentAgentAnswer) => void;
}

const roots: Root[] = [];
const ignore = () => undefined;

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

/** The tab mounted over a scripted service: every change is held until the test answers it, and the agent is whatever the list last heard. */
function mount(initial: CodingAgentSummary) {
  const sends: Sent[] = [];
  const reads: number[] = [];
  let restand: ((next: CodingAgentSummary) => void) | undefined;
  function Probe() {
    const [agent, setAgent] = useState(initial);
    restand = setAgent;
    const model = useAgentModel({
      agent,
      choose: (agentId, choice) =>
        new Promise((answer) => {
          sends.push({ agentId, choice, answer });
        }),
    });
    return createElement(AgentTabView, {
      agent,
      models: MODELS,
      readModels: () => reads.push(1),
      transcript: {
        messages: [],
        failure: undefined,
        reading: false,
        failed: false,
        onRetry: ignore,
      },
      composer: {
        draft: "",
        setDraft: ignore,
        sending: false,
        note: undefined,
        closed: undefined,
        send: ignore,
        retry: ignore,
        sent: [],
      },
      model,
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
      onStop: () => Promise.resolve(),
      openGitHub: ignore,
      copyText: () => Promise.resolve(),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const chip = (): HTMLButtonElement => {
    const found = container.querySelector<HTMLButtonElement>(
      ".agent-model-chip .plan-compose-chip",
    );
    assert.ok(found, "the chip is drawn");
    return found;
  };
  return {
    container,
    sends,
    reads,
    chip,
    label: () => chip().querySelector(".plan-compose-chip-name")?.textContent,
    open: async () => {
      act(() => chip().click());
      await settle();
      const menu = container.querySelector<HTMLElement>(".agent-model-menu");
      assert.ok(menu, "the menu opened");
      return menu;
    },
    answer: async (index: number, answer: CodingAgentAgentAnswer) => {
      const sent = sends[index];
      assert.ok(sent, `change ${index} was sent`);
      await act(async () => {
        sent.answer(answer);
        await Promise.resolve();
      });
      await settle();
    },
    stand: async (next: CodingAgentSummary) => {
      act(() => restand?.(next));
      await settle();
    },
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
  };
}

test("the chip names the agent's model and effort under its provider's mark, with Fast where the agent runs the fast version, and opens the model menu above it with the agent's choice checked", async () => {
  const tab = mount(AGENT);
  assert.equal(tab.label(), "Claude Opus 5.5 · High");
  assert.ok(tab.chip().querySelector("svg.provider-mark"));
  assert.deepEqual(tab.reads, [1], "the catalog is read as the chip mounts");

  await tab.stand({ ...AGENT, model: "anthropic/claude-opus-5.5-fast", effort: "low" });
  assert.equal(tab.label(), "Claude Opus 5.5 · Low · Fast");

  const menu = await tab.open();
  assert.deepEqual(tab.reads, [1, 1], "and again as the menu opens");
  const checked = menu.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.querySelector(".plan-compose-menu-name")?.textContent, "Claude Opus 5.5");
  assert.equal(checked?.querySelector(".plan-compose-menu-detail")?.textContent, "Low · Fast");
  assert.equal(
    menu.querySelector('.plan-compose-menu-foot [role="switch"]')?.getAttribute("aria-checked"),
    "true",
  );
  assert.deepEqual(tab.sends, [], "opening changes nothing");
});

test("a pick is drawn on the chip at once and sent for this agent; the service's answer is what the chip then reads, and a refusal takes the pick off again with why under the box", async () => {
  const tab = mount(AGENT);
  const menu = await tab.open();
  act(() => menu.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  assert.equal(tab.container.querySelector(".agent-model-menu"), null, "the menu closed");
  assert.equal(tab.label(), "GPT-6.1 Sol · Low", "drawn before the service answers");
  assert.deepEqual(
    tab.sends.map(({ agentId, choice }) => [agentId, choice]),
    [[AGENT.id, { model: "openai/gpt-6.1-sol", effort: "low" }]],
  );

  const chosen = { ...AGENT, model: "openai/gpt-6.1-sol", effort: "low" };
  await tab.answer(0, { agent: chosen });
  await tab.stand(chosen);
  assert.equal(tab.label(), "GPT-6.1 Sol · Low");
  assert.equal(tab.note(), undefined);

  const again = await tab.open();
  act(() => again.querySelectorAll<HTMLElement>('[role="option"]')[0]?.click());
  assert.equal(tab.label(), "Claude Opus 5.5 · Low");
  await tab.answer(1, { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE });
  assert.equal(tab.label(), "GPT-6.1 Sol · Low", "rolled back to what the agent runs on");
  assert.match(tab.note() ?? "", /isn't offered any more/u);
  assert.equal(
    tab.container.querySelector('[role="alert"] button'),
    null,
    "no Retry: the chip is the retry",
  );
});
