/**
 * replay.test.ts -- the preamble a replay hands on, told from the steps it kept, the summary of
 * the ones before them, and how many there were, and where it sends the new agent for a source
 * that only carried another agent's work. Synthetic agent and steps; nothing reaches a database.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { REPLAY_STEP_KIND, type ReplayStep } from "@luke/features/agent-replay";
import {
  CHECK_SUMMARY,
  CONTEXT_WINDOW,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { it } from "vitest";
import { replayOf, type StartFrom } from "./replay.js";
import { SNAPSHOT_MISS } from "./snapshot.js";

/** A step of the agent's own words. */
const said = (at: number): ReplayStep => ({
  kind: REPLAY_STEP_KIND.SAID,
  summary: `Said: Step ${at}.`,
  words: `Step ${at}.`,
});

/** A source agent that stopped with nothing published. */
const source: CodingAgent = {
  id: randomUUID(),
  userId: randomUUID(),
  taskId: randomUUID(),
  organizationId: randomUUID(),
  automationId: null,
  automationOrigin: null,
  startedFrom: null,
  conversationId: randomUUID(),
  model: "claude-sonnet",
  effort: "high",
  contextWindow: CONTEXT_WINDOW.STANDARD,
  planSnapshot: "The plan.",
  prompt: null,
  repository: "acme/app",
  branch: null,
  startBranch: null,
  title: "Build the store",
  archivedAt: null,
  archivedBy: null,
  disabledServers: [],
  author: null,
  createdAt: new Date(0),
};

/** A continue of the source with `total` steps, none copied. */
const startFrom = (total: number): StartFrom => ({
  source,
  lineage: [source],
  prompt: undefined,
  attachments: [],
  steps: Array.from({ length: total }, (_, at) => said(at)),
  totalSteps: total,
  carriedSummary: undefined,
  choice: { model: source.model, effort: source.effort, contextWindow: source.contextWindow },
  disabledServers: [],
  serverWords: undefined,
  told: {
    published: null,
    copy: { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX },
    carried: undefined,
    forked: { at: false, edited: undefined },
    unkept: [],
    inPullRequest: false,
    messageId: undefined,
  },
});

it("a summary beside steps left out is told as some of those that did not fit, never as the oldest", () => {
  const from = startFrom(30);
  const kept = from.steps.slice(-10);

  const capped = replayOf(from, kept, { text: "Recap.", steps: 8 }).replay.preamble;
  assert.match(
    capped,
    /20 of its 30 steps did not fit: a summary of 8 of them comes first.*the other 12 are left out\./u,
  );
  assert.doesNotMatch(capped, /The oldest/u);

  const whole = replayOf(from, kept, { text: "Recap.", steps: 20 }).replay.preamble;
  assert.match(
    whole,
    /The oldest 20 of its 30 steps did not fit, so a summary of them comes first/u,
  );
  assert.doesNotMatch(whole, /left out/u);

  const none = replayOf(from, kept, undefined).replay.preamble;
  assert.match(none, /The oldest 20 of its 30 steps are left out to fit\./u);
});

it("a source that never made a branch of its own sends the new agent to the work it carried, never to the default branch", () => {
  const origin: CodingAgent = {
    ...source,
    id: randomUUID(),
    title: "Add PR tab",
    branch: "luke/pull-request-tab",
  };
  const pullRequest: CodingAgentPullRequest = {
    number: 3030,
    title: "Add a PR tab",
    url: "https://github.com/acme/app/pull/3030",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.NONE,
    additions: 120,
    deletions: 4,
    changedFiles: 6,
  };
  const from = startFrom(3);
  const carriedFrom = (copiedBranch: string | undefined) =>
    replayOf(
      {
        ...from,
        lineage: [source, origin],
        told: {
          ...from.told,
          carried: { agent: origin, published: pullRequest, copiedBranch },
        },
      },
      from.steps,
      undefined,
    ).replay.preamble;

  const pushed = carriedFrom(undefined);
  assert.match(
    pushed,
    /It never made a branch of its own: it took up the work of the coding agent "Add PR tab"/u,
  );
  assert.match(pushed, /git switch 'luke\/pull-request-tab'/u);
  assert.ok(pushed.includes("#3030 (https://github.com/acme/app/pull/3030)"));
  assert.doesNotMatch(pushed, /start from the repository's default branch/u);

  const copied = carriedFrom("luke/add-pr-tab-continued-1a2b3c4d");
  assert.match(copied, /copied for it to the branch `luke\/add-pr-tab-continued-1a2b3c4d`/u);
  assert.match(copied, /git switch 'luke\/add-pr-tab-continued-1a2b3c4d'/u);
  assert.match(
    copied,
    /That agent's own branch is `luke\/pull-request-tab`, with its pull request #3030/u,
  );

  const unread = replayOf(
    {
      ...from,
      told: {
        ...from.told,
        carried: {
          agent: undefined,
          published: null,
          copiedBranch: "luke/add-pr-tab-continued-1a2b3c4d",
        },
      },
    },
    from.steps,
    undefined,
  ).replay.preamble;
  assert.match(
    unread,
    /took up the work of another coding agent, whose checkout was copied for it/u,
  );
  assert.match(unread, /git switch 'luke\/add-pr-tab-continued-1a2b3c4d'/u);

  assert.match(
    replayOf(from, from.steps, undefined).replay.preamble,
    /start from the repository's default branch/u,
  );
});
