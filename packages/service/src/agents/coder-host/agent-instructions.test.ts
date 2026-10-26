/**
 * agent-instructions.test.ts -- an agent's instructions read its brief from its row
 * alike on every harness, so a native session is told what an eve one is.
 */

import assert from "node:assert/strict";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_KIND, CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { test } from "vitest";
import { agentCoderInstructions, CODER_HARNESS } from "./instructions.js";

/** An agent on a repository, handed what the test names, started by hand on no task. */
function agentHanded(handed: Pick<CodingAgent, "planSnapshot" | "prompt">): CodingAgent {
  return {
    id: "agent-1",
    userId: "user-1",
    taskId: null,
    organizationId: "workspace-1",
    automationId: null,
    automationOrigin: null,
    startedFrom: null,
    conversationId: "conversation-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: CONTEXT_WINDOW.LONG,
    repository: "acme/relay",
    branch: null,
    startBranch: null,
    title: null,
    archivedAt: null,
    archivedBy: null,
    disabledServers: [],
    author: null,
    githubAccess: GITHUB_ACCESS.APP,
    kind: CODING_AGENT_KIND.CODER,
    createdAt: new Date(0),
    ...handed,
  };
}

const CONTEXT = {
  ciReadable: false,
  coAuthor: undefined,
  workspace: "acme",
  memoryOn: false,
} as const;

const PLAN_JOB = "implement the plan given as the first message";
const BLANK_JOB = "do what the developer asks of you in this conversation";

test("an agent started with neither a plan nor a prompt is told to do what the developer asks, on every harness", () => {
  const blank = agentHanded({ planSnapshot: null, prompt: null });
  for (const harness of Object.values(CODER_HARNESS)) {
    const instructions = agentCoderInstructions(blank, { ...CONTEXT, harness });
    assert.ok(instructions.includes(BLANK_JOB), harness);
    assert.ok(!instructions.includes(PLAN_JOB), harness);
  }
});

test("an agent handed a plan is told to implement it, on every harness", () => {
  const planned = agentHanded({ planSnapshot: "# Plan", prompt: null });
  for (const harness of Object.values(CODER_HARNESS)) {
    const instructions = agentCoderInstructions(planned, { ...CONTEXT, harness });
    assert.ok(instructions.includes(PLAN_JOB), harness);
  }
});
