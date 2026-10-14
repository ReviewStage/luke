import assert from "node:assert/strict";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON } from "@luke/features/failure-remedy";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { agentCardReading, NOTHING_HELD } from "./agent-ref";
import { AgentTabCard } from "./agent-tab-card";
import { endLine, endLineReason, teammateStarter } from "./coding-agent-model";

/**
 * agent-starter.test.ts -- an agent a teammate started says so: its card
 * names them, and a key its turn failed on is theirs, which the reader is
 * not sent to their own Settings to mend. The reader's own agent reads as
 * before. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.FAILED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.TASK,
  startedBy: CHARLES,
};

/** The words the agent's card says, as Dean or Charles reads it. */
function cardFor(readerId: string | undefined): string {
  const read = agentCardReading(AGENT, "Invite flow", NOTHING_HELD, false, readerId);
  return renderToStaticMarkup(
    createElement(AgentTabCard, { name: "Invite flow", models: [], read }),
  );
}

test("a teammate's agent is named as started by them, and the reader's own is not", () => {
  assert.equal(teammateStarter(AGENT.startedBy, DEAN.userId), "Charles Pan");
  assert.equal(teammateStarter(AGENT.startedBy, CHARLES.userId), undefined);
  assert.equal(teammateStarter(undefined, DEAN.userId), undefined);

  assert.match(cardFor(DEAN.userId), /Started by Charles Pan/u);
  assert.doesNotMatch(cardFor(CHARLES.userId), /Started by/u);
});

test("a key a teammate's agent failed on is named as theirs, with no Settings of the reader's to mend it", () => {
  const failed = (failure: typeof CODING_AGENT_FAILURE.PROVIDER_KEY, starter?: string) =>
    endLine(CODING_AGENT_STATUS.FAILED, failure, undefined, starter);

  assert.equal(
    failed(CODING_AGENT_FAILURE.PROVIDER_KEY, "Charles Pan"),
    "Failed: Charles Pan's API key was refused or can't be read",
  );
  assert.equal(
    endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY, "Charles Pan"),
    FAILURE_REASON.OTHER,
  );
  assert.match(failed(CODING_AGENT_FAILURE.PROVIDER_KEY) ?? "", /your API key was refused/u);
  assert.equal(endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY), FAILURE_REASON.API_KEY);
  assert.equal(
    endLine(
      CODING_AGENT_STATUS.FAILED,
      CODING_AGENT_FAILURE.FAST_ON_OWN_KEY,
      undefined,
      "Charles Pan",
    ),
    "Failed: Fast isn't available on Charles Pan's own API key; choose the model with Fast off",
  );
});
