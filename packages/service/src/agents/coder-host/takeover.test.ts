/**
 * takeover.test.ts -- what each kind of Start inherits and does to its source, decided from the
 * source and the ask alone: a fresh Start keeps the ask's own values, a continue stops its source
 * and is named after it, a continue of a pilot takes it over, and a fork leaves its source be.
 * Synthetic agents; nothing reaches a database or a session.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Agent } from "@repo/database/models/agent-store";
import { AGENT_KIND, type AgentKind, CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { START_LINE_BRIEF } from "@repo/wire";
import { it } from "vitest";
import { SERVER_AGENT_START_KIND } from "../../events/server-events.js";
import type { StartFrom } from "./replay.js";
import { TAKEN_ON } from "./replay.js";
import { SNAPSHOT_MISS } from "./snapshot.js";
import { TAKEOVER, takeoverRules } from "./takeover.js";

/** A source agent of the given kind that stopped with nothing published, on a branch it was started on. */
const sourceOf = (kind: AgentKind): Agent => ({
  id: randomUUID(),
  userId: randomUUID(),
  taskId: randomUUID(),
  organizationId: randomUUID(),
  automationId: null,
  automationOrigin: null,
  automationRunId: null,
  startedFrom: null,
  startedByAgentId: null,
  conversationId: randomUUID(),
  model: "claude-sonnet",
  effort: "high",
  contextWindow: CONTEXT_WINDOW.STANDARD,
  descriptionSnapshot: "The description.",
  prompt: null,
  repository: "acme/app",
  branch: null,
  startBranch: "stack/base",
  title: "Build the store",
  archivedAt: null,
  archivedBy: null,
  disabledServers: [],
  author: null,
  githubAccess: GITHUB_ACCESS.APP,
  kind,
  createdAt: new Date(0),
});

/** A Start from `source`, continued, or forked at a message where one is named. */
const fromOf = (source: Agent, messageId: string | undefined): StartFrom => ({
  source,
  lineage: [source],
  prompt: undefined,
  attachments: [],
  steps: [],
  totalSteps: 0,
  carriedSummary: undefined,
  choice: { model: source.model, effort: source.effort, contextWindow: source.contextWindow },
  disabledServers: [],
  serverWords: undefined,
  told: {
    published: null,
    work: { on: TAKEN_ON.COPY, copy: { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX } },
    carried: undefined,
    forked: { at: messageId !== undefined, edited: [] },
    unkept: [],
    inPullRequest: false,
    extras: [],
    messageId,
  },
});

const coder = sourceOf(AGENT_KIND.CODER);
const pilot = sourceOf(AGENT_KIND.PILOT);

it.each([
  {
    start: "a fresh Start",
    from: undefined,
    expected: {
      kind: TAKEOVER.FRESH,
      stops: false,
      takesOver: undefined,
      title: undefined,
      branch: null,
      startKind: SERVER_AGENT_START_KIND.FRESH,
      line: undefined,
    },
  },
  {
    start: "a continue",
    from: fromOf(coder, undefined),
    expected: {
      kind: TAKEOVER.CONTINUE,
      stops: true,
      takesOver: undefined,
      title: "Build the store (continued)",
      branch: "stack/base",
      startKind: SERVER_AGENT_START_KIND.CONTINUE,
      line: START_LINE_BRIEF.CONTINUE,
    },
  },
  {
    start: "a continue of a pilot",
    from: fromOf(pilot, undefined),
    expected: {
      kind: TAKEOVER.CONTINUE,
      stops: true,
      takesOver: pilot.id,
      title: "Build the store (continued)",
      branch: "stack/base",
      startKind: SERVER_AGENT_START_KIND.CONTINUE,
      line: START_LINE_BRIEF.CONTINUE,
    },
  },
  {
    start: "a fork of a pilot",
    from: fromOf(pilot, randomUUID()),
    expected: {
      kind: TAKEOVER.FORK,
      stops: false,
      takesOver: undefined,
      title: undefined,
      branch: "stack/base",
      startKind: SERVER_AGENT_START_KIND.FORK,
      line: START_LINE_BRIEF.FORK,
    },
  },
])(
  "$start by a member is told what it inherits and whether it stops its source",
  ({ from, expected }) => {
    const rules = takeoverRules(from, {
      taskId: randomUUID(),
      idempotencyKey: randomUUID(),
      choice: undefined,
    });

    assert.equal(rules.kind, expected.kind);
    // A continue stops its source, so its plan must admit the starter, and a member's reports where its source did.
    assert.equal(rules.stopsSource, expected.stops);
    assert.equal(rules.checksPlanWriter, expected.stops);
    assert.equal(rules.readsPilotStarter, expected.stops);
    assert.equal(rules.takesOver?.id, expected.takesOver);
    assert.equal(rules.title, expected.title);
    assert.equal(rules.branch, expected.branch);
    assert.equal(rules.startKind, expected.startKind);
    assert.equal(rules.startLine?.brief, expected.line);
    assert.deepEqual(rules.choice, from?.choice);
  },
);
