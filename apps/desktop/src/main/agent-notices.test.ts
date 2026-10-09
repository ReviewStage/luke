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
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { type AgentNotice, type AgentPlace, createAgentNotices, noticeText } from "./agent-notices";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER_PLAN_ID = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PLAN_NAME = "Teammate invitations";
const MODEL = "anthropic/claude-opus-5.5";
const TURN_ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e5f6a7b8c9d";
const NEXT_TURN_ID = "4a2d3c8b-0e5f-4b7c-9d2e-3f6a7b8c9d0e";
const WATCH = Duration.seconds(30);

function agent(
  status: CodingAgentStatus,
  patch: Partial<CodingAgentSummary> = {},
): CodingAgentSummary {
  return {
    id: AGENT_ID,
    planId: PLAN_ID,
    model: MODEL,
    effort: "high",
    createdAt: 1_800_000_000_000,
    status,
    turnId: TURN_ID,
    ...patch,
  };
}

/**
 * The notices over a scripted host: each plan's list answers from its own
 * queue, the last answer standing, and everything posted, opened, and
 * written is kept for the test to read.
 */
function fixture() {
  const listed: string[] = [];
  const readPullRequests: string[] = [];
  const published = new Map<string, CodingAgentPullRequestAnswerView>();
  const posted: AgentNotice[] = [];
  const opened: AgentPlace[] = [];
  const unseen: (readonly string[])[] = [];
  const answers = new Map<string, CodingAgentListAnswer[]>();
  let focus: ((focused: boolean) => void) | undefined;
  let accountChanged: (() => void) | undefined;
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
    poster: { post: (notice) => posted.push(notice) },
    open: (place) => opened.push(place),
    onUnseenChanged: (next) => unseen.push(next),
    onPanelFocusChanged: (listener) => {
      focus = listener;
      return () => {
        focus = undefined;
      };
    },
    onAccountChanged: (listener) => {
      accountChanged = listener;
      return () => {
        accountChanged = undefined;
      };
    },
    watchInterval: WATCH,
    report: () => undefined,
  });
  return {
    notices,
    listed,
    readPullRequests,
    posted,
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
    changeAccount: () => {
      assert.ok(accountChanged, "the notices subscribe to the account");
      accountChanged();
    },
    /** What was said, without the clicks. */
    said: () => posted.map(({ title, body }) => ({ title, body })),
  };
}

it.effect(
  "an agent that ends while the window is behind is announced once, as the plan's name over the model's, and dots its tab",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      f.answer(PLAN_ID, { agents: [agent(CODING_AGENT_STATUS.COMPLETED)] });

      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Claude Opus 5.5 finished" }]);
      assert.deepEqual(f.unseen, [[AGENT_ID]]);

      // The next ticks find nothing writing and list nothing; a list that
      // says completed again announces nothing twice.
      yield* TestClock.adjust(Duration.times(WATCH, 2));
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      assert.deepEqual(f.listed, [PLAN_ID]);
      assert.equal(f.posted.length, 1);
    }),
);

it.effect(
  "a message to an agent that had ended opens a run of its own: the ended turn read running again announces nothing and keeps the plan watched, and the next turn's end is the second notice",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 1);

      // The message's answer: running, still under the ended turn's id, as
      // eve has not opened the next turn yet. The transcript page the open
      // tab reads says the same, and then says the old end again.
      notices.observeMessaged(agent(CODING_AGENT_STATUS.RUNNING));
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.RUNNING);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 1);

      // The plan is watched until the next turn names itself.
      f.answer(
        PLAN_ID,
        { agents: [agent(CODING_AGENT_STATUS.RUNNING)] },
        { agents: [agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID })] },
        { agents: [agent(CODING_AGENT_STATUS.COMPLETED, { turnId: NEXT_TURN_ID })] },
      );
      yield* TestClock.adjust(Duration.times(WATCH, 2));
      assert.equal(f.posted.length, 1);
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.said(), [
        { title: PLAN_NAME, body: "Claude Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Claude Opus 5.5 finished" },
      ]);
      assert.deepEqual(f.listed, [PLAN_ID, PLAN_ID, PLAN_ID]);

      // Ended under the new turn, the agent is left alone again.
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.listed, [PLAN_ID, PLAN_ID, PLAN_ID]);
      assert.equal(f.posted.length, 2);
    }),
);

it.effect(
  "a list that landed late, describing a turn the agent has left behind or no turn yet, says nothing newer: no second notice, and the watch for the next turn stands",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      // The message's answer, then a list asked before the message landing after it: still awaiting.
      notices.observeMessaged(agent(CODING_AGENT_STATUS.RUNNING));
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      f.answer(PLAN_ID, { agents: [agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID })] });
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.listed, [PLAN_ID]);

      // The next turn is running; the old turn read running and then ended again is nothing, as is a read from before any turn.
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.STARTING, { turnId: null })]);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 1);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { turnId: NEXT_TURN_ID })]);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 2);
    }),
);

it.effect(
  "the window focused on that agent's tab hears nothing, and a Stop announces nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.shown(AGENT_ID);

      // The page the open tab read says it ended: the developer saw it.
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.unseen, []);

      // Off that tab, a Stop is the developer's own.
      notices.shown(null);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.CANCELLED)]);
      assert.deepEqual(f.posted, []);
    }),
);

it.effect("a window focused on another tab, or a plan left behind, is told", () =>
  Effect.gen(function* () {
    const f = fixture();
    const notices = yield* f.notices;
    f.focus(true);
    notices.shown(null);
    notices.observeAgents([agent(CODING_AGENT_STATUS.STARTING)]);
    notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.FAILED);
    yield* Effect.yieldNow;
    assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Claude Opus 5.5 failed" }]);
  }),
);

it.effect("an agent first seen ended, as after a relaunch, is not announced", () =>
  Effect.gen(function* () {
    const f = fixture();
    const notices = yield* f.notices;
    f.focus(false);
    notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
    notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
    yield* TestClock.adjust(WATCH);
    assert.deepEqual(f.posted, []);
    assert.deepEqual(f.listed, []);
  }),
);

it.effect("the click brings Luke to the plan on the agent's tab", () =>
  Effect.gen(function* () {
    const f = fixture();
    const notices = yield* f.notices;
    f.focus(false);
    notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
    notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
    yield* Effect.yieldNow;

    f.posted[0]?.onClick();
    assert.deepEqual(f.opened, [{ planId: PLAN_ID, agentId: AGENT_ID }]);
  }),
);

it.effect(
  "the unseen dot clears when the tab is shown, or when the window comes forward on it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      notices.shown(AGENT_ID);
      assert.deepEqual(f.unseen.at(-1), []);

      // Another ends with its tab shown but the window behind: seen when it
      // comes forward.
      const second = "a1b2c3d4-0000-4000-8000-000000000001";
      notices.shown(second);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { id: second })]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { id: second })]);
      assert.deepEqual(f.unseen.at(-1), [second]);
      f.focus(true);
      assert.deepEqual(f.unseen.at(-1), []);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 2);
    }),
);

it.effect(
  "every plan with an agent still writing is watched, and a plan the host no longer holds is let go",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const other = agent(CODING_AGENT_STATUS.RUNNING, {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        planId: OTHER_PLAN_ID,
        model: "openai/gpt-6-astra",
      });
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING), other]);
      f.answer(PLAN_ID, { agents: [agent(CODING_AGENT_STATUS.RUNNING)] });
      f.answer(OTHER_PLAN_ID, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });

      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.listed, [PLAN_ID, OTHER_PLAN_ID]);
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.listed, [PLAN_ID, OTHER_PLAN_ID, PLAN_ID]);
      assert.deepEqual(f.posted, []);
    }),
);

it.effect("the model is named as the catalog names it once the catalog has been read", () =>
  Effect.gen(function* () {
    const f = fixture();
    const notices = yield* f.notices;
    f.focus(false);
    notices.observeModels([
      {
        id: MODEL,
        name: "Claude Opus 5.5 (Anthropic)",
        provider: MODEL_PROVIDER.ANTHROPIC,
        efforts: ["high"],
      },
    ]);
    notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { planId: OTHER_PLAN_ID })]);
    notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { planId: OTHER_PLAN_ID })]);
    yield* Effect.yieldNow;
    assert.deepEqual(f.said(), [{ title: "Luke", body: "Claude Opus 5.5 (Anthropic) finished" }]);
  }),
);

it.effect("a pull request, once a reader hands one in, is the end the notice says", () =>
  Effect.sync(() => {
    assert.deepEqual(
      noticeText({
        planName: PLAN_NAME,
        model: MODEL,
        status: CODING_AGENT_STATUS.COMPLETED,
        models: undefined,
        pullRequest: 123,
      }),
      { title: PLAN_NAME, body: "Claude Opus 5.5 opened #123" },
    );
    assert.equal(
      noticeText({
        planName: PLAN_NAME,
        model: MODEL,
        status: CODING_AGENT_STATUS.RUNNING,
        models: undefined,
      }),
      undefined,
    );
  }),
);

it.effect(
  "a list that read the agent running before it ended, landing after the end, makes no second end",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);

      yield* TestClock.adjust(WATCH);
      assert.equal(f.posted.length, 1);
      assert.deepEqual(f.listed, []);
    }),
);

it.effect("a plan the host no longer holds takes its agents' dots with it", () =>
  Effect.gen(function* () {
    const f = fixture();
    const notices = yield* f.notices;
    f.focus(false);
    notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
    notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
    assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

    notices.observePlanGone(PLAN_ID);
    assert.deepEqual(f.unseen.at(-1), []);
  }),
);

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

      f.changeAccount();
      assert.deepEqual(f.unseen.at(-1), []);
      // The answer that was on its way lands as a first sighting.
      notices.observeAgents([{ ...other, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* TestClock.adjust(WATCH);
      assert.equal(f.posted.length, 1);
      assert.deepEqual(f.listed, []);
    }),
);

it.effect(
  "a completed turn is announced as the pull request it opened, read once as it ends; one that opened none, or whose read did not answer, finished; a failed turn is not read",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const opened = AGENT_ID;
      const branchOnly = "a1b2c3d4-0000-4000-8000-000000000011";
      const unanswered = "a1b2c3d4-0000-4000-8000-000000000012";
      const failed = "a1b2c3d4-0000-4000-8000-000000000013";
      f.publish(opened, {
        repository: "acme/relay",
        branch: "luke/teammate-invitations",
        pullRequest: {
          number: 123,
          title: "Teammate invitations",
          url: "https://github.com/acme/relay/pull/123",
          state: "open",
          checks: "passing",
          additions: 210,
          deletions: 14,
          changedFiles: 6,
        },
      });
      f.publish(branchOnly, { repository: "acme/relay", branch: "luke/x", pullRequest: null });
      for (const id of [opened, branchOnly, unanswered, failed]) {
        notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { id })]);
      }
      for (const id of [opened, branchOnly, unanswered]) {
        notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { id })]);
      }
      notices.observeAgents([agent(CODING_AGENT_STATUS.FAILED, { id: failed })]);
      // The dots are set as the ends are seen, ahead of any read.
      assert.deepEqual(f.unseen.at(-1), [opened, branchOnly, unanswered, failed]);

      yield* Effect.yieldNow;
      assert.deepEqual(f.said(), [
        { title: PLAN_NAME, body: "Claude Opus 5.5 opened #123" },
        { title: PLAN_NAME, body: "Claude Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Claude Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Claude Opus 5.5 failed" },
      ]);
      assert.deepEqual(f.readPullRequests, [opened, branchOnly, unanswered]);
      f.posted[0]?.onClick();
      assert.deepEqual(f.opened, [{ planId: PLAN_ID, agentId: opened }]);
    }),
);
