// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { PlanAgents } from "./plan-agents.js";

/**
 * plan-agents.test.ts -- the plan's agents list those at work first, then
 * the newest started; a row opens its agent, its pull request's chip opens
 * the pull request and not the agent, and a task with no agent draws no
 * list. Synthetic agents throughout.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent of the plan, started at `createdAt`, standing at `status`. */
function agent(id: string, title: string, createdAt: number, status: CodingAgentSummary["status"]) {
  return {
    id,
    planId: PLAN,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status,
    turnId: null,
  } satisfies CodingAgentSummary;
}

const OLDEST = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d21",
  "Research providers",
  1,
  CODING_AGENT_STATUS.COMPLETED,
);
const WORKING = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d22",
  "Expired invite page",
  2,
  CODING_AGENT_STATUS.RUNNING,
);
const NEWEST = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d23",
  "Invite email",
  3,
  CODING_AGENT_STATUS.COMPLETED,
);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The list over `agents`, `NEWEST` holding a merged pull request; every agent and pull request it opens recorded. */
function mount(agents: readonly CodingAgentSummary[]) {
  const opened: { agents: string[]; pullRequests: string[] } = { agents: [], pullRequests: [] };
  const control = codingAgentsControl({
    agents,
    agentIds: agents.map((each) => each.id),
    models: [],
    pullRequests: new Map([
      [
        NEWEST.id,
        {
          number: 42,
          title: "Send the invite email",
          url: "https://github.com/acme/relay/pull/42",
          state: PULL_REQUEST_STATE.MERGED,
          checks: CHECK_SUMMARY.PASSING,
          additions: 10,
          deletions: 2,
          changedFiles: 1,
        },
      ],
    ]),
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(PlanAgents, {
        agents: control,
        held: { agents: new Map(), workers: new Map() },
        main: {
          tab: undefined,
          onChoose: (tab: MainTab) => {
            if ("agent" in tab) opened.agents.push(tab.agent);
          },
        },
        onOpenPullRequest: (agentId) => opened.pullRequests.push(agentId),
      }),
    ),
  );
  return { host, opened };
}

test("the agents at work come first, then the newest, each row and chip opening its own", () => {
  const { host, opened } = mount([OLDEST, WORKING, NEWEST]);
  const list = host.querySelector('[aria-label="Agents"]');
  assert.ok(list !== null);
  const rows = [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
  assert.deepEqual(
    rows.map((row) => row.replace(/#42$/u, "")),
    ["Expired invite page", "Invite email", "Research providers"],
  );
  const chip = host.querySelector<HTMLAnchorElement>(
    'a[href="https://github.com/acme/relay/pull/42"]',
  );
  assert.ok(chip !== null);
  act(() => chip.click());
  assert.deepEqual(opened, { agents: [], pullRequests: [NEWEST.id] });
  const press = [...list.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(OLDEST.title),
  );
  assert.ok(press !== undefined);
  act(() => press.click());
  assert.deepEqual(opened.agents, [OLDEST.id]);
});

test("a task with no agent draws no list", () => {
  const { host } = mount([]);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});
