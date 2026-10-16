import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  archiveCodingAgent,
  type CodingAgentLatestTurn,
  createCodingAgent,
  lineSendersOf,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { readMessageByClientId } from "@luke/database/models/message-reads";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { turns } from "@luke/database/schemas/storage";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, startPlan } from "@luke/database/testing";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, Option, Stream } from "effect";
import { test } from "vitest";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../agents/brain-host/eve-sessions.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import {
  AGENT_WAKE,
  type AgentWake,
  agentIsWoken,
  agentWakeOf,
  wakeAgents,
} from "./agent-wakes.js";

/**
 * What happens on a coding agent's pull request after its turn ends, told
 * to the agent as a message from GitHub: a review, a comment on the pull
 * request, and a failed check on its branch are read off their deliveries
 * and nothing else is; a person's review reaches the agent whether or not it
 * is at work, a comment Luke's own App made reaches only an agent idle since
 * before it was made, so an agent's own reply never wakes it, and a failed
 * check only an agent not at work. Over a real dialect, eve a fake at the
 * client's boundary and GitHub a script. Synthetic throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const LUKE_BOT = "luke-agents[bot]";
const MADE_AT = Date.parse("2026-10-16T12:00:00Z");

/** One installation per test's workspace, since one installation connects to one workspace and the tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 8 }, (_, index) => ({
  id: 8_100 + index,
  login: RELAY.owner,
  accountId: 81_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

const repository = {
  full_name: RELAY_FULL_NAME,
  html_url: `https://github.com/${RELAY_FULL_NAME}`,
};

/** GitHub's delivery of a review submitted on pull request 41 from the branch given, by the login given. */
function reviewDelivery(ref: string, login: string, action = "submitted"): WireBoundaryInput {
  return {
    action,
    repository,
    sender: { login, type: login.endsWith("[bot]") ? "Bot" : "User" },
    review: {
      state: "CHANGES_REQUESTED",
      html_url: `https://github.com/${RELAY_FULL_NAME}/pull/41#pullrequestreview-9`,
      submitted_at: new Date(MADE_AT).toISOString(),
      body: "Never read.",
    },
    pull_request: { number: 41, title: "Ignored", head: { ref } },
  };
}

/** A turn of the agent's that ran and ended at the instant given, or one still running. */
function turn(settledAt: number | undefined): CodingAgentLatestTurn {
  return {
    conversationId: "conversation",
    id: "turn",
    status: settledAt === undefined ? TURN_STATUS.RUNNING : TURN_STATUS.SETTLED,
    eveTurnId: "eve-turn",
    failure: null,
    failureDetail: null,
    cancelRequestedAt: null,
    queuedAt: new Date(MADE_AT - 600_000),
    startedAt: new Date(MADE_AT - 600_000),
    settledAt: settledAt === undefined ? null : new Date(settledAt),
    model: null,
    usage: null,
    fastRefused: false,
  };
}

/** eve's coding-agent service as the deployment reaches it for each account, writing down every message sent. */
function fakeEve() {
  const sent: { readonly sessionId: string; readonly message: EveMessage }[] = [];
  const sessions: EveSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        sent.push({ sessionId, message });
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() } as const;
      }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
    stream: () => Stream.empty,
  };
  return { sent, eveFor: () => Effect.succeed(sessions) };
}

/** An account whose plan's workspace reaches the repository, with one agent standing on a branch of its own, its session opened. */
const openAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const plan = yield* startPlan(owner, {
    name: "Teammate invitations",
    repository: RELAY_FULL_NAME,
  });
  const installation = INSTALLATIONS[installationsConnected++];
  assert.ok(installation);
  yield* connectWorkspaceGitHub(plan.workspaceId, installation);
  const started = yield* createCodingAgent(owner, {
    planId: plan.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: RELAY_FULL_NAME,
  });
  const agent = Option.getOrThrow(started).agent;
  const ref = `luke/teammate-invitations-${randomUUID()}`;
  yield* updateCodingAgentBranch(owner, agent.id, ref);
  yield* claimRuntimeSession(
    { userId: owner, conversationId: agent.conversationId },
    `wrun_${randomUUID()}`,
    new Date(MADE_AT - 3_600_000),
  );
  return { owner, agent, ref, target: { userId: owner, conversationId: agent.conversationId } };
});

/** The agent's turn, ended at the instant given, as the relay leaves one. */
const endedTurn = (owner: string, conversationId: string, settledAt: number) =>
  Database.use((db) =>
    db.insert(turns).values({
      userId: owner,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: new Date(settledAt - 60_000),
      startedAt: new Date(settledAt - 60_000),
      settledAt: new Date(settledAt),
    }),
  );

test("a review submitted, a comment on a pull request, and a failed check suite or commit status on an agent's branch are read, each by who caused it and when, and nothing else is", () => {
  const ref = "luke/invites";
  assert.deepEqual(
    agentWakeOf("pull_request_review", unparsedWire(reviewDelivery(ref, "octocat")), 0),
    {
      kind: AGENT_WAKE.REVIEW,
      repository: RELAY_FULL_NAME,
      branches: [ref],
      pullRequest: 41,
      url: `https://github.com/${RELAY_FULL_NAME}/pull/41#pullrequestreview-9`,
      by: "octocat",
      at: MADE_AT,
      verdict: "changes_requested",
    },
  );
  const comment = (pullRequest: boolean, action = "created") => ({
    action,
    repository,
    sender: { login: "octocat", type: "User" },
    comment: {
      html_url: `https://github.com/${RELAY_FULL_NAME}/pull/41#issuecomment-7`,
      created_at: new Date(MADE_AT).toISOString(),
      body: "Never read.",
    },
    issue: { number: 41, ...(pullRequest ? { pull_request: { url: "ignored" } } : undefined) },
  });
  assert.deepEqual(agentWakeOf("issue_comment", unparsedWire(comment(true)), 0), {
    kind: AGENT_WAKE.COMMENT,
    repository: RELAY_FULL_NAME,
    branches: [],
    pullRequest: 41,
    url: `https://github.com/${RELAY_FULL_NAME}/pull/41#issuecomment-7`,
    by: "octocat",
    at: MADE_AT,
  });
  const suite = (branch: string, conclusion: string) => ({
    action: "completed",
    repository,
    check_suite: {
      head_branch: branch,
      head_sha: "0123abcd",
      conclusion,
      updated_at: new Date(MADE_AT).toISOString(),
      app: { slug: "github-actions" },
      pull_requests: [{ number: 41 }],
    },
  });
  assert.deepEqual(agentWakeOf("check_suite", unparsedWire(suite(ref, "failure")), 0), {
    kind: AGENT_WAKE.CHECK_FAILED,
    repository: RELAY_FULL_NAME,
    branches: [ref],
    pullRequest: 41,
    url: `https://github.com/${RELAY_FULL_NAME}/commit/0123abcd/checks`,
    by: "github-actions[bot]",
    at: MADE_AT,
  });

  const status = (branch: string, state: string) => ({
    state,
    sha: "4567cdef",
    updated_at: new Date(MADE_AT).toISOString(),
    repository,
    sender: { login: "buildkite[bot]", type: "Bot" },
    branches: [{ name: "main" }, { name: branch }, { name: "luke/another-agent" }],
    description: "Never read.",
  });
  assert.deepEqual(agentWakeOf("status", unparsedWire(status(ref, "failure")), 0), {
    kind: AGENT_WAKE.CHECK_FAILED,
    repository: RELAY_FULL_NAME,
    branches: [ref, "luke/another-agent"],
    pullRequest: undefined,
    url: `https://github.com/${RELAY_FULL_NAME}/commit/4567cdef/checks`,
    by: "buildkite[bot]",
    at: MADE_AT,
  });

  for (const [event, payload] of [
    ["pull_request_review", reviewDelivery(ref, "octocat", "edited")],
    ["pull_request_review_comment", reviewDelivery(ref, "octocat", "created")],
    ["issue_comment", comment(false)],
    ["issue_comment", comment(true, "edited")],
    ["check_suite", suite(ref, "success")],
    ["check_suite", suite("main", "failure")],
    ["status", status(ref, "pending")],
    ["status", { ...status("release", "error"), branches: [{ name: "release" }] }],
  ] as const) {
    assert.equal(agentWakeOf(event, unparsedWire(payload), 0), undefined, event);
  }
});

test("a person's review reaches an agent at work or not, Luke's App's only an agent idle since before it was made, a failed check only an agent idle since before it failed, and an archived agent nothing", () => {
  const review = (by: string): AgentWake => ({
    kind: AGENT_WAKE.REVIEW,
    repository: RELAY_FULL_NAME,
    branches: ["luke/invites"],
    pullRequest: 41,
    url: "https://github.com/Acme/Relay/pull/41#pullrequestreview-9",
    by,
    at: MADE_AT,
  });
  const failed: AgentWake = { ...review("github-actions[bot]"), kind: AGENT_WAKE.CHECK_FAILED };
  const agent = { archivedAt: null, createdAt: new Date(MADE_AT - 7_200_000) };
  const now = MADE_AT + 5_000;
  const idleBefore = turn(MADE_AT - 60_000);
  const endedSince = turn(MADE_AT + 2_000);
  const atWork = turn(undefined);
  const woken = (wake: AgentWake, at: CodingAgentLatestTurn) =>
    agentIsWoken(wake, agent, at, LUKE_BOT, now);

  assert.deepEqual(
    [idleBefore, endedSince, atWork].map((at) => woken(review("octocat"), at)),
    [true, true, true],
  );
  assert.deepEqual(
    [idleBefore, endedSince, atWork].map((at) => woken(review(LUKE_BOT), at)),
    [true, false, false],
    "Luke's App's review reaches only an agent that could not have made it",
  );
  assert.deepEqual(
    [idleBefore, endedSince, atWork].map((at) => woken(failed, at)),
    [true, false, false],
    "a failed check reaches only an agent that was not watching when it failed",
  );
  assert.equal(
    agentIsWoken(
      review("octocat"),
      { ...agent, archivedAt: new Date(now) },
      idleBefore,
      LUKE_BOT,
      now,
    ),
    false,
  );
});

it.layer(getTestDB())("a delivery told to the agents on its pull request", (it) => {
  it.effect(
    "a person's review is told to the agent on the branch once under the delivery's id, drawn as theirs, and Luke's App's reply made while the agent was at work is told to nobody",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ref, target } = yield* openAgent;
        yield* endedTurn(owner, agent.conversationId, MADE_AT - 60_000);
        const github = githubReaching(INSTALLATIONS).layer;
        const wake = Option.getOrThrow(
          Option.fromNullishOr(
            agentWakeOf("pull_request_review", unparsedWire(reviewDelivery(ref, "octocat")), 0),
          ),
        );
        const deliveryId = randomUUID();

        const told = yield* wakeAgents(eve.eveFor, wake, deliveryId, LUKE_BOT).pipe(
          Effect.provide(github),
        );
        const again = yield* wakeAgents(eve.eveFor, wake, deliveryId, LUKE_BOT).pipe(
          Effect.provide(github),
        );

        assert.deepEqual([told, again], [1, 1]);
        assert.equal(eve.sent.length, 1, "a delivery GitHub sends twice is told once");
        const text = eve.sent[0]?.message.message;
        assert.ok(
          JSON.stringify(text).includes(
            "@octocat requested changes on your pull request #41: https://github.com/Acme/Relay/pull/41#pullrequestreview-9",
          ),
        );
        const read = yield* readMessageByClientId(
          owner,
          agent.conversationId,
          {},
          sentLineId(deliveryId),
        );
        const id = read.ok ? (read.value[0]?.id ?? "") : "";
        assert.deepEqual((yield* lineSendersOf(target, [id])).get(id), {
          kind: MESSAGE_SENDER.GITHUB,
          login: "octocat",
        });

        // The agent replied as Luke's App inside a turn that has since ended: its own reply wakes nobody.
        yield* endedTurn(owner, agent.conversationId, MADE_AT + 30_000);
        const reply = { ...wake, by: LUKE_BOT, at: MADE_AT + 20_000 };
        const own = yield* wakeAgents(eve.eveFor, reply, randomUUID(), LUKE_BOT).pipe(
          Effect.provide(github),
        );
        yield* archiveCodingAgent(owner, agent.id, true);
        const archived = yield* wakeAgents(eve.eveFor, wake, randomUUID(), LUKE_BOT).pipe(
          Effect.provide(github),
        );
        assert.deepEqual([own, archived, eve.sent.length], [0, 0, 1]);
      }),
  );
});
