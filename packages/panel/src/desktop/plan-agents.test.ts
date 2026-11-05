// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { item } from "../testing/desktop-inbox.js";
import { agentsControl } from "../testing/tasks-control.js";
import { PlanAgents } from "./plan-agents.js";

/**
 * plan-agents.test.ts -- the plan's agents list those waiting on the
 * developer first, each naming the thread it waits in, then those at work,
 * then the newest started, each saying where it runs itself; a row opens its agent, its pull request's chip opens
 * the pull request and not the agent, and a task with no agent and no start
 * draws no list; the group ends with New agent, even on a task with no
 * agent, and on a phone the task's Inbox follows it only while something
 * waits there that no listed agent's row marks, on a task that starts no
 * agent too.
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

// Note that the oldest ran on a device since removed, and the one at work runs on the member's Studio.
const OLDEST = {
  ...agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d21", "Research providers", 1, AGENT_STATUS.COMPLETED),
  machine: AGENT_MACHINE.DEVICE,
} satisfies AgentSummary;
const WORKING = {
  ...agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d22", "Expired invite page", 2, AGENT_STATUS.RUNNING),
  machine: AGENT_MACHINE.DEVICE,
  mac: { name: "Studio", deviceId: "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11" },
} satisfies AgentSummary;
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

/** `count` threads of the agent given waiting on the developer, by that agent, as `waitingByAgent` hands them. */
function waitingOn(agentId: string, count: number): ReadonlyMap<string, readonly InboxItem[]> {
  const items = Array.from({ length: count }, (_, at) => ({
    ...item(`a1b2c3d4-0000-4000-8000-00000000000${at}`, `Which retry budget, ${at}?`, at),
    agentId,
  }));
  return new Map([[agentId, items]]);
}

/** The group over `agents`, `NEWEST` holding a merged pull request, unfolded unless `folded` says, offering New agent where `starts` says, a phone's where `phone` says; every agent, pull request, and start it opens recorded. */
function mount(
  agents: readonly AgentSummary[],
  {
    folded = false,
    starts = false,
    phone = false,
    waiting = new Map(),
  }: {
    folded?: boolean;
    starts?: boolean;
    phone?: boolean;
    waiting?: ReadonlyMap<string, readonly InboxItem[]>;
  } = {},
) {
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
        folded,
        waiting,
        onOpenAgent: (agentId) => opened.agents.push(agentId),
        onOpenPullRequest: (agentId) => opened.pullRequests.push(agentId),
        starts: starts
          ? [{ label: "New agent", onSelect: () => opened.phone.push("new agent") }]
          : [],
        phone: !phone
          ? undefined
          : {
              archived: null,
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
    ["Expired invite pageStudio", "Invite emailCloud", "Research providersRemoved device"],
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

test("an agent waiting on the developer comes first, naming the thread it waits in and that it needs them, and a phone's Inbox row leaves that thread to it", () => {
  const { host } = mount([OLDEST, WORKING, NEWEST], {
    phone: true,
    waiting: waitingOn(OLDEST.id, 1),
  });
  const rows = [...(host.querySelector('[aria-label="Agents"]')?.querySelectorAll("li") ?? [])];
  assert.deepEqual(
    rows.map((row) => row.textContent?.replace(/#42$/u, "")),
    [
      "Research providersNeeds youRemoved deviceWhich retry budget, 0?",
      "Expired invite pageStudio",
      "Invite emailCloud",
    ],
  );
  assert.doesNotMatch(host.textContent ?? "", /thread needs you/u, "no Inbox row says it again");
});

test("the group starts folded unless the page says otherwise, its head counting the agents", () => {
  const { host } = mount([OLDEST, WORKING, NEWEST], { folded: true });
  const head = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  assert.equal(head?.getAttribute("aria-expanded"), "false");
  assert.match(head?.textContent ?? "", /Agents3/u);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});

test("a task with no agent and no start draws no list", () => {
  const { host } = mount([]);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});

test("the group ends with New agent even on a task with no agent, and on a phone the task's Inbox follows only while something waits there", () => {
  const press = (host: HTMLElement, words: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes(words),
    );
    assert.ok(found !== undefined, `the group offers ${words}`);
    act(() => found.click());
  };
  const none = mount([], { starts: true, phone: true });
  assert.match(none.host.querySelector('[aria-label="Agents"]')?.textContent ?? "", /New agent/u);
  assert.doesNotMatch(none.host.textContent ?? "", /need/u, "no Inbox row while nothing waits");
  press(none.host, "New agent");
  assert.deepEqual(none.opened.phone, ["new agent"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // Note that the threads are an agent's the group does not list, an archived one's, so no row marks them.
  const waiting = mount([OLDEST], { starts: true, phone: true, waiting: waitingOn(NEWEST.id, 2) });
  press(waiting.host, "2 threads need you");
  assert.deepEqual(waiting.opened.phone, ["inbox"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // A task whose agents are all archived starts none, and its waiting threads still stand.
  const archived = mount([], { phone: true, waiting: waitingOn(NEWEST.id, 1) });
  press(archived.host, "1 thread needs you");
  assert.deepEqual(archived.opened.phone, ["inbox"]);
});
