// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@sidecar/features/coding-agent-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { ChangesCard } from "../planning/agent-changes-tab";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { changesOffers, changesTabOf } from "./side-panel";

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

test("a Changes card names the coding agent whose pull request it is, wearing its glyph, under the pull request", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(ChangesCard, {
      agent: THIRD,
      agentLabel: "Expiry job",
      pullRequest: pullRequest(42, "Expire invitations"),
    }),
  );
  assert.equal(page.querySelector(".card-name")?.textContent, "Expire invitations");
  assert.equal(page.querySelector(".card-corner")?.textContent, "#42");
  const named = page.querySelector(".card-sub");
  assert.equal(named?.textContent, "Expiry job");
  assert.ok(named?.querySelector(".state-glyph svg"), "the agent's glyph, as its tab wears it");
  assert.match(page.querySelector(".card-note")?.textContent ?? "", /^6 files changed/);
});
