// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { useAgentTakeOver } from "./agent-take-over.js";

/**
 * agent-take-over.test.ts -- a teammate's agent offers Take over, which asks
 * first, saying what it does, and takes the agent over only once confirmed;
 * a refusal keeps the question up saying why; one still working asks to
 * stop and take over; and the reader's own agent, one whose starter the
 * window cannot tell, and one on an archived task offer none.
 */

const ME = "user-me";

const TEAMMATE = { userId: "user-dean", name: "Dean" };

const AGENT: CodingAgentSummary = {
  id: "agent-8",
  planId: "plan-1",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix refresh on wake",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: TEAMMATE,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The menu's item as a button, where it is offered, and the question beside it. */
function TakeOverHarness({
  agent,
  agents,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
}): React.JSX.Element {
  const takeOver = useAgentTakeOver(agent, agents, true);
  return createElement(
    "div",
    null,
    takeOver.action === undefined
      ? null
      : createElement(
          "button",
          { type: "button", "data-item": "", onClick: takeOver.action.onSelect },
          takeOver.action.label,
        ),
    takeOver.dialog,
  );
}

/** The harness drawn for the agent, the take-overs it asked written down. */
function drawn(agent: CodingAgentSummary, overrides: Partial<CodingAgentsControl> = {}) {
  const asked: string[] = [];
  const agents = codingAgentsControl({
    me: ME,
    onTakeOver: (agentId): Promise<ActionResult> => {
      asked.push(agentId);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(onRegistry(AtomRegistry.make(), createElement(TakeOverHarness, { agent, agents }))),
  );
  const item = container.querySelector<HTMLButtonElement>("[data-item]");
  return { asked, item };
}

/** The button of the open question that says these words. */
function dialogButton(words: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find(
    (button) => button.textContent === words,
  );
}

test("a teammate's agent asks first, saying what taking it over does, and is taken over once confirmed", async () => {
  const { asked, item } = drawn(AGENT, {
    pullRequests: new Map([
      [
        AGENT.id,
        {
          number: 812,
          title: "Fix refresh on wake",
          url: "https://github.com/acme/relay/pull/812",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 12,
          deletions: 3,
          changedFiles: 2,
        },
      ],
    ]),
  });
  assert.ok(item, "Take over is offered");
  act(() => item.click());

  const said = document.querySelector("[role=alertdialog]")?.textContent ?? "";
  assert.match(said, /Take over “Fix refresh on wake”\?/u);
  assert.match(said, /your model keys/u);
  assert.match(said, /keeps pushing to #812, which stays opened by Dean on GitHub/u);
  assert.match(said, /Dean's agent is archived/u);
  assert.deepEqual(asked, [], "nothing is taken over before the question is answered");

  await act(async () => dialogButton("Take over")?.click());
  assert.deepEqual(asked, [AGENT.id]);
});

test("a refused take-over keeps the question up saying why", async () => {
  const why = "Luke can't reach acme/relay on GitHub as you, so you can't take this agent over.";
  const { item } = drawn(AGENT, {
    onTakeOver: () => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: why }),
  });
  assert.ok(item);
  act(() => item.click());
  await act(async () => dialogButton("Take over")?.click());

  assert.equal(document.querySelector("[role=alertdialog] [role=alert]")?.textContent, why);
});

test("an agent still working asks to stop and take over", () => {
  const { item } = drawn({ ...AGENT, status: CODING_AGENT_STATUS.RUNNING });
  assert.ok(item);
  act(() => item.click());

  assert.ok(dialogButton("Stop and take over"));
});

test("the reader's own agent, one whose starter is not known, and one on an archived task offer no take-over", () => {
  assert.equal(drawn({ ...AGENT, startedBy: { userId: ME, name: "Me" } }).item, null);
  const { startedBy: _, ...unknown } = AGENT;
  assert.equal(drawn(unknown).item, null);
  assert.equal(drawn(AGENT, { onTakeOver: undefined }).item, null);
});
