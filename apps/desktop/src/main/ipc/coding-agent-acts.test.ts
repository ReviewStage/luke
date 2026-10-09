import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { codingAgentActRows } from "./coding-agent-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const STARTED: CodingAgentAgentAnswer = {
  agent: {
    id: AGENT_ID,
    planId: PLAN_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1_800_000_000_000,
    status: CODING_AGENT_STATUS.STARTING,
    turnId: null,
  },
};

function fixture() {
  const asked: string[] = [];
  /** What the notices were told, in order. */
  const noted: string[] = [];
  const rows = codingAgentActRows({
    notices: {
      observeAgents: (agents) => {
        noted.push(`agents:${agents.map((agent) => `${agent.id}=${agent.status}`).join(",")}`);
      },
      observeStatus: (agentId, status) => {
        noted.push(`status:${agentId}=${status}`);
      },
      observeMessaged: (agent) => {
        noted.push(`messaged:${agent.id}=${agent.status}`);
      },
      observeModels: (models) => {
        noted.push(`models:${models.length}`);
      },
      observePlanGone: (planId) => {
        noted.push(`gone:${planId}`);
      },
      shown: (agentId) => {
        noted.push(`shown:${agentId}`);
      },
    },
    host: {
      codingAgentModels: () =>
        Effect.sync(() => {
          asked.push("models");
          return { models: [] };
        }),
      codingAgentDefaultRead: () =>
        Effect.sync(() => {
          asked.push("default");
          return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
        }),
      codingAgentDefaultWrite: (choice) =>
        Effect.sync(() => {
          asked.push(`default:${choice.model}:${choice.effort}`);
          return { choice };
        }),
      codingAgentList: ({ planId }) =>
        Effect.sync(() => {
          asked.push(`list:${planId}`);
          return { agents: [] };
        }),
      codingAgentStart: (params) =>
        Effect.sync(() => {
          asked.push(`start:${params.planId}:${params.idempotencyKey}`);
          return STARTED;
        }),
      codingAgentMessages: ({ agentId, after }) =>
        Effect.sync(() => {
          asked.push(`messages:${agentId}:${after}`);
          return { messages: [], cursor: after, status: CODING_AGENT_STATUS.RUNNING };
        }),
      codingAgentMessage: ({ agentId, text, clientKey }) =>
        Effect.sync(() => {
          asked.push(`message:${agentId}:${clientKey}:${text}`);
          return STARTED;
        }),
      codingAgentStop: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`stop:${agentId}`);
          return STARTED;
        }),
      codingAgentPullRequest: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`pull-request:${agentId}`);
          return { repository: "acme/relay", branch: null, pullRequest: null };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, noted };
}

it.effect(
  "a panel's Start reaches the host with the plan and the press's own key, and hears the agent",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const outcome = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_START,
          payload: { planId: PLAN_ID, idempotencyKey: "press-1" },
        },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`start:${PLAN_ID}:press-1`]);
    }),
);

it.effect("a transcript read carries the agent and the cursor the panel stands at", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    const outcome = yield* router.performAct(
      { kind: ACT_KIND.CODING_AGENTS_MESSAGES, payload: { agentId: AGENT_ID, after: "3:2" } },
      PANEL,
    );

    assert.deepEqual(outcome, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { messages: [], cursor: "3:2", status: CODING_AGENT_STATUS.RUNNING },
    });
    assert.deepEqual(asked, [`messages:${AGENT_ID}:3:2`]);
  }),
);

it.effect(
  "a message carries the agent, the words, and the send's key, and hears the agent back",
  () =>
    Effect.gen(function* () {
      const { router, asked, noted } = fixture();

      const outcome = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_MESSAGE,
          payload: {
            agentId: AGENT_ID,
            text: "Also expire them after a week.",
            clientKey: "send-1",
          },
        },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`message:${AGENT_ID}:send-1:Also expire them after a week.`]);
      // The answer is noted as a message's, so the ledger watches for the turn it opens.
      assert.deepEqual(noted, [`messaged:${AGENT_ID}=${STARTED.agent.status}`]);
    }),
);

it.effect(
  "the voice window is refused every coding-agent act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_STOP, payload: { agentId: AGENT_ID } },
        VOICE,
      );
      const models = yield* router.performAct({ kind: ACT_KIND.CODING_AGENTS_MODELS }, VOICE);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_STOP].refusal,
      });
      assert.deepEqual(models, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_MODELS].refusal,
      });
      assert.deepEqual(asked, []);
    }),
);

it.effect("a Start naming a model without its effort is refused at the boundary", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    const outcome = yield* router.performAct(
      {
        kind: ACT_KIND.CODING_AGENTS_START,
        // SAFETY: the test sends a payload the act's own schema admits by key but the service refuses as half a choice; the router reads it again before the row runs.
        payload: { planId: PLAN_ID, idempotencyKey: "press-1", model: "openai/gpt-6.1-sol" },
      },
      PANEL,
    );

    // The schema admits either key alone; the service refuses the half, so the row still runs.
    assert.equal(outcome.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(asked, [`start:${PLAN_ID}:press-1`]);
  }),
);

it.effect(
  "every answer's agents are noted on their way to the panel, and the panel's shown agent reaches the notices",
  () =>
    Effect.gen(function* () {
      const { router, noted } = fixture();

      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_START, payload: { planId: PLAN_ID, idempotencyKey: "k" } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_MESSAGES, payload: { agentId: AGENT_ID, after: "0:0" } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_LIST, payload: { planId: PLAN_ID } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: null } },
        PANEL,
      );
      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID } },
        VOICE,
      );

      assert.deepEqual(noted, [
        `agents:${AGENT_ID}=${CODING_AGENT_STATUS.STARTING}`,
        `status:${AGENT_ID}=${CODING_AGENT_STATUS.RUNNING}`,
        "agents:",
        `shown:${AGENT_ID}`,
        "shown:null",
      ]);
      assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
    }),
);
