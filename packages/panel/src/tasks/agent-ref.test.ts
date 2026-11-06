import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { ACTOR_KIND, ACTOR_STATE } from "@repo/ui/actor-model";
import { test } from "vitest";
import { agentSubject, NOTHING_HELD } from "./agent-ref.js";

const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";

const THREAD_LINE = {
  title: "Redesigning Chat as Inbox-Slack hybrid",
  model: "anthropic/claude-opus-5.5",
};

function holding(agents: readonly AgentSummary[] | undefined) {
  return { agents, archived: undefined, models: undefined, me: undefined, pullRequests: new Map() };
}

test("an agent no read of its task holds is named and marked as its thread was read with it", () => {
  const subject = agentSubject(holding([]), AGENT_ID, NOTHING_HELD, false, THREAD_LINE);

  assert.equal(subject.name, "Redesigning Chat as Inbox-Slack hybrid");
  assert.deepEqual(subject.tile, {
    kind: ACTOR_KIND.AGENT,
    name: "Redesigning Chat as Inbox-Slack hybrid",
    provider: MODEL_PROVIDER.ANTHROPIC,
    state: ACTOR_STATE.REST,
  });
});

test("an agent its task's read holds is named as that read names it, over the line its thread was read with", () => {
  const held: AgentSummary = {
    id: AGENT_ID,
    planId: "5d0c3f0e-7b8a-4d2b-9c61-2f4e8a1b6c73",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Renamed since the channel was read",
    createdAt: 3,
    status: AGENT_STATUS.COMPLETED,
    turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  };

  const subject = agentSubject(holding([held]), AGENT_ID, NOTHING_HELD, false, THREAD_LINE);

  assert.equal(subject.name, "Renamed since the channel was read");
});
