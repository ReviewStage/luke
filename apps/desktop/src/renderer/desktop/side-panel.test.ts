// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { ChangesCard } from "../planning/agent-changes-tab";
import { agentSubject, NOTHING_HELD } from "../planning/agent-ref";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ADD_SECTION, changesOffers, changesTabOf, panelEntries } from "./side-panel";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent at rest on the plan, named by its title. */
function agent(id: string, title: string, createdAt: number): CodingAgentSummary {
  return {
    id,
    planId: PLAN,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

/** An open pull request, numbered. */
function pullRequest(number: number, title: string): CodingAgentPullRequest {
  return {
    number,
    title,
    url: `https://github.com/acme/relay/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  };
}

const FIRST = agent("8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", "Invite flow", 1);
const SECOND = agent("9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32", "Invite fixes", 2);
const THIRD = agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c", "Expiry job", 3);

/** The plan's agents, the first two on one pull request and the third on its own. */
function agents(): CodingAgentsControl {
  const shared = pullRequest(41, "Teammate invitations");
  return {
    ...plansControl().agents,
    agents: [FIRST, SECOND, THIRD],
    agentIds: [FIRST.id, SECOND.id, THIRD.id],
    pullRequests: new Map([
      [FIRST.id, shared],
      [SECOND.id, shared],
      [THIRD.id, pullRequest(42, "Expire invitations")],
    ]),
  };
}

test('an agent\'s Changes chip opens the one tab the "+" offers for its pull request', () => {
  const control = agents();
  const offered = changesOffers(control).map((offer) => ({ changes: offer.agentId }));
  assert.deepEqual(offered, [{ changes: FIRST.id }, { changes: THIRD.id }]);
  // The second agent shares the first's pull request, so its chip opens the first's tab.
  assert.deepEqual(
    [FIRST, SECOND, THIRD].map((each) => changesTabOf(control, each.id, [])),
    [{ changes: FIRST.id }, { changes: FIRST.id }, { changes: THIRD.id }],
  );
  // An agent whose pull request is not held yet opens its own.
  assert.deepEqual(changesTabOf({ ...control, pullRequests: new Map() }, SECOND.id, []), {
    changes: SECOND.id,
  });
});

test('the "+" offers each pull request once as a Pull request tab, under the agent its Changes tab stands for, found by its title and number', () => {
  const control = agents();
  const panel = plansControl().sidePanel;
  const chosen: unknown[] = [];
  const entries = panelEntries({
    panel: { ...panel, onChoose: (tab) => chosen.push(tab) },
    kinds: [],
    workers: [],
    files: [],
    changes: changesOffers(control),
  }).filter((entry) => entry.row.section === ADD_SECTION.PULL_REQUESTS);
  assert.deepEqual(
    entries.map((entry) => [entry.row.label, entry.row.detail, entry.row.terms]),
    [
      [
        "Pull request: Invite flow",
        "#41",
        ["Pull request: Invite flow", "Teammate invitations", "#41"],
      ],
      [
        "Pull request: Expiry job",
        "#42",
        ["Pull request: Expiry job", "Expire invitations", "#42"],
      ],
    ],
  );
  for (const entry of entries) entry.onPick();
  assert.deepEqual(chosen, [{ pullRequest: FIRST.id }, { pullRequest: THIRD.id }]);
});

test("a shared pull request whose later agent's tab opened before the earlier agent's read landed keeps that one tab", () => {
  // Read apart, the later agent's snapshot of the shared pull request is the newer one.
  const newer = { ...pullRequest(41, "Teammate invitations, with expiry"), changedFiles: 9 };
  const read = agents();
  const control = { ...read, pullRequests: new Map([...read.pullRequests, [SECOND.id, newer]]) };
  const open = [{ changes: SECOND.id }];
  assert.deepEqual(
    [FIRST, SECOND].map((each) => changesTabOf(control, each.id, open)),
    [{ changes: SECOND.id }, { changes: SECOND.id }],
  );
  assert.deepEqual(
    changesOffers(control, open).map((offer) => [
      offer.agentId,
      offer.label,
      offer.pullRequest.title,
    ]),
    [
      [SECOND.id, "Invite fixes", "Teammate invitations, with expiry"],
      [THIRD.id, "Expiry job", "Expire invitations"],
    ],
  );
});

test("a Changes card names the coding agent whose pull request it is by its tile and name, which hang the agent's card and open its tab", async () => {
  const opened: string[] = [];
  const control = agents();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ChangesCard, {
          subject: agentSubject(control, THIRD.id, NOTHING_HELD, false),
          models: [],
          pullRequest: pullRequest(42, "Expire invitations"),
          people: undefined,
          onOpenAgent: () => opened.push(THIRD.id),
        }),
      ),
    ),
  );
  assert.equal(container.querySelector(".card-name")?.textContent, "Expire invitations");
  assert.equal(container.querySelector(".card-corner")?.textContent, "#42");
  assert.match(container.querySelector(".card-note")?.textContent ?? "", /^6 files changed/);
  const named = container.querySelector<HTMLButtonElement>(
    '.card-sub button.actor-ref[data-kind="agent"]',
  );
  assert.ok(named, "the agent is named as an actor");
  assert.equal(named.textContent, "Expiry job");
  assert.ok(named.querySelector('.actor-mark[data-kind="agent"]'), "the agent wears its tile");

  await act(async () => {
    named.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await Promise.resolve();
  });
  const card = document.querySelector(".tooltip-card [data-tab-card] .card-name");
  assert.equal(card?.textContent, "Expiry job", "the agent's own card hangs from its name");
  act(() => named.click());
  assert.deepEqual(opened, [THIRD.id]);
  act(() => root.unmount());
  container.remove();
});
