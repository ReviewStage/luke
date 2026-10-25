// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { type CodingAgentInboxChanged, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_STATUS,
  type InboxItem,
  inboxItemSchema,
} from "@luke/features/inbox-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { type AppStateSnapshot, NO_ACCESS, RUN_PROFILE } from "@luke/host/app-state";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { personPage } from "@luke/ui/person-page-model";
import { Effect, Result, Schema } from "effect";
import { afterEach } from "vitest";
import { rendererRegistry } from "../renderer-runtime.js";
import { fakeActPortAnswering, refusedOnPort } from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { appStateFirstRead } from "../use-app-state.js";
import { loadedTasksFixture, loadTasksFixture } from "./tasks-fixture-loader.js";
import { windowInboxFollower } from "./use-followed-inboxes.js";

/**
 * inbox-fixture.test.ts -- a fixture run's Inbox and person profiles sign
 * the window in as a synthetic account whose tasks hold Inbox items, which
 * the window's own follower hears from the act door in place of main: an
 * ask of each kind, a form, a notice with code, a long thread, an answered
 * item and a closed one, every item one the wire carries; and the list holds
 * the account's own tasks, which its page lists. Any other profile leaves
 * main's document as it is.
 */

type Heard = CodingAgentInboxChanged["inbox"];

afterEach(() => {
  // The window's one registry holds the document it read, so the next test's window reads its own.
  rendererRegistry.reset();
});

/** Main's document for a fixture run on `profile`: signed out, nothing read, nothing waiting. */
function fixtureRun(profile: string): AppStateSnapshot {
  const { run } = stateWith({}, {});
  return stateWith(
    {},
    {
      run: { ...run, fixtureMode: true, profile },
      account: { status: ACCOUNT_STATUS.SIGNED_OUT },
      access: NO_ACCESS,
      tasks: IDLE_TASKS_VIEW,
    },
  );
}

/** Hands the window main's document for a fixture run on `profile`, every act main would answer refused, and lands the fixture. */
function standFixtureRun(profile: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
    const { run, account, access, tasks } = fixtureRun(profile);
    handState({}, { run, account, access, tasks });
    yield* Effect.orDie(appStateFirstRead);
    yield* Effect.promise(loadTasksFixture);
  });
}

/** The first word the window's follower hears of a task's inbox. */
function firstHeard(taskId: string): Effect.Effect<Heard> {
  return Effect.callback<Heard>((resume) => {
    const stop = windowInboxFollower.follow({ kind: INBOX_SCOPE_KIND.PLAN, id: taskId }, (heard) =>
      resume(Effect.succeed(heard)),
    );
    return Effect.sync(stop);
  });
}

/** The items a heard inbox holds, which must be items rather than a failure. */
function itemsOf(heard: Heard): readonly InboxItem[] {
  assert.ok("items" in heard, `pushed items, not ${JSON.stringify(heard)}`);
  return heard.items;
}

it.effect(
  "the Inbox profile signs in and its follower hears every task main names: an ask of each kind, a form, code, a long thread, answered and closed",
  () =>
    Effect.gen(function* () {
      yield* standFixtureRun(RUN_PROFILE.INBOX);
      const fixture = loadedTasksFixture();
      assert.ok(fixture);
      const state = fixture.fixtureAppState(fixtureRun(RUN_PROFILE.INBOX));
      assert.equal(state.account.status, ACCOUNT_STATUS.SIGNED_IN);
      assert.ok(state.inbox.tasks.length > 0, "main's read names tasks holding items");

      const items: InboxItem[] = [];
      for (const holding of state.inbox.tasks) {
        const held = itemsOf(yield* firstHeard(holding.taskId));
        assert.equal(held.length, holding.items, `${holding.taskId} holds what main counts`);
        // Note that a task main says changed later than its newest item stands as still being read.
        assert.ok(Math.max(...held.map((each) => each.updatedAt)) >= holding.updatedAt);
        items.push(...held);
      }

      const uncarried = items.filter(
        (each) => !Result.isSuccess(Schema.encodeUnknownResult(inboxItemSchema)(each)),
      );
      const asks = items.flatMap((each) =>
        (each.thread ?? []).flatMap((message) => message.ask ?? []),
      );
      const kinds = new Set(asks.map((ask) => ask.type));
      const longest = Math.max(...items.map((each) => each.thread?.length ?? 0));
      const words = items.flatMap((each) => (each.thread ?? []).map((message) => message.text));
      const statuses = new Set(items.map((each) => each.status));
      const options = asks.flatMap((ask) => ("options" in ask ? ask.options : []));

      assert.deepEqual(uncarried, []);
      assert.deepEqual(kinds, new Set([INBOX_ASK.DECIDE, INBOX_ASK.DO, INBOX_ASK.ANSWER]));
      assert.ok(
        asks.some((ask) => "fields" in ask && (ask.fields?.length ?? 0) > 1),
        "a form",
      );
      assert.ok(
        options.some((option) => option.label === INBOX_APPROVAL_OPTION.APPROVE),
        "an approval",
      );
      assert.ok(
        words.some((text) => text.includes("```")),
        "a message carrying code",
      );
      assert.ok(longest >= 8, "a long thread");
      assert.ok(statuses.has(INBOX_STATUS.OPEN));
      assert.ok(statuses.has(INBOX_STATUS.ANSWERED));
      assert.ok(statuses.has(INBOX_STATUS.CLOSED));
    }),
);

it.effect(
  "the person profile's list holds every task holding items, and the account's page lists tasks assigned to it and its agents at work",
  () =>
    Effect.gen(function* () {
      yield* standFixtureRun(RUN_PROFILE.PERSON);
      const fixture = loadedTasksFixture();
      assert.ok(fixture);
      const state = fixture.fixtureAppState(fixtureRun(RUN_PROFILE.PERSON));
      const view = fixture.fixtureTasksView({ fixtureMode: true, profile: RUN_PROFILE.PERSON });
      assert.ok(view);
      assert.equal(state.account.status, ACCOUNT_STATUS.SIGNED_IN);

      const listed = new Set(view.tasks.map((task) => task.id));
      const page = personPage(state.account.id ?? "", view.tasks);

      assert.deepEqual(
        state.inbox.tasks.filter((holding) => !listed.has(holding.taskId)),
        [],
      );
      assert.ok(page.assigned.length > 1, "tasks assigned to them");
      assert.ok(page.working.length > 0, "agents of theirs at work");
      assert.ok(itemsOf(yield* firstHeard(FIXTURE_IDS.TASK)).length > 0);
    }),
);

it.effect("the Inbox profile takes a read mark, so no toast says a mark was refused", () =>
  Effect.gen(function* () {
    yield* standFixtureRun(RUN_PROFILE.INBOX);
    const fixture = loadedTasksFixture();
    assert.ok(fixture);
    const { run } = fixtureRun(RUN_PROFILE.INBOX);
    const itemId = "00000000-0000-4000-8000-000000000001";

    assert.deepEqual(
      fixture.fixtureActAnswer(run, ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
        itemId,
        unread: false,
      }),
      { answer: { id: itemId, unread: false } },
    );
    // Two of the staged items are unread.
    assert.deepEqual(fixture.fixtureActAnswer(run, ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, {}), {
      answer: { marked: 2 },
    });
  }),
);

it.effect("any other profile leaves main's document as it is, and stages no Inbox", () =>
  Effect.gen(function* () {
    yield* standFixtureRun(RUN_PROFILE.TASKS);
    const fixture = loadedTasksFixture();
    assert.ok(fixture);
    const tasks = fixtureRun(RUN_PROFILE.TASKS);

    assert.equal(fixture.fixtureAppState(tasks), tasks);
    assert.equal(
      fixture.fixtureActAnswer(tasks.run, ACT_KIND.CODING_AGENTS_INBOX_FOLLOW, {
        kind: INBOX_SCOPE_KIND.PLAN,
        id: FIXTURE_IDS.TASK,
      }),
      undefined,
    );
  }),
);
