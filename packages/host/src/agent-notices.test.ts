import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry, AccountPlanlessEntry } from "@luke/features/account-inbox-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentListAnswer,
  type CodingAgentPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import { Duration, Effect, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  type AgentEndToast,
  type AgentNotice,
  AgentNoticeDoors,
  type AgentPlace,
  createAgentNotices,
  type InboxItemToast,
} from "./agent-notices.js";
import type { AppInboxPlan, AppInboxPlanHolding, AppInboxSlice } from "./app-state.js";

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
  const badges: number[] = [];
  const doors = Layer.succeed(AgentNoticeDoors, {
    post: (notice) => posted.push(notice),
    toast: (end) => toasted.push(end),
    toastInbox: (item) => inboxToasted.push(item),
    badge: (count) => badges.push(count),
  });
  const inboxReads: string[] = [];
  const waiting: (readonly AppInboxPlan[])[] = [];
  const holding: (readonly AppInboxPlanHolding[])[] = [];
  const planless: AppInboxSlice["planless"][] = [];
  const openedInboxes: string[] = [];
  let inboxAnswers: Queue.Queue<CodingAgentAccountInboxAnswerView> | undefined;
  let accounts: Queue.Queue<string | undefined> | undefined;
  const opened: AgentPlace[] = [];
  const openedPlanless: {
    readonly agentId: string;
    readonly itemId: string;
    readonly workspaceId?: string;
  }[] = [];
  const unseen: (readonly string[])[] = [];
  const answers = new Map<string, CodingAgentListAnswer[]>();
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
      accountId: () => accountId,
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
      onInboxChanged: (next) => {
        waiting.push(next.waiting);
        holding.push(next.plans);
        planless.push(next.planless);
      },
      openInbox: (planId) => openedInboxes.push(planId),
      openPlanlessItem: (item) => openedPlanless.push(item),
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
    openedPlanless,
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
    /** The account's inbox read answered, as the host answers the one standing; no plan holds an item but where the answer says. */
    answerInbox: (answer: InboxAnswerGiven) => {
      assert.ok(inboxAnswers);
      Queue.offerUnsafe(inboxAnswers, "failure" in answer ? answer : { plans: [], ...answer });
    },
    inboxReads,
    waiting,
    holding,
    planless,
    badges,
    inboxToasted,
    openedInboxes,
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
      const otherPlan = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
      const otherAgent = "a3e4f5a6-5f4a-4fad-8d88-8b6e9c4a5d43";
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { title: "Push to the release branch?", postedAt: READ_AT - 60_000 }),
          waitingItem(ITEM_B, {
            planId: otherPlan,
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
          planId: PLAN_ID,
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
          planId: otherPlan,
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
it.effect(
  "an agent with no plan, named by a message's answer, is passed over: no plan's list is read for it and nothing is announced of it",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const notices = yield* f.notices;
      f.focus(false);

      notices.observeMessaged({ ...agent(CODING_AGENT_STATUS.RUNNING), planId: null });
      yield* TestClock.adjust(WATCH);

      assert.equal(f.listReads(), 0);
      assert.deepEqual(f.listed, []);
      assert.deepEqual(f.posted, []);
    }),
);
/** An item of an agent with no plan waiting on the developer, as the account's inbox read carries it. */
function planlessItem(id: string, patch: Partial<AccountPlanlessEntry> = {}): AccountPlanlessEntry {
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
        planless: [planlessItem(ITEM_B, { updatedAt: READ_AT + 1, workspaceId: "workspace-acme" })],
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
      assert.deepEqual(f.openedPlanless, [
        { agentId: AGENT_ID, itemId: ITEM_B, workspaceId: "workspace-acme" },
      ]);
      assert.deepEqual(
        f.opened,
        [],
        "it opens the item in the window's Inbox, not the agent's page",
      );
      assert.deepEqual(
        f.planless.at(-1)?.map((item) => item.workspaceId),
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
        planlessItem(ITEM_B, {
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
        planless: [planlessItem(ITEM_A, { automationName })],
        automations: [],
        cursor: "4",
        readAt: READ_AT,
      });
      f.answerInbox(answer("Nightly flake sweep"));
      yield* settled;

      f.answerInbox(answer("Flake sweep, nightly"));
      yield* settled;

      assert.deepEqual(
        f.planless.at(-1)?.map((item) => item.automationName),
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
          workspaceId === undefined ? planlessItem(ITEM_A) : planlessItem(ITEM_A, { workspaceId }),
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
        f.planless.at(-1)?.map((item) => item.workspaceId),
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
      const teamPlan = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { startedBy: ACCOUNT_ID }),
          waitingItem(ITEM_B, { planId: teamPlan, startedBy: teammate }),
        ],
        plans: [
          { planId: PLAN_ID, items: 1, updatedAt: READ_AT },
          { planId: teamPlan, items: 1, updatedAt: READ_AT },
        ],
        cursor: "1",
        readAt: READ_AT,
      });
      yield* settled;
      f.answerInbox({
        items: [
          waitingItem(ITEM_A, { startedBy: ACCOUNT_ID }),
          waitingItem(ITEM_B, { planId: teamPlan, startedBy: teammate }),
          waitingItem(ITEM_C, { planId: teamPlan, startedBy: teammate, updatedAt: READ_AT + 1 }),
        ],
        plans: [
          { planId: PLAN_ID, items: 1, updatedAt: READ_AT },
          { planId: teamPlan, items: 2, updatedAt: READ_AT + 1 },
        ],
        cursor: "2",
        readAt: READ_AT + 1,
      });
      yield* settled;

      assert.deepEqual(
        f.waiting.at(-1)?.map((plan) => plan.planId),
        [PLAN_ID],
      );
      assert.equal(f.badges.at(-1), 1);
      assert.deepEqual(f.said(), []);
      assert.deepEqual(
        f.holding.at(-1)?.map((holding) => holding.planId),
        [PLAN_ID, teamPlan],
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
          planlessItem(ITEM_A, { startedBy: ACCOUNT_ID, updatedAt: READ_AT + 1 }),
          planlessItem(ITEM_B, { startedBy: "user-charles", updatedAt: READ_AT + 1 }),
        ],
        cursor: "2",
        readAt: READ_AT + 1,
      });
      yield* settled;

      assert.equal(f.badges.at(-1), 1);
      assert.equal(f.said().length, 1);
    }),
);
