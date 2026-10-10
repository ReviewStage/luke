// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, type ActKind, type ActPayload, type ActResultFor } from "#shared/messages/acts";
import { MODEL_CHANGE_FAILED, START_NEEDS_REPOSITORY } from "./coding-agent-model";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const STARTED: CodingAgentSummary = {
  id: AGENT,
  planId: PLAN,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1,
  status: CODING_AGENT_STATUS.STARTING,
  turnId: null,
};

interface Standing {
  planId: string | undefined;
  repository: string | null;
}

/** One act as the hook asked it. */
interface Asked {
  kind: ActKind;
  payload: unknown;
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

/**
 * Mounts the hook over a service the test scripts act by act: each kind
 * answers from its own queue of answers, and every ask is written down.
 */
function mount(initial: Standing) {
  const asked: Asked[] = [];
  const started: string[] = [];
  const answers = new Map<ActKind, unknown[]>();
  let keys = 0;
  let control: CodingAgentsControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    control = useCodingAgents({
      acts: {
        act: <Kind extends ActKind>(
          kind: Kind,
          ...[payload]: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          asked.push({ kind, payload });
          const queue = answers.get(kind);
          const next = queue?.shift();
          if (next === undefined) return Promise.reject(new Error("Not answered in this test."));
          // SAFETY: the test scripts each kind's answer in that kind's own shape.
          return Promise.resolve(next as ActResultFor<Kind>);
        },
      },
      planId: held.planId,
      repository: held.repository,
      onStarted: (agentId) => started.push(agentId),
      mintKey: () => {
        keys += 1;
        return `key-${keys}`;
      },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  return {
    asked,
    started,
    /** Queues the answers one kind gives, in order. */
    answer: (kind: ActKind, ...queued: unknown[]) => {
      answers.set(kind, [...(answers.get(kind) ?? []), ...queued]);
    },
    mount: async () => {
      act(() => root.render(createElement(Probe)));
      await settle();
    },
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: async (next: Partial<Standing>) => {
      act(() => restand?.({ ...initial, ...next }));
      await settle();
    },
  };
}

/** The Starts the hook asked, each with the payload its kind takes. */
function startPayloads(
  asked: readonly Asked[],
): readonly ActPayload<typeof ACT_KIND.CODING_AGENTS_START>[] {
  const starts = asked.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_START);
  // SAFETY: an ask recorded under the Start kind carries the payload the hook built for that kind.
  return starts.map((each) => each.payload as ActPayload<typeof ACT_KIND.CODING_AGENTS_START>);
}

test("the agents are read when a plan opens, and a plan without a repository has Start unavailable with its reason", async () => {
  const tab = mount({ planId: PLAN, repository: null });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await tab.mount();

  assert.deepEqual(
    tab.asked.map((each) => each.kind),
    [ACT_KIND.CODING_AGENTS_LIST],
  );
  assert.deepEqual(tab.control().agentIds, [AGENT]);
  assert.equal(tab.control().start.available, false);
  assert.equal(tab.control().start.reason, START_NEEDS_REPOSITORY);

  act(() => tab.control().start.onPress());
  await settle();
  assert.deepEqual(startPayloads(tab.asked), []);
});

test("a press mints one key, a press asked again after no answer carries the same key, and a press of another choice mints its own", async () => {
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [STARTED] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: STARTED },
    { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE },
    { agent: STARTED },
  );
  await tab.mount();

  act(() => tab.control().start.onPress());
  await settle();
  assert.equal(tab.control().start.note, "The agent could not be started. Try again.");
  act(() => tab.control().start.onPress());
  await settle();
  assert.deepEqual(startPayloads(tab.asked), [
    { planId: PLAN, idempotencyKey: "key-1" },
    { planId: PLAN, idempotencyKey: "key-1" },
  ]);
  assert.deepEqual(tab.started, [AGENT]);
  assert.equal(tab.control().start.note, undefined);
  // The list is read again once the Start landed.
  assert.equal(tab.asked.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_LIST).length, 2);

  // A refusal the service worded is not asked again under its key, and another choice is another press.
  const choice = { model: "openai/gpt-6.1-sol", effort: "xhigh" };
  act(() => tab.control().start.onPress(choice));
  await settle();
  assert.equal(tab.control().start.note, "That model isn't offered any more. Choose another.");
  act(() => tab.control().start.onPress(choice));
  await settle();
  assert.deepEqual(startPayloads(tab.asked).slice(2), [
    { planId: PLAN, idempotencyKey: "key-2", ...choice },
    { planId: PLAN, idempotencyKey: "key-3", ...choice },
  ]);
});

test("a second press before the first is answered starts nothing more", async () => {
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [STARTED] });
  tab.answer(ACT_KIND.CODING_AGENTS_START, { agent: STARTED });
  await tab.mount();

  // Two clicks are two discrete events, each flushed before the next, so the second finds the first under way.
  act(() => tab.control().start.onPress());
  act(() => tab.control().start.onPress());
  await settle();
  assert.deepEqual(startPayloads(tab.asked), [{ planId: PLAN, idempotencyKey: "key-1" }]);
  assert.deepEqual(tab.started, [AGENT]);
});

test("a Stop reads the list again, a read that fails keeps the agents drawn, a page's status moves the agent's dot, and leaving the plan drops its agents", async () => {
  const running = { ...STARTED, status: CODING_AGENT_STATUS.RUNNING };
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [running] });
  tab.answer(ACT_KIND.CODING_AGENTS_STOP, {
    agent: { ...running, status: CODING_AGENT_STATUS.CANCELLED },
  });
  await tab.mount();

  act(() => tab.control().onStatus(AGENT, CODING_AGENT_STATUS.COMPLETED));
  assert.equal(tab.control().agents?.[0]?.status, CODING_AGENT_STATUS.COMPLETED);

  await act(async () => {
    await tab.control().onStop(AGENT);
  });
  await settle();
  assert.deepEqual(
    tab.asked.map((each) => each.kind),
    [ACT_KIND.CODING_AGENTS_LIST, ACT_KIND.CODING_AGENTS_STOP, ACT_KIND.CODING_AGENTS_LIST],
  );
  // The read after the Stop was not answered: the agents already drawn stand, as cancelled.
  assert.equal(tab.control().listFailed, true);
  assert.equal(tab.control().agents?.[0]?.status, CODING_AGENT_STATUS.CANCELLED);

  await tab.stand({ planId: undefined });
  assert.equal(tab.control().agents, undefined);
  assert.equal(tab.control().start.available, false);
  assert.equal(tab.control().start.reason, undefined);
});

test("a message carries the agent, the words, and their delivery, and the agent's status takes the answer; a refusal is handed back as it is", async () => {
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, {
    agents: [{ ...STARTED, status: CODING_AGENT_STATUS.COMPLETED }],
  });
  tab.answer(
    ACT_KIND.CODING_AGENTS_MESSAGE,
    { agent: { ...STARTED, status: CODING_AGENT_STATUS.RUNNING } },
    { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY },
  );
  await tab.mount();

  let answer = await tab.control().onMessage(AGENT, "Also expire them after a week.", "send-1");
  await settle();
  assert.deepEqual(answer, { agent: { ...STARTED, status: CODING_AGENT_STATUS.RUNNING } });
  assert.deepEqual(tab.asked[1], {
    kind: ACT_KIND.CODING_AGENTS_MESSAGE,
    payload: { agentId: AGENT, text: "Also expire them after a week.", clientKey: "send-1" },
  });
  assert.equal(tab.control().agents?.[0]?.status, CODING_AGENT_STATUS.RUNNING);

  answer = await tab.control().onMessage(AGENT, "And tests.", "send-2");
  await settle();
  assert.deepEqual(answer, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
  // Nothing was read again: the answer is the status, and a refusal is none.
  assert.equal(tab.asked.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_LIST).length, 1);
  assert.equal(tab.control().agents?.[0]?.status, CODING_AGENT_STATUS.RUNNING);

  // A service that never answered reads as unanswered.
  answer = await tab.control().onMessage(AGENT, "Hello?", "send-3");
  assert.deepEqual(answer, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
});

test("a Start that lands after the developer left the plan opens no tab on the plan now open", async () => {
  const other = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [] });
  tab.answer(ACT_KIND.CODING_AGENTS_START, { agent: STARTED });
  await tab.mount();

  // The plan changes before the Start's answer, already on its way, is heard.
  act(() => tab.control().start.onPress());
  await tab.stand({ planId: other });

  assert.deepEqual(tab.started, []);
  assert.deepEqual(tab.control().agents, []);
});

test("a choice written as the default is asked of the service as given, and one that did not take is said beside Start until the next", async () => {
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_DEFAULT_WRITE,
    { choice: { model: "anthropic/claude-opus-5.5", effort: "max" } },
    { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE },
    { choice: { model: "openai/gpt-6.1-sol", effort: "low" } },
  );
  await tab.mount();

  const written = await tab.control().writeDefault({
    model: "anthropic/claude-opus-5.5",
    effort: "max",
  });
  await settle();
  assert.deepEqual(written, { choice: { model: "anthropic/claude-opus-5.5", effort: "max" } });
  assert.deepEqual(
    tab.asked
      .filter((each) => each.kind === ACT_KIND.CODING_AGENTS_DEFAULT_WRITE)
      .map((each) => each.payload),
    [{ model: "anthropic/claude-opus-5.5", effort: "max" }],
  );
  assert.equal(tab.control().start.note, undefined);

  const refused = await tab.control().writeDefault({ model: "openai/gpt-6.1-sol", effort: "low" });
  await settle();
  assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE });
  assert.equal(tab.control().start.note, MODEL_CHANGE_FAILED);

  // The next write that takes clears the note; a service that never answered reads as unanswered.
  await tab.control().writeDefault({ model: "openai/gpt-6.1-sol", effort: "low" });
  await settle();
  assert.equal(tab.control().start.note, undefined);
  const unanswered = await tab
    .control()
    .writeDefault({ model: "openai/gpt-6.1-sol", effort: "low" });
  await settle();
  assert.deepEqual(unanswered, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(tab.control().start.note, MODEL_CHANGE_FAILED);
});

test("a change of an agent's model asks the service for that agent alone, and the agent it answers takes its place in the list", async () => {
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  const chosen = { ...STARTED, model: "openai/gpt-6.1-sol", effort: "low" };
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  tab.answer(ACT_KIND.CODING_AGENTS_CHOOSE, { agent: chosen });
  await tab.mount();

  const answer = await tab.control().onChoose(AGENT, { model: chosen.model, effort: "low" });
  await settle();
  assert.deepEqual(answer, { agent: chosen });
  assert.deepEqual(tab.asked.at(-1), {
    kind: ACT_KIND.CODING_AGENTS_CHOOSE,
    payload: { agentId: AGENT, model: "openai/gpt-6.1-sol", effort: "low" },
  });
  assert.deepEqual(tab.control().agents, [chosen]);

  // Two changes answered out of order: the one made last is what stands, whichever answers first.
  let answerFirst: ((answer: CodingAgentAgentAnswer) => void) | undefined;
  const first = new Promise<CodingAgentAgentAnswer>((resolve) => {
    answerFirst = resolve;
  });
  const last = { ...chosen, effort: "high" };
  tab.answer(ACT_KIND.CODING_AGENTS_CHOOSE, first, { agent: last });
  const older = tab.control().onChoose(AGENT, { model: chosen.model, effort: "medium" });
  await tab.control().onChoose(AGENT, { model: chosen.model, effort: "high" });
  answerFirst?.({ agent: { ...chosen, effort: "medium" } });
  await older;
  await settle();
  assert.deepEqual(tab.control().agents, [last]);
});
