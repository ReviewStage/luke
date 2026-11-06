import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  createAutomation,
  recordAutomationRun,
  settleAutomationRun,
} from "@repo/database/models/automation-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  openTaskAgent,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { INBOX_ASK } from "@repo/features/inbox-wire";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  markInboxItemRead,
  postInboxMessage,
  postInboxThread,
  withdrawInboxMessage,
} from "../inbox/inbox-store.js";
import { agentInboxLive, inboxItemsLive, inboxLive, taskInboxLive } from "./live-queries.js";
import type { LiveParams, LiveQuery } from "./live-query.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const openInboxWorld = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  yield* openWorkspace(yield* openAccount);
  const task = yield* createTask(owner, { organizationId: workspaceId, name: "Preview deploys" });
  const agentId = yield* openTaskAgent(owner, workspaceId, task.id);
  return { owner, teammate, workspaceId, taskId: task.id, agentId };
});

type InboxWorld = Effect.Success<typeof openInboxWorld>;

const itemTopics = (world: InboxWorld): readonly SyncTopic[] => [
  [TOPIC.TASK, world.taskId],
  [TOPIC.AGENT, world.agentId],
  [TOPIC.WORKSPACE, world.workspaceId],
  [TOPIC.ACCOUNT, world.owner],
  [TOPIC.ACCOUNT, world.teammate],
];

type Followed = readonly [LiveQuery<string, string, readonly SyncTopic[]>, LiveParams<string>];

const wokenBy = (topics: readonly SyncTopic[], [query, params]: Followed) =>
  query
    .topics(params)
    .some((woken) => topics.some(([kind, id]) => woken[0] === kind && woken[1] === id));

const wakes = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  followed: readonly Followed[],
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    for (const read of followed) {
      assert.ok(wokenBy(topics, read), `${read[0].name} is woken by a topic the write notifies`);
    }
    return fired;
  });

const inboxReadsOf = (world: InboxWorld, userId: string) => ({
  account: [inboxLive, { userId }] as const,
  items: [inboxItemsLive, { userId, since: "0", settledSince: "0" }] as const,
  task: [taskInboxLive, { userId, taskId: world.taskId }] as const,
  agent: [agentInboxLive, { userId, agentId: world.agentId }] as const,
});

const postQuestion = (world: InboxWorld) =>
  Effect.map(
    postInboxThread(
      { userId: world.owner, taskId: world.taskId, agentId: world.agentId },
      {
        key: "deploy-region",
        title: "Where should the preview deploy?",
        body: "Two regions are free.",
        ask: { type: INBOX_ASK.DECIDE, options: [{ label: "iad1" }, { label: "sfo1" }] },
      },
    ),
    (posted) => {
      assert.ok(Result.isSuccess(posted), "the post was written");
      return posted.success.id;
    },
  );

it.layer(getTestDB())("what moves an inbox notifies", (it) => {
  it.effect(
    "an agent's post wakes the task's and the agent's inbox, and every member's account-level reads",
    () =>
      Effect.gen(function* () {
        const world = yield* openInboxWorld;
        const owner = inboxReadsOf(world, world.owner);
        const teammate = inboxReadsOf(world, world.teammate);

        yield* wakes(postQuestion(world), itemTopics(world), [
          owner.account,
          owner.items,
          owner.task,
          owner.agent,
          teammate.account,
          teammate.items,
        ]);
      }),
  );

  it.effect(
    "a member's message with a file wakes every reader of the item, and its withdrawal the task's and the agent's inbox alone",
    () =>
      Effect.gen(function* () {
        const world = yield* openInboxWorld;
        const itemId = yield* postQuestion(world);
        const teammate = inboxReadsOf(world, world.teammate);
        const clientKey = randomUUID();
        yield* TestClock.adjust(Duration.seconds(1));

        yield* wakes(
          postInboxMessage(world.teammate, itemId, {
            text: "Here's the trace.",
            clientKey,
            files: [
              {
                name: "trace.txt",
                mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
                data: Buffer.from("TypeError: deploy is undefined\n").toString("base64"),
              },
            ],
          }),
          itemTopics(world),
          [teammate.account, teammate.items, teammate.task, teammate.agent],
        );
        yield* wakes(
          withdrawInboxMessage(world.teammate, itemId, clientKey),
          [
            [TOPIC.TASK, world.taskId],
            [TOPIC.AGENT, world.agentId],
          ],
          [teammate.task, teammate.agent],
        );
      }),
  );

  it.effect(
    "a member's read mark wakes their own account's inbox and the item's task and agent, under the mark's own transaction",
    () =>
      Effect.gen(function* () {
        const world = yield* openInboxWorld;
        const itemId = yield* postQuestion(world);
        const teammate = inboxReadsOf(world, world.teammate);

        const marked = yield* wakes(
          markInboxItemRead(world.teammate, itemId),
          [
            [TOPIC.ACCOUNT, world.teammate],
            [TOPIC.TASK, world.taskId],
            [TOPIC.AGENT, world.agentId],
          ],
          [teammate.account, teammate.items, teammate.task, teammate.agent],
        );
        assert.ok(marked.value !== false && marked.value.txid !== undefined, "the mark moved");
        assert.deepEqual(marked.txids, [marked.value.txid]);
      }),
  );

  it.effect(
    "an automation made, and its run fired and failing, each wake its owner's account inbox",
    () =>
      Effect.gen(function* () {
        const world = yield* openInboxWorld;
        const owner = inboxReadsOf(world, world.owner);
        const ownerTopics: readonly SyncTopic[] = [
          [TOPIC.WORKSPACE, world.workspaceId],
          [TOPIC.ACCOUNT, world.owner],
        ];

        const made = yield* wakes(
          Effect.map(
            createAutomation(world.owner, {
              organizationId: world.workspaceId,
              name: "Nightly flaky-test sweep",
              trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
              action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix one flaky test." },
              guards: AUTOMATION_DEFAULT_GUARDS,
              nextRunAt: null,
              webhookSecretHash: null,
            }),
            Option.getOrThrow,
          ),
          ownerTopics,
          [owner.account],
        );
        const fired = yield* wakes(
          Effect.map(
            recordAutomationRun(made.value, {
              dedupeKey: randomUUID(),
              firing: { kind: AUTOMATION_FIRING.MANUAL },
              firedAt: yield* DateTime.nowAsDate,
            }),
            Option.getOrThrow,
          ),
          ownerTopics,
          [owner.account],
        );
        yield* wakes(
          settleAutomationRun(fired.value.id, {
            status: AUTOMATION_RUN_STATUS.FAILED,
            reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
          }),
          ownerTopics,
          [owner.account],
        );
      }),
  );
});
