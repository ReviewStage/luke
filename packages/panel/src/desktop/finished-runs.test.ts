import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type PullRequestState,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { describe, it } from "vitest";
import { type RunsHeld, withoutFinishedRuns } from "./finished-runs.js";

/**
 * finished-runs.test.ts -- an automation's finished run leaves the sidebar's Tasks unless something still holds it for the reader: it has not completed, ended unseen, waits on the reader in the Inbox, has its pull request open, or is the agent shown; an agent started by hand always stands.
 *
 * Synthetic agents throughout.
 */

const ME = "user-me";
const ADA = "user-ada";

/** An automation's run that finished, as the sidebar lists it. */
const RUN: TasklessAgent = {
  id: "4b2e7c1d-9a3f-4e6b-8c5d-1f0a2b3c4d5e",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Remove the stale copy",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a",
  automationName: "Copy sweep",
  workspaceId: "workspace-1",
  repository: "acme/relay",
  activityAt: 2,
};

/** The same agent started by hand, which names no automation. */
const { automationName: _automationName, ...UNNAMED } = RUN;
const BY_HAND: TasklessAgent = { ...UNNAMED, automationId: null };

/** Nothing holding any agent. */
const NOTHING_HELD: RunsHeld = { unseen: () => false, inbox: [], me: ME, shown: undefined };

/** The run's pull request in the state given. */
function withPullRequest(state: PullRequestState): TasklessAgent {
  return {
    ...RUN,
    pullRequest: {
      number: 42,
      title: "Remove the stale copy",
      url: "https://github.com/acme/relay/pull/42",
      state,
      checks: CHECK_SUMMARY.PASSING,
    },
  };
}

/** The ids that stand. */
function standing(agent: TasklessAgent, held: RunsHeld): readonly string[] {
  return withoutFinishedRuns([agent], held).map((each) => each.id);
}

describe("an automation's finished runs under Tasks", () => {
  it("leaves a run that finished and holds nothing, even with a teammate's question open on it or its pull request merged", () => {
    const held: RunsHeld = {
      ...NOTHING_HELD,
      inbox: [{ agentId: RUN.id, startedBy: ADA, waitsOn: ADA }],
    };
    assert.deepEqual(standing(withPullRequest(PULL_REQUEST_STATE.MERGED), held), []);
  });

  it("leaves a finished run of an automation since deleted, which names it still", () => {
    const orphaned = { ...RUN, automationId: null };
    assert.deepEqual(standing(orphaned, NOTHING_HELD), []);
  });

  it.each<[string, TasklessAgent, RunsHeld]>([
    ["still working", { ...RUN, status: CODING_AGENT_STATUS.RUNNING }, NOTHING_HELD],
    ["started by hand", BY_HAND, NOTHING_HELD],
    ["ended unseen", RUN, { ...NOTHING_HELD, unseen: (id) => id === RUN.id }],
    [
      "waiting on the reader in the Inbox",
      RUN,
      { ...NOTHING_HELD, inbox: [{ agentId: RUN.id, startedBy: ADA, waitsOn: ME }] },
    ],
    ["with its pull request open", withPullRequest(PULL_REQUEST_STATE.OPEN), NOTHING_HELD],
    ["shown", RUN, { ...NOTHING_HELD, shown: RUN.id }],
  ])("keeps a run %s", (_, agent, held) => {
    assert.deepEqual(standing(agent, held), [RUN.id]);
  });
});
