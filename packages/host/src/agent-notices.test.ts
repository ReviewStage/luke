import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type {
  AccountFailedRun,
  AccountInboxEntry,
  AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
import { AUTOMATION_RUN_REASON } from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_KIND,
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { Effect, Layer, Queue, Stream } from "effect";
import { type AgentNotice, AgentNoticeDoors, createAgentNotices } from "./agent-notices.js";
import type { AppInboxSlice, AppInboxTask, AppInboxTaskHolding } from "./app-state.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const MODEL = "anthropic/claude-opus-5.5";
const TURN_ID = "3f1c2b7a-9d4e-4a6b-8c1d-2e5f6a7b8c9d";
const ACCOUNT = "dean@example.com";
const OTHER_ACCOUNT = "sam@example.com";

function agent(
  status: CodingAgentStatus,
  patch: Partial<CodingAgentSummary> = {},
): CodingAgentSummary {
  return {
    id: AGENT_ID,
    planId: TASK_ID,
    model: MODEL,
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status,
    turnId: TURN_ID,
    ...patch,
  };
}

/** An inbox read's answer as a test gives it: its tasks holding items left out where none does. */
type InboxAnswerGiven =
  | Exclude<CodingAgentAccountInboxAnswerView, { readonly plans: unknown }>
  | (Omit<Extract<CodingAgentAccountInboxAnswerView, { readonly plans: unknown }>, "plans"> & {
      readonly plans?: Extract<
        CodingAgentAccountInboxAnswerView,
        { readonly plans: unknown }
      >["plans"];
    });

/**
 * The notices over a scripted host: the account's inbox read holds until the
 * test answers it, and everything posted, badged, and written is kept for
 * the test to read. Electron's doors are a Layer of the test's own that
 * records what leaves through each.
 */
function fixture() {
  const posted: AgentNotice[] = [];
  let channelsOn = false;
  const badges: number[] = [];
  /** Whether the badge door throws, as a platform that refuses one may. */
  let refusingBadges = false;
  const doors = Layer.succeed(AgentNoticeDoors, {
    post: (notice) => {
      posted.push(notice);
    },
    badge: (count) => {
      if (refusingBadges) throw new TypeError("Illegal invocation");
      badges.push(count);
    },
  });
  /** How many times the account's inbox was followed. */
  let inboxFollows = 0;
  const waiting: (readonly AppInboxTask[])[] = [];
  const holding: (readonly AppInboxTaskHolding[])[] = [];
  const taskless: AppInboxSlice["taskless"][] = [];
  const failedRuns: AppInboxSlice["failedRuns"][] = [];
  let inboxAnswers: Queue.Queue<CodingAgentAccountInboxAnswerView> | undefined;
  let accounts: Queue.Queue<string | undefined> | undefined;
  const unseen: (readonly string[])[] = [];
  let focus: ((focused: boolean) => void) | undefined;
  let accountChanged: ((signedInAs: string | undefined) => void) | undefined;
  let signedInAs: string | undefined = ACCOUNT;
  let accountId: string | undefined = ACCOUNT_ID;
  const notices = Effect.gen(function* () {
    inboxAnswers = yield* Queue.unbounded<CodingAgentAccountInboxAnswerView>();
    accounts = yield* Queue.unbounded<string | undefined>();
    Queue.offerUnsafe(accounts, signedInAs);
    return yield* createAgentNotices({
      onUnseenChanged: (next) => unseen.push(next),
      onPanelFocusChanged: (listener) => {
        focus = listener;
        return () => {
          focus = undefined;
        };
      },
      signedInAs: () => signedInAs,
      accountId: () => accountId,
      onAccountChanged: (listener) => {
        accountChanged = listener;
        return () => {
          accountChanged = undefined;
        };
      },
      followAccountInbox: () =>
        Stream.suspend(() => {
          inboxFollows += 1;
          assert.ok(inboxAnswers);
          return Stream.fromQueue(inboxAnswers);
        }),
      accounts: Stream.fromQueue(accounts),
      onInboxChanged: (next) => {
        waiting.push(next.waiting);
        holding.push(next.tasks);
        taskless.push(next.taskless);
        failedRuns.push(next.failedRuns);
      },
      channelsOn: () => channelsOn,
      report: () => undefined,
    });
  }).pipe(Effect.provide(doors));
  return {
    notices,
    posted,
    unseen,
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
    /** The account's inbox as the host tells it next; no task holds an item but where the answer says. */
    answerInbox: (answer: InboxAnswerGiven) => {
      assert.ok(inboxAnswers);
      Queue.offerUnsafe(inboxAnswers, "failure" in answer ? answer : { plans: [], ...answer });
    },
    inboxFollows: () => inboxFollows,
    waiting,
    holding,
    taskless,
    badges,
    failedRuns,
    /** The account's Channels experiment. */
    turnChannels: (on: boolean) => {
      channelsOn = on;
    },
    /** The signed-in account's id as its identity now holds it: none for one stored without it. */
    knowAccountId: (next: string | undefined) => {
      accountId = next;
    },
    /** Whether the badge door throws on each count. */
    refuseBadges: (on: boolean) => {
      refusingBadges = on;
    },
  };
}
it.effect(
  "the account leaving takes its agents with it, so nothing of theirs is dotted for the next",
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
      yield* settled;
      assert.deepEqual(f.unseen.at(-1), []);
    }),
);
it.effect(
  "the plan list followed live feeds the ledger: an end it carries is dotted, and a plan it drops takes its agents' dots with it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeFollowed([agent(CODING_AGENT_STATUS.RUNNING, { turnId: null })], [TASK_ID]);
      notices.observeFollowed([agent(CODING_AGENT_STATUS.RUNNING)], [TASK_ID]);
      notices.observeFollowed([agent(CODING_AGENT_STATUS.COMPLETED)], [TASK_ID]);
      yield* settled;

      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      notices.observeFollowed([], []);
      assert.deepEqual(f.unseen.at(-1), []);
    }),
);

it.effect(
  "an agent marked as read by hand loses its unseen dot while another page is shown, and a mark on an agent with no dot publishes nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);
      notices.shown(null);

      notices.observeFollowed([agent(CODING_AGENT_STATUS.RUNNING)], [TASK_ID]);
      notices.observeFollowed([agent(CODING_AGENT_STATUS.COMPLETED)], [TASK_ID]);
      yield* settled;
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      notices.seen(AGENT_ID);
      assert.deepEqual(f.unseen.at(-1), []);
      const published = f.unseen.length;
      notices.seen(AGENT_ID);
      assert.equal(f.unseen.length, published);
    }),
);

it.effect(
  "an agent the followed list no longer names on a plan it still holds, as one archived, takes its dot with it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeFollowed([agent(CODING_AGENT_STATUS.RUNNING)], [TASK_ID]);
      notices.observeFollowed([agent(CODING_AGENT_STATUS.COMPLETED)], [TASK_ID]);
      yield* settled;
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      notices.observeFollowed([], [TASK_ID]);
      assert.deepEqual(f.unseen.at(-1), []);
    }),
);

it.effect(
  "an agent a Start answered is kept through a push that does not name it yet, so its quick end is still dotted",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeFollowed([], [TASK_ID]);
      notices.observeFollowed([agent(CODING_AGENT_STATUS.COMPLETED)], [TASK_ID]);
      yield* settled;

      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);
    }),
);

it.effect(
  "an agent a Start answered that the list never names, as one archived before it did, is let go after a few pushes with its dot",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED)]);
      yield* settled;
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);

      notices.observeFollowed([], [TASK_ID]);
      notices.observeFollowed([], [TASK_ID]);
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID], "kept through a push or two that predate it");
      notices.observeFollowed([], [TASK_ID]);
      assert.deepEqual(f.unseen.at(-1), []);
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
    planId: TASK_ID,
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

/** The signed-in account's id, which names the agents it started. */
const ACCOUNT_ID = "user-dana";

/** When the service read each answer, by its clock: the instant every item is posted at unless a test says. */
const READ_AT = 1_800_000_000_000;

const ITEM_A = "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a";
const ITEM_B = "6f3e8d4b-2c5a-4f7b-9d0e-1a2b3c4d5e6f";
const ITEM_C = "7a4f9e5c-3d6b-4a8c-8e1f-2b3c4d5e6f7a";
it.effect(
  "another account ends the follow of the last and lets go of its items, its counts, and its badge, and its first answer is where it stands; nobody signed in follows nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      yield* settled;
      assert.equal(f.badges.at(-1), 1);
      assert.equal(f.inboxFollows(), 1);

      f.changeAccount(OTHER_ACCOUNT);
      yield* settled;
      assert.deepEqual(f.waiting.at(-1), []);
      assert.equal(f.badges.at(-1), 0);
      // The follow of the last account is let go: the next account's is followed anew.
      assert.equal(f.inboxFollows(), 2);

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
      assert.equal(f.inboxFollows(), 2);
    }),
);
it.effect(
  "an answer telling why there is none moves nothing, and each answer told after it is observed at once, with no read of its own",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      yield* settled;
      assert.equal(f.badges.at(-1), 1);

      f.answerInbox({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      yield* settled;
      assert.equal(f.badges.at(-1), 1);

      f.answerInbox({
        items: [waitingItem(ITEM_A), waitingItem(ITEM_B)],
        cursor: "2",
        readAt: READ_AT,
      });
      yield* settled;
      assert.equal(f.badges.at(-1), 2);
      f.answerInbox({ items: [waitingItem(ITEM_B)], cursor: "3", readAt: READ_AT });
      yield* settled;
      assert.equal(f.badges.at(-1), 1);
      assert.equal(f.inboxFollows(), 1);
    }),
);
it.effect(
  "what waits carries each open item's agent, what it asks, and when it was posted, grouped by plan as the read answered them",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      const otherTask = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
      const otherAgent = "a3e4f5a6-5f4a-4fad-8d88-8b6e9c4a5d43";
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { title: "Push to the release branch?", postedAt: READ_AT - 60_000 }),
          waitingItem(ITEM_B, {
            planId: otherTask,
            agentId: otherAgent,
            title: "Which account pays out?",
            postedAt: READ_AT - 3_600_000,
          }),
          waitingItem(ITEM_C, { title: "Expire invites after a week?", postedAt: READ_AT }),
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.waiting.at(-1), [
        {
          taskId: TASK_ID,
          items: [
            {
              id: ITEM_A,
              agentId: AGENT_ID,
              title: "Push to the release branch?",
              postedAt: READ_AT - 60_000,
            },
            {
              id: ITEM_C,
              agentId: AGENT_ID,
              title: "Expire invites after a week?",
              postedAt: READ_AT,
            },
          ],
        },
        {
          taskId: otherTask,
          items: [
            {
              id: ITEM_B,
              agentId: otherAgent,
              title: "Which account pays out?",
              postedAt: READ_AT - 3_600_000,
            },
          ],
        },
      ]);
    }),
);
/** The automation the planless agents below were started by. */
const AUTOMATION_NAME = "Morning Sentry triage";

/** An agent an automation started with no plan, as the plan list carries it, started by the signed-in account unless a test says. */
function tasklessAgent(
  status: CodingAgentStatus,
  patch: Partial<TasklessAgent> = {},
): TasklessAgent {
  return {
    ...agent(status, { title: "Triage overnight issues" }),
    planId: null,
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: AUTOMATION_NAME,
    workspaceId: "workspace-acme",
    repository: "acme/relay",
    startedBy: { userId: ACCOUNT_ID, name: "Dean" },
    activityAt: 1_800_000_000_000,
    ...patch,
  };
}

it.effect(
  "an automation's agent with no plan, held from the plan list, is dotted as its turn ends",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeTaskless([tasklessAgent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeTaskless([tasklessAgent(CODING_AGENT_STATUS.COMPLETED)]);
      yield* settled;

      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);
    }),
);
it.effect(
  "an operator's heartbeat that ended quiet leaves no dot, and one that said something leaves one",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const luke = (status: CodingAgentStatus, patch: Partial<TasklessAgent> = {}) =>
        tasklessAgent(status, {
          kind: CODING_AGENT_KIND.OPERATOR,
          automationId: null,
          repository: null,
          title: null,
          ...patch,
        });
      const said = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

      notices.observeTaskless([luke(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeTaskless([luke(CODING_AGENT_STATUS.RUNNING, { quietTurn: true })]);
      notices.observeTaskless([luke(CODING_AGENT_STATUS.COMPLETED, { quietTurn: true })]);
      yield* settled;
      assert.deepEqual(f.unseen, [], "a quiet end dots nothing");

      notices.observeTaskless([luke(CODING_AGENT_STATUS.RUNNING, { turnId: said })]);
      notices.observeTaskless([luke(CODING_AGENT_STATUS.COMPLETED, { turnId: said })]);
      yield* settled;
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);
    }),
);
it.effect(
  "a heartbeat whose end the agent's page saw first has its dot taken back once the list says it was quiet",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const luke = (status: CodingAgentStatus, patch: Partial<TasklessAgent> = {}) =>
        tasklessAgent(status, { kind: CODING_AGENT_KIND.OPERATOR, ...patch });

      // A quiet mark read mid-turn is not the end's: the page ends the turn, which reads as news.
      notices.observeTaskless([luke(CODING_AGENT_STATUS.RUNNING, { quietTurn: true })]);
      notices.observeStatus(AGENT_ID, CODING_AGENT_STATUS.COMPLETED);
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);
      notices.observeTaskless([luke(CODING_AGENT_STATUS.COMPLETED, { quietTurn: true })]);
      yield* settled;

      assert.deepEqual(f.unseen.at(-1), []);
    }),
);
it.effect(
  "a teammate's agent with no plan on the plan list is not held, so its end is dotted for its starter alone",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const theirs = { startedBy: { userId: "user-sam", name: "Sam" } };

      notices.observeTaskless([tasklessAgent(CODING_AGENT_STATUS.RUNNING, theirs)]);
      notices.observeTaskless([tasklessAgent(CODING_AGENT_STATUS.COMPLETED, theirs)]);
      yield* Effect.yieldNow;

      assert.deepEqual(f.unseen, []);
    }),
);
it.effect(
  "a teammate's agent with no plan named by an act's answer, a rename or a message on its page, is not held",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const theirs = {
        ...agent(CODING_AGENT_STATUS.RUNNING),
        planId: null,
        startedBy: { userId: "user-sam", name: "Sam" },
      };

      notices.observeAgents([theirs]);
      notices.observeMessaged(theirs);
      notices.observeAgents([{ ...theirs, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* settled;

      assert.deepEqual(f.unseen, []);
    }),
);
/** An item of an agent with no task waiting on the developer, as the account's inbox read carries it. */
function tasklessItem(id: string, patch: Partial<AccountTasklessEntry> = {}): AccountTasklessEntry {
  return {
    id,
    agentId: AGENT_ID,
    agentTitle: "Sweep the flaky tests",
    agentModel: MODEL,
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
    title: "Quarantine the flaky test?",
    revision: 1,
    postedAt: READ_AT,
    updatedAt: READ_AT,
    ...patch,
  };
}
it.effect(
  "an item of an agent with no plan waits beside the plans' with its workspace and counts on the badge",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      yield* settled;

      f.answerInbox({
        items: [waitingItem(ITEM_A)],
        planless: [tasklessItem(ITEM_B, { updatedAt: READ_AT + 1, workspaceId: "workspace-acme" })],
        automations: [
          {
            automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
            items: 1,
            updatedAt: READ_AT + 1,
          },
        ],
        cursor: "2",
        readAt: READ_AT + 2,
      });
      yield* settled;

      assert.equal(
        f.badges.at(-1),
        2,
        "the badge counts a plan's item and an agent's with no plan alike",
      );
      assert.deepEqual(
        f.taskless.at(-1)?.map((item) => item.workspaceId),
        ["workspace-acme"],
        "the window is told whose workspace's list the item stands in",
      );
    }),
);

it.effect(
  "an automation renamed with nothing waiting moving is written as the item's new name, its cursor the same",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      const answer = (automationName: string) => ({
        items: [],
        planless: [tasklessItem(ITEM_A, { automationName })],
        automations: [],
        cursor: "4",
        readAt: READ_AT,
      });
      f.answerInbox(answer("Nightly flake sweep"));
      yield* settled;

      f.answerInbox(answer("Flake sweep, nightly"));
      yield* settled;

      assert.deepEqual(
        f.taskless.at(-1)?.map((item) => item.automationName),
        ["Flake sweep, nightly"],
      );
    }),
);

it.effect(
  "a workspace first named for an item, its cursor the same, as a service newly naming it answers, is written to the window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      const answer = (workspaceId: string | undefined) => ({
        items: [],
        planless: [
          workspaceId === undefined ? tasklessItem(ITEM_A) : tasklessItem(ITEM_A, { workspaceId }),
        ],
        automations: [],
        cursor: "5",
        readAt: READ_AT,
      });
      f.answerInbox(answer(undefined));
      yield* settled;

      f.answerInbox(answer("workspace-acme"));
      yield* settled;

      assert.deepEqual(
        f.taskless.at(-1)?.map((item) => item.workspaceId),
        ["workspace-acme"],
      );
    }),
);

it.effect(
  "only the items of agents the account started wait on it: a teammate's agent's questions are neither counted nor badged, while its plan is still listed",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      const teammate = "user-charles";
      const teamTask = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { startedBy: ACCOUNT_ID }),
          waitingItem(ITEM_B, { planId: teamTask, startedBy: teammate }),
        ],
        plans: [
          { planId: TASK_ID, items: 1, updatedAt: READ_AT },
          { planId: teamTask, items: 1, updatedAt: READ_AT },
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { startedBy: ACCOUNT_ID }),
          waitingItem(ITEM_B, { planId: teamTask, startedBy: teammate }),
          waitingItem(ITEM_C, { planId: teamTask, startedBy: teammate, updatedAt: READ_AT + 1 }),
        ],
        plans: [
          { planId: TASK_ID, items: 1, updatedAt: READ_AT },
          { planId: teamTask, items: 2, updatedAt: READ_AT + 1 },
        ],
        cursor: "2",
        readAt: READ_AT + 1,
      });
      yield* settled;

      assert.deepEqual(
        f.waiting.at(-1)?.map((task) => task.taskId),
        [TASK_ID],
      );
      assert.equal(f.badges.at(-1), 1);
      assert.deepEqual(
        f.holding.at(-1)?.map((holding) => holding.taskId),
        [TASK_ID, teamTask],
      );
    }),
);

it.effect(
  "an item on a task waits on whoever the service says it waits on, its assignee, rather than its agent's starter, and moves to the account's count and badge when the task is assigned to it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      const teammate = "user-charles";
      const teamTask = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
      const answer = (reassigned: string, cursor: string) =>
        f.answerInbox({
          items: [
            waitingItem(ITEM_A, { startedBy: teammate, waitsOn: ACCOUNT_ID }),
            waitingItem(ITEM_B, { planId: teamTask, startedBy: ACCOUNT_ID, waitsOn: reassigned }),
          ],
          cursor,
          readAt: READ_AT,
        });
      answer(teammate, "1");
      yield* settled;
      const before = { badge: f.badges.at(-1), waiting: f.waiting.at(-1) };
      answer(ACCOUNT_ID, "2");
      yield* settled;

      assert.equal(before.badge, 1);
      assert.deepEqual(
        before.waiting?.map((task) => task.taskId),
        [TASK_ID],
      );
      assert.equal(f.badges.at(-1), 2);
      assert.deepEqual(
        f.waiting.at(-1)?.map((task) => task.taskId),
        [TASK_ID, teamTask],
      );
    }),
);

it.effect(
  "a task's To do count is handed the window, and one moving alone, as the reader's read of a settled item moves it, is written again while the Dock's badge stays on what waits",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      const answer = (toDo: number) =>
        f.answerInbox({
          items: [waitingItem(ITEM_A, { startedBy: ACCOUNT_ID })],
          plans: [{ planId: TASK_ID, items: 3, toDo, updatedAt: READ_AT }],
          cursor: "1",
          readAt: READ_AT,
        });
      answer(2);
      yield* settled;
      answer(1);
      yield* settled;

      assert.deepEqual(
        f.holding.map((holdings) => holdings.map((holding) => holding.toDo)),
        [[], [2], [1]],
      );
      assert.equal(f.badges.at(-1), 1);
    }),
);

it.effect(
  "an account whose id arrives after its first read stops counting a teammate's agent's questions at the next answer, though nothing past the cursor changed",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      f.knowAccountId(undefined);
      yield* f.notices;
      const teammate = "user-charles";
      const answer = {
        items: [
          waitingItem(ITEM_A, { startedBy: ACCOUNT_ID }),
          waitingItem(ITEM_B, { startedBy: teammate }),
        ],
        cursor: "1",
        readAt: READ_AT,
      };
      f.answerInbox(answer);
      yield* settled;
      const before = f.badges.at(-1);
      f.knowAccountId(ACCOUNT_ID);
      f.answerInbox(answer);
      yield* settled;

      assert.equal(before, 2);
      assert.equal(f.badges.at(-1), 1);
    }),
);

it.effect(
  "a question from a teammate's agent with no plan is neither counted nor badged for the account, while its own is",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [], planless: [], cursor: "1", readAt: READ_AT });
      yield* settled;
      f.answerInbox({
        items: [],
        planless: [
          tasklessItem(ITEM_A, { startedBy: ACCOUNT_ID, updatedAt: READ_AT + 1 }),
          tasklessItem(ITEM_B, { startedBy: "user-charles", updatedAt: READ_AT + 1 }),
        ],
        cursor: "2",
        readAt: READ_AT + 1,
      });
      yield* settled;

      assert.equal(f.badges.at(-1), 1);
    }),
);

it.effect(
  "a question from a teammate's agent with no plan is written for the window's Inbox with who started it, as every member's Inbox lists it, though it is not badged",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [], planless: [], cursor: "1", readAt: READ_AT });
      yield* settled;
      f.answerInbox({
        items: [],
        planless: [tasklessItem(ITEM_B, { startedBy: "user-charles", updatedAt: READ_AT + 1 })],
        cursor: "2",
        readAt: READ_AT + 1,
      });
      yield* settled;

      assert.deepEqual(
        f.taskless.at(-1)?.map((item) => [item.id, item.startedBy]),
        [[ITEM_B, "user-charles"]],
      );
      assert.equal(f.badges.at(-1), 0);
    }),
);

const RUN_ID = "4b5c6d7e-8f90-4a1b-8c2d-3e4f5a6b7c8d";
const AUTOMATION_ID = "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04";

/** A run of one of the account's own automations that failed to start, as the account's inbox read carries it. */
function failedRun(patch: Partial<AccountFailedRun> = {}): AccountFailedRun {
  return {
    id: RUN_ID,
    automationId: AUTOMATION_ID,
    automationName: "Flaky test sweep",
    workspaceId: "workspace-acme",
    reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
    failedAt: READ_AT + 1,
    ...patch,
  };
}

it.effect(
  "a run of the account's own automation that failed to start since the last answer is written for the window without counting on the badge",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
      yield* settled;

      f.answerInbox({ items: [], failedRuns: [failedRun()], cursor: "2", readAt: READ_AT + 2 });
      yield* settled;

      assert.deepEqual(f.failedRuns.at(-1), [failedRun()]);
      assert.equal(f.badges.at(-1), 0);
    }),
);
it.effect("a failed run the first answer carries is written for the window", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* f.notices;
    const first = failedRun();
    f.answerInbox({ items: [], failedRuns: [first], cursor: "1", readAt: READ_AT + 2 });
    yield* settled;

    assert.deepEqual(f.failedRuns.at(-1), [first]);
  }),
);

it.effect(
  "an agent's end, an Inbox item and a failed run, focused or behind, post no notification, while the dot, the counts, the badge and the Automations mark still move",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
      yield* settled;

      for (const focused of [false, true]) {
        f.focus(focused);
        const agentId = focused ? AGENT_ID : "a1b2c3d4-0000-4000-8000-000000000004";
        notices.observeAgents([agent(CODING_AGENT_STATUS.RUNNING, { id: agentId })]);
        notices.observeAgents([agent(CODING_AGENT_STATUS.COMPLETED, { id: agentId })]);
      }
      f.focus(false);
      f.answerInbox({
        items: [waitingItem(ITEM_A, { updatedAt: READ_AT + 1 })],
        failedRuns: [failedRun()],
        cursor: "2",
        readAt: READ_AT + 2,
      });
      yield* settled;

      assert.deepEqual(f.posted, []);
      assert.deepEqual(
        [...(f.unseen.at(-1) ?? [])].sort(),
        [AGENT_ID, "a1b2c3d4-0000-4000-8000-000000000004"].sort(),
      );
      assert.deepEqual(
        f.waiting.at(-1)?.flatMap((task) => task.items.map((item) => item.id)),
        [ITEM_A],
      );
      assert.equal(f.badges.at(-1), 1, "the badge counts the item");
      assert.deepEqual(f.failedRuns.at(-1), [failedRun()]);
    }),
);

it.effect(
  "with Channels on, the badge counts the open asks that wait on the account, an ask with no task addressed to it among them, and no notice or teammate's ask",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.turnChannels(true);
      const teammate = "user-charles";
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { waitsOn: ACCOUNT_ID, asking: true }),
          waitingItem(ITEM_B, { waitsOn: ACCOUNT_ID, asking: false }),
          waitingItem(ITEM_C, { waitsOn: teammate, asking: true }),
        ],
        planless: [
          tasklessItem(ITEM_B, { startedBy: teammate, waitsOn: ACCOUNT_ID, asking: true }),
          tasklessItem(ITEM_C, { startedBy: ACCOUNT_ID, waitsOn: teammate, asking: true }),
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;

      assert.equal(f.badges.at(-1), 2);
    }),
);

it.effect(
  "Channels turning on counts the badge again from what last waited, with no answer moving",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { waitsOn: ACCOUNT_ID, asking: true }),
          waitingItem(ITEM_B, { waitsOn: ACCOUNT_ID, asking: false }),
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;
      const before = f.badges.at(-1);
      f.turnChannels(true);
      notices.recount();

      assert.deepEqual([before, f.badges.at(-1)], [2, 1]);
    }),
);

it.effect("a badge door that throws loses that count alone: the next answer still badges", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* f.notices;
    f.refuseBadges(true);
    f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
    yield* settled;
    f.refuseBadges(false);
    f.answerInbox({
      items: [waitingItem(ITEM_A), waitingItem(ITEM_B)],
      cursor: "2",
      readAt: READ_AT,
    });
    yield* settled;

    assert.equal(f.badges.at(-1), 2);
  }),
);
