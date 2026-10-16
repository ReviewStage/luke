import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_CHAT_REASON,
  type AccountChatEntry,
  type AccountFailedRun,
  type AccountInboxEntry,
  type AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
import { AUTOMATION_RUN_REASON } from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentListAnswer,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import { Duration, Effect, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  type AgentEndToast,
  type AgentNotice,
  AgentNoticeDoors,
  type AgentPlace,
  type ChatMessageToast,
  createAgentNotices,
  type FailedRunToast,
  type InboxItemToast,
} from "./agent-notices.js";
import type { AppInboxSlice, AppInboxTask, AppInboxTaskHolding } from "./app-state.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const TASK_NAME = "Teammate invitations";
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

/** An inbox read's answer as a test gives it: its plans holding items left out where none does. */
type InboxAnswerGiven =
  | Exclude<CodingAgentAccountInboxAnswerView, { readonly plans: unknown }>
  | (Omit<Extract<CodingAgentAccountInboxAnswerView, { readonly plans: unknown }>, "plans"> & {
      readonly plans?: Extract<
        CodingAgentAccountInboxAnswerView,
        { readonly plans: unknown }
      >["plans"];
    });

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
  const runsToasted: FailedRunToast[] = [];
  const chatToasted: ChatMessageToast[] = [];
  let chatOpened = 0;
  const badges: number[] = [];
  const doors = Layer.succeed(AgentNoticeDoors, {
    post: (notice) => posted.push(notice),
    toast: (end) => toasted.push(end),
    toastInbox: (item) => inboxToasted.push(item),
    toastFailedRun: (run) => runsToasted.push(run),
    toastChat: (message) => chatToasted.push(message),
    badge: (count) => badges.push(count),
  });
  const inboxReads: string[] = [];
  const waiting: (readonly AppInboxTask[])[] = [];
  const holding: (readonly AppInboxTaskHolding[])[] = [];
  const planless: AppInboxSlice["taskless"][] = [];
  const failedRuns: AppInboxSlice["failedRuns"][] = [];
  const openedAutomations: string[] = [];
  let automationsOn = true;
  const openedInboxes: string[] = [];
  let inboxAnswers: Queue.Queue<CodingAgentAccountInboxAnswerView> | undefined;
  let accounts: Queue.Queue<string | undefined> | undefined;
  const opened: AgentPlace[] = [];
  const openedTaskless: {
    readonly agentId: string;
    readonly itemId: string;
    readonly workspaceId?: string;
  }[] = [];
  const unseen: (readonly string[])[] = [];
  const answers = new Map<string, CodingAgentListAnswer[]>();
  const pages = new Map<string, CodingAgentPageAnswerView[]>();
  const readAgents: string[] = [];
  let focus: ((focused: boolean) => void) | undefined;
  let accountChanged: ((signedInAs: string | undefined) => void) | undefined;
  let signedInAs: string | undefined = ACCOUNT;
  let accountId: string | undefined = ACCOUNT_ID;
  let notifying = true;
  let listReads = 0;
  const notices = Effect.gen(function* () {
    inboxAnswers = yield* Queue.unbounded<CodingAgentAccountInboxAnswerView>();
    accounts = yield* Queue.unbounded<string | undefined>();
    Queue.offerUnsafe(accounts, signedInAs);
    return yield* createAgentNotices({
      listAgents: (taskId) =>
        Effect.sync(() => {
          listed.push(taskId);
          const queue = answers.get(taskId) ?? [];
          const answer = queue.length > 1 ? queue.shift() : queue[0];
          return answer ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        }),
      readAgent: (agentId) =>
        Effect.sync(() => {
          readAgents.push(agentId);
          const queue = pages.get(agentId) ?? [];
          const answer = queue.length > 1 ? queue.shift() : queue[0];
          return answer ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        }),
      readPullRequest: (agentId) =>
        Effect.sync(() => {
          readPullRequests.push(agentId);
          return published.get(agentId) ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        }),
      taskName: (taskId) => (taskId === TASK_ID ? TASK_NAME : undefined),
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
      accountId: () => accountId,
      onAccountChanged: (listener) => {
        accountChanged = listener;
        return () => {
          accountChanged = undefined;
        };
      },
      onTaskAgentsMoved: () => {
        listReads += 1;
      },
      readAccountInbox: (after) =>
        Effect.suspend(() => {
          inboxReads.push(after);
          assert.ok(inboxAnswers);
          return Queue.take(inboxAnswers);
        }),
      accounts: Stream.fromQueue(accounts),
      onInboxChanged: (next) => {
        waiting.push(next.waiting);
        holding.push(next.tasks);
        planless.push(next.taskless);
        failedRuns.push(next.failedRuns);
      },
      openFailedRun: (place) => openedAutomations.push(place.automationId),
      automationsOn: () => automationsOn,
      openInbox: (planId) => openedInboxes.push(planId),
      openTasklessItem: (item) => openedTaskless.push(item),
      openChat: () => {
        chatOpened += 1;
      },
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
    openedTaskless,
    unseen,
    /** The list answers a plan's reads hear, in order; the last stands for every read after it. */
    answer: (planId: string, ...queue: CodingAgentListAnswer[]) => answers.set(planId, queue),
    /** The page answers an agent's own reads hear, in order; the last stands for every read after it. */
    answerPage: (agentId: string, ...queue: CodingAgentPageAnswerView[]) =>
      pages.set(agentId, queue),
    /** Every agent read by itself, in order. */
    readAgents,
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
    /** The account's inbox read answered, as the host answers the one standing; no plan holds an item but where the answer says. */
    answerInbox: (answer: InboxAnswerGiven) => {
      assert.ok(inboxAnswers);
      Queue.offerUnsafe(inboxAnswers, "failure" in answer ? answer : { plans: [], ...answer });
    },
    inboxReads,
    waiting,
    holding,
    taskless: planless,
    badges,
    inboxToasted,
    openedInboxes,
    runsToasted,
    chatToasted,
    /** How many times a chat notification's click opened Chat. */
    chatOpened: () => chatOpened,
    failedRuns,
    openedAutomations,
    /** The account's Automations experiment. */
    turnAutomations: (on: boolean) => {
      automationsOn = on;
    },
    /** The signed-in account's id as its identity now holds it: none for one stored without it. */
    knowAccountId: (next: string | undefined) => {
      accountId = next;
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
function planlessAgent(
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

/** The agent's own page as its read answers it. */
function pageOf(held: TasklessAgent): CodingAgentPageAnswerView {
  const { automationName: _name, activityAt: _at, ...page } = held;
  return { agent: page };
}

it.effect(
  "an automation's agent with no plan, held from the plan list, is read by itself while it works and announces its end under the automation's name, its click opening its own page",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const running = planlessAgent(CODING_AGENT_STATUS.RUNNING);
      f.answerPage(AGENT_ID, pageOf(planlessAgent(CODING_AGENT_STATUS.COMPLETED)));

      notices.observeTaskless([running]);
      yield* TestClock.adjust(WATCH);

      assert.deepEqual(f.readAgents, [AGENT_ID]);
      assert.deepEqual(f.listed, []);
      assert.deepEqual(f.said(), [
        { title: AUTOMATION_NAME, body: "Triage overnight issues finished" },
      ]);
      assert.deepEqual(f.unseen.at(-1), [AGENT_ID]);
      f.posted[0]?.onClick();
      assert.deepEqual(f.opened, [{ taskId: null, agentId: AGENT_ID }]);
    }),
);
it.effect(
  "an automation's agent with no plan that fails while the window is focused elsewhere is toasted in the failed tone under the automation's name, its View going to its own page",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(true);

      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.RUNNING)]);
      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.FAILED)]);
      yield* Effect.yieldNow;

      assert.deepEqual(f.toasted, [
        {
          place: { taskId: null, agentId: AGENT_ID },
          words: "Triage overnight issues failed",
          detail: AUTOMATION_NAME,
          failed: true,
        },
      ]);
      assert.deepEqual(f.posted, []);
    }),
);
it.effect(
  "an agent with no plan named only by an act's answer is announced under the automation that answer names",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const mine = {
        ...agent(CODING_AGENT_STATUS.RUNNING, { title: "Triage overnight issues" }),
        planId: null,
        startedBy: { userId: ACCOUNT_ID, name: "Dana" },
        automationName: AUTOMATION_NAME,
      };

      notices.observeAgents([mine]);
      notices.observeAgents([{ ...mine, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* Effect.yieldNow;

      assert.deepEqual(f.said(), [
        { title: AUTOMATION_NAME, body: "Triage overnight issues finished" },
      ]);
    }),
);
it.effect(
  "an untitled automation's agent is named by its automation, as its tab names it, not by its model",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.RUNNING, { title: null })]);
      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.FAILED, { title: null })]);
      yield* Effect.yieldNow;

      assert.deepEqual(f.said(), [{ title: AUTOMATION_NAME, body: `${AUTOMATION_NAME} failed` }]);
    }),
);
it.effect(
  "a teammate's agent with no plan on the plan list is not held, so its end is announced to its starter alone",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      const theirs = { startedBy: { userId: "user-sam", name: "Sam" } };

      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.RUNNING, theirs)]);
      yield* TestClock.adjust(WATCH);
      notices.observeTaskless([planlessAgent(CODING_AGENT_STATUS.COMPLETED, theirs)]);
      yield* Effect.yieldNow;

      assert.deepEqual(f.readAgents, []);
      assert.deepEqual(f.posted, []);
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
      yield* TestClock.adjust(WATCH);

      assert.deepEqual(f.readAgents, []);
      assert.equal(f.listReads(), 0);
    }),
);
it.effect(
  "an agent with no plan named by a message's answer is watched by itself, not by a plan's list, and one deleted meanwhile is let go",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      f.answerPage(AGENT_ID, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });

      notices.observeMessaged({
        ...agent(CODING_AGENT_STATUS.RUNNING),
        planId: null,
        startedBy: { userId: ACCOUNT_ID, name: "Dana" },
      });
      yield* TestClock.adjust(WATCH);
      yield* TestClock.adjust(WATCH);

      assert.deepEqual(f.listed, []);
      assert.deepEqual(f.readAgents, [AGENT_ID]);
      assert.deepEqual(f.posted, []);
    }),
);
/** An item of an agent with no plan waiting on the developer, as the account's inbox read carries it. */
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
  "an item of an agent with no plan waits beside the plans' with its workspace and counts on the badge, and one opened since is announced by its automation, its click opening the item in the window's Inbox",
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
      assert.deepEqual(f.said(), [
        { title: "Nightly flake sweep", body: "Sweep the flaky tests: Quarantine the flaky test?" },
      ]);
      f.posted.at(-1)?.onClick();
      assert.deepEqual(f.openedTaskless, [
        { agentId: AGENT_ID, itemId: ITEM_B, workspaceId: "workspace-acme" },
      ]);
      assert.deepEqual(
        f.opened,
        [],
        "it opens the item in the window's Inbox, not the agent's page",
      );
      assert.deepEqual(
        f.taskless.at(-1)?.map((item) => item.workspaceId),
        ["workspace-acme"],
        "the window is told whose workspace's list the item stands in",
      );
    }),
);

it.effect("an item's title says a link by its name, never its address, in the notification", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* f.notices;
    f.focus(false);
    f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
    yield* settled;

    f.answerInbox({
      items: [],
      planless: [
        tasklessItem(ITEM_B, {
          title:
            "Quarantine [@flaky.test.ts](https://github.com/acme/relay/blob/HEAD/flaky.test.ts) per [LUKE-9](https://linear.app/acme/issue/LUKE-9)?",
          updatedAt: READ_AT + 1,
        }),
      ],
      cursor: "2",
      readAt: READ_AT + 2,
    });
    yield* settled;

    assert.deepEqual(f.said(), [
      {
        title: "Nightly flake sweep",
        body: "Sweep the flaky tests: Quarantine flaky.test.ts per LUKE-9?",
      },
    ]);
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
  "only the items of agents the account started wait on it: a teammate's agent's questions are neither counted, badged, nor announced, while its plan is still listed",
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
      assert.deepEqual(f.said(), []);
      assert.deepEqual(
        f.holding.at(-1)?.map((holding) => holding.taskId),
        [TASK_ID, teamTask],
      );
    }),
);

it.effect(
  "an item whose starter the service does not say waits on the account, as every item did before",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.answerInbox({ items: [waitingItem(ITEM_A)], cursor: "1", readAt: READ_AT });
      yield* settled;

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
  "a question from a teammate's agent with no plan is neither counted, badged, nor announced to the account, while its own is",
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
      assert.equal(f.said().length, 1);
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
  "a run of the account's own automation that failed to start since the last answer is announced under the automation's name, its click opening the automation, and is written for the window without counting on the badge",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
      yield* settled;

      f.answerInbox({ items: [], failedRuns: [failedRun()], cursor: "2", readAt: READ_AT + 2 });
      yield* settled;

      assert.deepEqual(f.said(), [
        {
          title: "Flaky test sweep",
          body: "A run couldn't start. Luke can no longer reach its repository on GitHub.",
        },
      ]);
      f.posted[0]?.onClick();
      assert.deepEqual(f.openedAutomations, [AUTOMATION_ID]);
      assert.deepEqual(f.failedRuns.at(-1), [failedRun()]);
      assert.equal(f.badges.at(-1), 0);
    }),
);
it.effect(
  "a run that failed to start while the window is focused is toasted under the automation's name, and is announced once however often it is carried",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(true);
      f.answerInbox({ items: [], cursor: "1", readAt: READ_AT });
      yield* settled;

      f.answerInbox({ items: [], failedRuns: [failedRun()], cursor: "2", readAt: READ_AT + 2 });
      yield* settled;
      f.answerInbox({
        items: [waitingItem(ITEM_A, { updatedAt: READ_AT })],
        failedRuns: [failedRun()],
        cursor: "3",
        readAt: READ_AT + 3,
      });
      yield* settled;

      assert.deepEqual(f.runsToasted, [
        {
          place: { automationId: AUTOMATION_ID, runId: RUN_ID, workspaceId: "workspace-acme" },
          words: "A run couldn't start. Luke can no longer reach its repository on GitHub.",
          detail: "Flaky test sweep",
        },
      ]);
      assert.deepEqual(f.posted, []);
    }),
);
it.effect(
  "a failed run the first answer carries is where the account stands and is announced nowhere, nor is one while the account has Automations off, though both are written for the window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.notices;
      f.focus(false);
      f.answerInbox({ items: [], failedRuns: [failedRun()], cursor: "1", readAt: READ_AT + 2 });
      yield* settled;
      f.turnAutomations(false);
      const later = failedRun({ id: ITEM_B, failedAt: READ_AT + 3 });

      f.answerInbox({ items: [], failedRuns: [later], cursor: "2", readAt: READ_AT + 4 });
      yield* settled;

      assert.deepEqual(f.posted, []);
      assert.deepEqual(f.failedRuns.at(-1), [later]);
    }),
);

/** A chat message waiting on the developer, as the account's read carries it. */
function chatEntry(seq: number, patch: Partial<AccountChatEntry> = {}): AccountChatEntry {
  return {
    messageId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    workspaceId: "workspace-acme",
    reason: ACCOUNT_CHAT_REASON.DIRECT,
    from: "agent-2",
    planId: TASK_ID,
    touchedSeq: seq,
    updatedAt: READ_AT,
    ...patch,
  };
}

it.effect(
  "a chat message that comes to wait is announced once by who and why under its task, never what was said: as a notification behind, in the toast in front, and nowhere while Chat is on screen; the badge counts it beside the items",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);
      // The first answer is where the account stands, and announces nothing it holds.
      f.answerInbox({ items: [], chat: [chatEntry(40)], cursor: "1", readAt: READ_AT });
      yield* settled;
      assert.equal(f.posted.length, 0);
      assert.equal(f.badges.at(-1), 1);

      f.answerInbox({
        items: [waitingItem(ITEM_A)],
        chat: [chatEntry(40), chatEntry(47, { reason: ACCOUNT_CHAT_REASON.MENTION, from: "luke" })],
        cursor: "2",
        readAt: READ_AT,
      });
      yield* settled;
      // The item and the mention that came to wait are each announced; the message already waiting is not.
      assert.deepEqual(f.said(), [
        { title: TASK_NAME, body: "@luke mentioned you" },
        { title: TASK_NAME, body: "Fix invitations: Push to the release branch?" },
      ]);
      assert.equal(f.badges.at(-1), 3);
      f.posted[0]?.onClick();
      assert.equal(f.chatOpened(), 1);

      f.focus(true);
      f.answerInbox({
        items: [waitingItem(ITEM_A)],
        chat: [
          chatEntry(40),
          chatEntry(47),
          chatEntry(51, { reason: ACCOUNT_CHAT_REASON.ASK, planId: null }),
        ],
        cursor: "3",
        readAt: READ_AT,
      });
      yield* settled;
      assert.deepEqual(f.chatToasted, [
        { messageId: chatEntry(51).messageId, words: "@agent-2 asked you", detail: "Chat" },
      ]);

      notices.shownChat(true);
      f.answerInbox({
        items: [waitingItem(ITEM_A)],
        chat: [chatEntry(40), chatEntry(47), chatEntry(51), chatEntry(52)],
        cursor: "4",
        readAt: READ_AT,
      });
      yield* settled;
      assert.equal(f.chatToasted.length, 1);
      assert.equal(f.posted.length, 2);
    }),
);
