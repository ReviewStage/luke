import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { REPLAY_STEP_KIND, type ReplayStep } from "@luke/features/agent-replay";
import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { it } from "vitest";
import { replayOf, type StartFrom } from "./replay.js";
import { SNAPSHOT_MISS } from "./snapshot.js";

/**
 * replay.test.ts -- the preamble a replay hands on, told from the steps it kept, the summary of
 * the ones before them, and how many there were. Synthetic agent and steps; nothing reaches a
 * database.
 */

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
    forked: { at: false, edited: undefined },
    unkept: [],
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
