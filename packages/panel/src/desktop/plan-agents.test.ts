// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { agentsControl } from "../testing/tasks-control.js";
import { PlanAgents } from "./plan-agents.js";

/**
 * plan-agents.test.ts -- the plan's agents list those at work first, then
 * the newest started; a row opens its agent, its pull request's chip opens
 * the pull request and not the agent, and a task with no agent draws no
 * list; on a phone the group ends with New agent, even on a task with no
 * agent, and the task's Inbox follows it only while something waits there,
 * on a task that starts no agent too.
 * Synthetic agents throughout.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent of the plan, started at `createdAt`, standing at `status`. */
function agent(id: string, title: string, createdAt: number, status: AgentSummary["status"]) {
  return {
    id,
    planId: PLAN,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status,
    turnId: null,
  } satisfies AgentSummary;
}

const OLDEST = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d21",
  "Research providers",
  1,
  AGENT_STATUS.COMPLETED,
);
const WORKING = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d22",
  "Expired invite page",
  2,
  AGENT_STATUS.RUNNING,
);
const NEWEST = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d23",
  "Invite email",
  3,
  AGENT_STATUS.COMPLETED,
);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The group over `agents`, `NEWEST` holding a merged pull request, unfolded unless `folded` says; every agent and pull request it opens recorded. */
function mount(agents: readonly AgentSummary[], folded = false, waiting?: number, starts = true) {
  const opened: { agents: string[]; pullRequests: string[]; phone: string[] } = {
    agents: [],
    pullRequests: [],
    phone: [],
  };
  const control = agentsControl({
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
        tab: undefined,
        runsOn: undefined,
        folded,
        onOpenAgent: (agentId) => opened.agents.push(agentId),
        onOpenPullRequest: (agentId) => opened.pullRequests.push(agentId),
        phone:
          waiting === undefined
            ? undefined
            : {
                starts: starts
                  ? [{ label: "New agent", onSelect: () => opened.phone.push("new agent") }]
                  : [],
                archived: null,
                waiting,
                onOpenInbox: () => opened.phone.push("inbox"),
              },
      }),
    ),
  );
  return { host, opened };
}

test("the agents at work come first, then the newest, each saying where it runs, each row and chip opening its own", () => {
  const { host, opened } = mount([OLDEST, WORKING, NEWEST]);
  const list = host.querySelector('[aria-label="Agents"]');
  assert.ok(list !== null);
  const rows = [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
  assert.deepEqual(
    rows.map((row) => row.replace(/#42$/u, "")),
    ["Expired invite pageCloud", "Invite emailCloud", "Research providersCloud"],
  );
  const chip = host.querySelector<HTMLAnchorElement>(
    'a[href="https://github.com/acme/relay/pull/42"]',
  );
  assert.ok(chip !== null);
  act(() => chip.click());
  assert.deepEqual(opened, { agents: [], pullRequests: [NEWEST.id], phone: [] });
  const press = [...list.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(OLDEST.title),
  );
  assert.ok(press !== undefined);
  act(() => press.click());
  assert.deepEqual(opened.agents, [OLDEST.id]);
});

test("the group starts folded unless the page says otherwise, its head counting the agents", () => {
  const { host } = mount([OLDEST, WORKING, NEWEST], true);
  const head = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  assert.equal(head?.getAttribute("aria-expanded"), "false");
  assert.match(head?.textContent ?? "", /Agents3/u);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});

test("a task with no agent draws no list", () => {
  const { host } = mount([]);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});

test("on a phone the group ends with New agent even on a task with no agent, and the task's Inbox follows only while something waits there", () => {
  const press = (host: HTMLElement, words: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes(words),
    );
    assert.ok(found !== undefined, `the group offers ${words}`);
    act(() => found.click());
  };
  const none = mount([], false, 0);
  assert.match(none.host.querySelector('[aria-label="Agents"]')?.textContent ?? "", /New agent/u);
  assert.doesNotMatch(none.host.textContent ?? "", /need/u, "no Inbox row while nothing waits");
  press(none.host, "New agent");
  assert.deepEqual(none.opened.phone, ["new agent"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const waiting = mount([OLDEST], false, 2);
  press(waiting.host, "2 threads need you");
  assert.deepEqual(waiting.opened.phone, ["inbox"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // A task whose agents are all archived starts none, and its waiting threads still stand.
  const archived = mount([], false, 1, false);
  press(archived.host, "1 thread needs you");
  assert.deepEqual(archived.opened.phone, ["inbox"]);
});
