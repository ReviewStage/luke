import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry } from "@sidecar/hosted/account-inbox-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentListAnswer,
  type CodingAgentPullRequestAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { INBOX_CURSOR_START } from "@sidecar/hosted/inbox-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Duration, Effect, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { AppInboxPlan } from "#shared/messages/app-state";
import {
  type AgentEndToast,
  type AgentNotice,
  AgentNoticeDoors,
  type AgentPlace,
  createAgentNotices,
  type InboxItemToast,
  noticeText,
} from "./agent-notices";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER_PLAN_ID = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PLAN_NAME = "Teammate invitations";
const MODEL = "anthropic/claude-opus-5.5";
const TURN_ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e5f6a7b8c9d";
const NEXT_TURN_ID = "4a2d3c8b-0e5f-4b7c-9d2e-3f6a7b8c9d0e";
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
 * queue, the last answer standing, the account's inbox read holds until the
 * test answers it, and everything posted, toasted, opened, badged, and
 * written is kept for the test to read. Electron's doors are a Layer of the
 * test's own that records what leaves through each.
 */
function fixture() {
  const listed: string[] = [];
  const readPullRequests: string[] = [];
  const published = new Map<string, CodingAgentPullRequestAnswerView>();
  const posted: AgentNotice[] = [];
  const toasted: AgentEndToast[] = [];
  const inboxToasted: InboxItemToast[] = [];
  const badges: number[] = [];
  const doors = Layer.succeed(AgentNoticeDoors, {
    post: (notice) => posted.push(notice),
    toast: (end) => toasted.push(end),
    toastInbox: (item) => inboxToasted.push(item),
    badge: (count) => badges.push(count),
  });
  const inboxReads: string[] = [];
  const waiting: (readonly AppInboxPlan[])[] = [];
  const openedInboxes: string[] = [];
  let inboxAnswers: Queue.Queue<CodingAgentAccountInboxAnswerView> | undefined;
  let accounts: Queue.Queue<string | undefined> | undefined;
  const opened: AgentPlace[] = [];
  const unseen: (readonly string[])[] = [];
  const answers = new Map<string, CodingAgentListAnswer[]>();
  let focus: ((focused: boolean) => void) | undefined;
  let accountChanged: ((signedInAs: string | undefined) => void) | undefined;
  let signedInAs: string | undefined = ACCOUNT;
  let notifying = true;
  let listReads = 0;
  const notices = Effect.gen(function* () {
    inboxAnswers = yield* Queue.unbounded<CodingAgentAccountInboxAnswerView>();
    accounts = yield* Queue.unbounded<string | undefined>();
    Queue.offerUnsafe(accounts, signedInAs);
    return yield* createAgentNotices({
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
      readAccountInbox: (after) =>
        Effect.suspend(() => {
          inboxReads.push(after);
          assert.ok(inboxAnswers);
          return Queue.take(inboxAnswers);
        }),
      accounts: Stream.fromQueue(accounts),
      onWaitingChanged: (next) => waiting.push(next),
      openInbox: (planId) => openedInboxes.push(planId),
      watchInterval: WATCH,
      report: () => undefined,
    });
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
      assert.ok(accounts);
      signedInAs = next;
      accountChanged(next);
      Queue.offerUnsafe(accounts, next);
    },
    /** The account's inbox read answered, as the host answers the one standing. */
    answerInbox: (answer: CodingAgentAccountInboxAnswerView) => {
      assert.ok(inboxAnswers);
      Queue.offerUnsafe(inboxAnswers, answer);
    },
    inboxReads,
    waiting,
    badges,
    inboxToasted,
    openedInboxes,
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

/** A pull request one of the agents opened, as a read of what it published answers it. */
const PULL_REQUEST: CodingAgentPullRequest = {
  number: 41,
  title: "Teammate invitations",
  url: "https://github.com/acme/relay/pull/41",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PENDING,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
};

it.effect(
  "the plan list is asked for again as an agent starts, as its turn ends, and as a message wakes it, and not for an answer that says nothing new",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      assert.equal(f.listReads(), 0);

      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID })]);
      assert.equal(f.listReads(), 1);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.RUNNING);
      assert.equal(f.listReads(), 1);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      assert.equal(f.listReads(), 2);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      assert.equal(f.listReads(), 2);

      // A message to the ended agent reads it running under the ended turn, which the list says too.
      notices.observeMessaged(agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID }));
      assert.equal(f.listReads(), 3);
      notices.observeMessaged(agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID }));
      assert.equal(f.listReads(), 3);
    }),
);

it.effect(
  "the plan list is asked for again where a read of what an agent published finds a pull request, or one that moved, and not for the same one read again",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      notices.observePublished(AGENT_ID, null);
      assert.equal(f.listReads(), 0);

      notices.observePublished(AGENT_ID, PULL_REQUEST);
      notices.observePublished(AGENT_ID, PULL_REQUEST);
      assert.equal(f.listReads(), 1);
      notices.observePublished(AGENT_ID, { ...PULL_REQUEST, checks: CHECK_SUMMARY.FAILING });
      assert.equal(f.listReads(), 2);
      notices.observePublished(AGENT_ID, {
        ...PULL_REQUEST,
        checks: CHECK_SUMMARY.FAILING,
        state: PULL_REQUEST_STATE.MERGED,
      });
      assert.equal(f.listReads(), 3);
    }),
);

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
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Opus 5.5 finished" }]);
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
        { title: PLAN_NAME, body: "Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Opus 5.5 finished" },
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

it.effect(
  "a window focused on another tab, or a plan left behind, is told in its own toast, under the plan's name, and posts no notification, once for each turn, and a window behind is told by a notification and shown no toast",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);
      notices.shown(null);
      notices.observeAgents([agent(CODING_AGENT_STATUS.STARTING)]);
      // The page that says it failed carries the title generated since the list named the agent.
      notices.observeTitle(AGENT_ID, "Fix invitations");
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.FAILED);
      yield* Effect.yieldNow;
      assert.deepEqual(f.toasted, [
        {
          place: { planId: PLAN_ID, agentId: AGENT_ID },
          words: "Fix invitations failed",
          detail: PLAN_NAME,
          failed: true,
        },
      ]);
      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.unseen, [[AGENT_ID]], "the tab is dotted all the same");

      // The same end read again is the same turn, and says nothing twice.
      notices.observeAgents([agent(CODING_AGENT_STATUS.FAILED, { title: "Fix invitations" })]);
      yield* Effect.yieldNow;
      assert.equal(f.toasted.length, 1);

      // The window behind: the next turn's end is a notification, and no toast.
      f.focus(false);
      notices.observeAgents([
        agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID, title: "Fix invitations" }),
      ]);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      yield* Effect.yieldNow;
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Fix invitations finished" }]);
      assert.equal(f.toasted.length, 1);
    }),
);

it.effect(
  "an end whose window went behind while what the agent published was read is posted as a notification, not toasted to nobody",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);
      notices.shown(null);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      // The window goes behind before the announcement's read has answered.
      f.focus(false);
      yield* Effect.yieldNow;
      assert.deepEqual(f.toasted, []);
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Opus 5.5 finished" }]);
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
    assert.deepEqual(f.said(), [{ title: "Luke", body: "Opus 5.5 (Anthropic) finished" }]);
  }),
);

it.effect("a pull request, once a reader hands one in, is the end the notice says", () =>
  Effect.sync(() => {
    assert.deepEqual(
      noticeText({
        planName: PLAN_NAME,
        model: MODEL,
        title: null,
        status: CODING_AGENT_STATUS.COMPLETED,
        models: undefined,
        pullRequest: 123,
      }),
      { title: PLAN_NAME, body: "Opus 5.5 opened #123" },
    );
    assert.deepEqual(
      noticeText({
        planName: PLAN_NAME,
        model: MODEL,
        title: "Sign-out button in account menu",
        status: CODING_AGENT_STATUS.COMPLETED,
        models: undefined,
      }),
      { title: PLAN_NAME, body: "Sign-out button in account menu finished" },
    );
    assert.equal(
      noticeText({
        planName: PLAN_NAME,
        model: MODEL,
        title: null,
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

      f.changeAccount(OTHER_ACCOUNT);
      assert.deepEqual(f.unseen.at(-1), []);
      // The answer that was on its way lands as a first sighting.
      notices.observeAgents([{ ...other, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* TestClock.adjust(WATCH);
      assert.equal(f.posted.length, 1);
      assert.deepEqual(f.listed, []);
    }),
);

it.effect(
  "the account's session renewing mid-run is the same account: its agents stay watched and the end is announced",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      f.answer(PLAN_ID, { agents: [agent(CODING_AGENT_STATUS.COMPLETED)] });

      f.changeAccount(ACCOUNT);
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.listed, [PLAN_ID]);
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Opus 5.5 finished" }]);
    }),
);

it.effect(
  "with notifications turned off, an end behind the window posts nothing, yet dots its tab, and the window in front still says it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.notify(false);
      f.focus(false);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      f.answer(PLAN_ID, { agents: [agent(CODING_AGENT_STATUS.COMPLETED)] });
      yield* TestClock.adjust(WATCH);
      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      // Turned back on, the next end behind the window is posted again.
      f.notify(true);
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { turnId: NEXT_TURN_ID })]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.FAILED, { turnId: NEXT_TURN_ID })]);
      yield* Effect.yieldNow;
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Opus 5.5 failed" }]);

      // The toast is the window's own, not a notification, so the setting leaves it.
      f.notify(false);
      f.focus(true);
      const other = "a1b2c3d4-0000-4000-8000-000000000021";
      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { id: other })]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { id: other })]);
      yield* Effect.yieldNow;
      assert.equal(f.posted.length, 1);
      assert.deepEqual(
        f.toasted.map(({ words }) => words),
        ["Opus 5.5 finished"],
      );
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
        { title: PLAN_NAME, body: "Opus 5.5 opened #123" },
        { title: PLAN_NAME, body: "Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Opus 5.5 finished" },
        { title: PLAN_NAME, body: "Opus 5.5 failed" },
      ]);
      assert.deepEqual(f.readPullRequests, [opened, branchOnly, unanswered]);
      f.posted[0]?.onClick();
      assert.deepEqual(f.opened, [{ planId: PLAN_ID, agentId: opened }]);
    }),
);

/**
 * Every step the inbox read has to take, taken: the accounts' stream hands
 * the account on, the read it switched to asks, and the look writes what
 * was answered, each on a fiber of its own.
 */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** An item waiting on the developer, as the account's inbox read carries it. */
function waitingItem(id: string, patch: Partial<AccountInboxEntry> = {}): AccountInboxEntry {
  return {
    id,
    planId: PLAN_ID,
    agentId: AGENT_ID,
    agentTitle: "Fix invitations",
    agentModel: MODEL,
    title: "Push to the release branch?",
    revision: 1,
    postedAt: READ_AT,
    updatedAt: READ_AT,
    ...patch,
  };
}

/** When the service read each answer, by its clock: the instant every item is posted at unless a test says. */
const READ_AT = 1_800_000_000_000;

const ITEM_A = "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a";
const ITEM_B = "6f3e8d4b-2c5a-4f7b-9d0e-1a2b3c4d5e6f";
const ITEM_C = "7a4f9e5c-3d6b-4a8c-8e1f-2b3c4d5e6f7a";

it.effect(
  "the first answer of what waits is where the account stands: each plan's items are written and the Dock counts them, and nothing is announced",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({
        items: [
          waitingItem(ITEM_A),
          waitingItem(ITEM_B, { planId: OTHER_PLAN_ID }),
          waitingItem(ITEM_C),
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;

      assert.deepEqual(f.waiting.at(-1), [
        { planId: PLAN_ID, items: [ITEM_A, ITEM_C] },
        { planId: OTHER_PLAN_ID, items: [ITEM_B] },
      ]);
      assert.equal(f.badges.at(-1), 3);
      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.inboxReads, [INBOX_CURSOR_START, "1"]);
    }),
);

it.effect(
  "an item that opens behind the window is announced once, as the plan's name over the agent and the item's title, and its click opens the plan's Inbox; one posted again while it waits announces nothing, and one posted again after it was answered is announced again",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      f.answerInbox({
        items: [
          waitingItem(ITEM_B, { agentTitle: null, title: "CSV or JSON?" }),
          waitingItem(ITEM_A, { revision: 2 }),
        ],
        cursor: "2",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.said(), [{ title: PLAN_NAME, body: "Opus 5.5: CSV or JSON?" }]);
      assert.equal(f.badges.at(-1), 2);
      f.posted[0]?.onClick();
      assert.deepEqual(f.openedInboxes, [PLAN_ID]);

      // The developer answers A, and its agent posts it again under the same key.
      f.answerInbox({
        items: [waitingItem(ITEM_B, { title: "CSV or JSON?" })],
        cursor: "3",
        readAt: READ_AT,
      });
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { revision: 3 }),
          waitingItem(ITEM_B, { title: "CSV or JSON?" }),
        ],
        cursor: "4",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.said(), [
        { title: PLAN_NAME, body: "Opus 5.5: CSV or JSON?" },
        { title: PLAN_NAME, body: "Fix invitations: Push to the release branch?" },
      ]);
    }),
);

it.effect(
  "an item that opens while the window is focused on its plan's Inbox is announced nowhere; focused anywhere else it is the window's toast and no notification; behind with notifications off it is posted nowhere, yet counted",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);
      notices.shownInbox(PLAN_ID);
      f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "2", readAt: READ_AT });
      yield* settled;
      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.inboxToasted, []);

      // The Inbox of another plan is not this one's.
      notices.shownInbox(OTHER_PLAN_ID);
      f.answerInbox({
        items: [waitingItem(ITEM_B), waitingItem(ITEM_A)],
        cursor: "3",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.inboxToasted, [
        {
          planId: PLAN_ID,
          itemId: ITEM_B,
          words: "Fix invitations: Push to the release branch?",
          detail: PLAN_NAME,
        },
      ]);
      assert.deepEqual(f.posted, []);

      f.notify(false);
      f.focus(false);
      f.answerInbox({
        items: [waitingItem(ITEM_C), waitingItem(ITEM_B), waitingItem(ITEM_A)],
        cursor: "4",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.posted, []);
      assert.equal(f.inboxToasted.length, 1);
      assert.equal(f.badges.at(-1), 3);
    }),
);

it.effect(
  "another account ends the read held for the last and lets go of its items, its counts, and its badge, and its first answer is where it stands; nobody signed in reads nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      yield* settled;
      assert.equal(f.badges.at(-1), 1);

      f.changeAccount(OTHER_ACCOUNT);
      yield* settled;
      assert.deepEqual(f.waiting.at(-1), []);
      assert.equal(f.badges.at(-1), 0);
      // The read held for the last account is let go: the next account reads from the start.
      assert.deepEqual(f.inboxReads, [INBOX_CURSOR_START, "1", INBOX_CURSOR_START]);

      // The next answer is the new account's first, which announces nothing it holds.
      f.answerInbox({
        items: [waitingItem(ITEM_B), waitingItem(ITEM_C)],
        cursor: "7",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.posted, []);
      assert.equal(f.badges.at(-1), 2);

      f.changeAccount(undefined);
      yield* settled;
      assert.deepEqual(f.waiting.at(-1), []);
      assert.equal(f.badges.at(-1), 0);
      assert.deepEqual(f.inboxReads, [INBOX_CURSOR_START, "1", INBOX_CURSOR_START, "7"]);
    }),
);

it.effect("a read of what waits that did not answer is asked again on the watch's clock", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* f.notices;
    f.answerInbox({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    yield* settled;
    assert.deepEqual(f.inboxReads, [INBOX_CURSOR_START]);

    yield* TestClock.adjust(WATCH);
    assert.deepEqual(f.inboxReads, [INBOX_CURSOR_START, INBOX_CURSOR_START]);
  }),
);

it.effect(
  "an item back in what waits unchanged since before the last answer was read, as a plan brought back from the archive brings its items, is counted and announced nowhere",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      f.answerInbox({
        items: [
          waitingItem(ITEM_A),
          waitingItem(ITEM_B, { planId: OTHER_PLAN_ID, updatedAt: READ_AT - 2 * 86_400_000 }),
        ],
        cursor: "2",
        readAt: READ_AT + 60_000,
      });
      yield* settled;
      assert.deepEqual(f.posted, []);
      assert.equal(f.badges.at(-1), 2);
    }),
);
