import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentListAnswer,
  type CodingAgentPullRequestAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  type AgentEndToast,
  type AgentNotice,
  AgentNoticeDoors,
  type AgentPlace,
  createAgentNotices,
} from "./agent-notices";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PLAN_NAME = "Teammate invitations";
const MODEL = "anthropic/claude-opus-5.5";
const TURN_ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e5f6a7b8c9d";
const WATCH = Duration.seconds(30);
const ACCOUNT = "dean@example.com";
const OTHER_ACCOUNT = "sam@example.com";

function agent(
  status: CodingAgentStatus,
  patch: Partial<CodingAgentSummary> = {},
): CodingAgentSummary {
  return {
    id: AGENT_ID,
    planId: PLAN_ID,
    model: MODEL,
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status,
    turnId: TURN_ID,
    ...patch,
  };
}

/**
 * The notices over a scripted host: each plan's list answers from its own
 * queue, the last answer standing, and everything posted, toasted, opened,
 * and written is kept for the test to read. Electron's doors are a Layer of the
 * test's own that records what leaves through each.
 */
function fixture() {
  const listed: string[] = [];
  const readPullRequests: string[] = [];
  const published = new Map<string, CodingAgentPullRequestAnswerView>();
  const posted: AgentNotice[] = [];
  const toasted: AgentEndToast[] = [];
  const doors = Layer.succeed(AgentNoticeDoors, {
    post: (notice) => posted.push(notice),
    toast: (end) => toasted.push(end),
  });
  const opened: AgentPlace[] = [];
  const unseen: (readonly string[])[] = [];
  const answers = new Map<string, CodingAgentListAnswer[]>();
  let focus: ((focused: boolean) => void) | undefined;
  let accountChanged: ((signedInAs: string | undefined) => void) | undefined;
  let signedInAs: string | undefined = ACCOUNT;
  let notifying = true;
  let listReads = 0;
  const notices = createAgentNotices({
    listAgents: (planId) =>
      Effect.sync(() => {
        listed.push(planId);
        const queue = answers.get(planId) ?? [];
        const answer = queue.length > 1 ? queue.shift() : queue[0];
        return answer ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    readPullRequest: (agentId) =>
      Effect.sync(() => {
        readPullRequests.push(agentId);
        return published.get(agentId) ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    planName: (planId) => (planId === PLAN_ID ? PLAN_NAME : undefined),
    open: (place) => opened.push(place),
    onUnseenChanged: (next) => unseen.push(next),
    onPanelFocusChanged: (listener) => {
      focus = listener;
      return () => {
        focus = undefined;
      };
    },
    notifying: () => notifying,
    signedInAs: () => signedInAs,
    onAccountChanged: (listener) => {
      accountChanged = listener;
      return () => {
        accountChanged = undefined;
      };
    },
    onPlanAgentsMoved: () => {
      listReads += 1;
    },
    watchInterval: WATCH,
    report: () => undefined,
  }).pipe(Effect.provide(doors));
  return {
    notices,
    listed,
    readPullRequests,
    posted,
    toasted,
    /** What the agent's pull-request read answers, for the notice of its end. */
    publish: (agentId: string, answer: CodingAgentPullRequestAnswerView) =>
      published.set(agentId, answer),
    opened,
    unseen,
    /** The list answers a plan's reads hear, in order; the last stands for every read after it. */
    answer: (planId: string, ...queue: CodingAgentListAnswer[]) => answers.set(planId, queue),
    focus: (focused: boolean) => {
      assert.ok(focus, "the notices subscribe to the window's focus");
      focus(focused);
    },
    /** The account as a change of it says: another one, nobody, or the same one renewed. */
    changeAccount: (next: string | undefined) => {
      assert.ok(accountChanged, "the notices subscribe to the account");
      signedInAs = next;
      accountChanged(next);
    },
    /** The developer's setting for notifications. */
    notify: (on: boolean) => {
      notifying = on;
    },
    /** What was said, without the clicks. */
    said: () => posted.map(({ title, body }) => ({ title, body })),
    /** How many times the plan list was asked for again. */
    listReads: () => listReads,
  };
}
it.effect(
  "the account leaving takes its agents with it, so nothing of theirs is announced to the next",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      const other = agent(CODING_AGENT_STATUS.RUNNING, {
        id: "a1b2c3d4-0000-4000-8000-000000000002",
      });
      notices.observeAgents([other]);

      f.changeAccount(OTHER_ACCOUNT);
      assert.deepEqual(f.unseen.at(-1), []);
      // The answer that was on its way lands as a first sighting.
      notices.observeAgents([{ ...other, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* TestClock.adjust(WATCH);
      assert.equal(f.posted.length, 1);
      assert.deepEqual(f.listed, []);
    }),
);
