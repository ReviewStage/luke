import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createAutomation,
  recordAutomationRun,
  settleAutomationRun,
} from "@luke/database/models/automation-store";
import { createChannel } from "@luke/database/models/channel-store";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  openTaskAgent,
  openWorkspace,
} from "@luke/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { INBOX_ASK } from "@luke/features/inbox-wire";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  markInboxItemRead,
  postInboxMessage,
  postInboxThread,
  withdrawInboxMessage,
} from "../inbox/inbox-store.js";
import { agentInboxLive, channelsLive, inboxLive, taskInboxLive } from "./live-queries.js";
import type { LiveParams, LiveQuery } from "./live-query.js";

/**
 * The inbox's live reads on the migrated capture: each write that moves
 * an inbox, through its real writer, notifies exactly the topics its
 * tables' declarations name, and one of them wakes every read that shows
 * the write. An agent's post, a member's message and its file, and a
 * read mark wake the task's and the agent's inbox on their own topics; an
 * item, a channel, an automation, and a run wake the account-level reads
 * on the account of every member the write concerns, and no one outside
 * the workspace. A read mark is notified under the transaction its answer
 * names, which is what the desktop confirms the mark on.
 *
 * Synthetic accounts, workspaces, tasks, agents, and words throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** An owner and a teammate in one workspace, the owner's task in it and an agent on the task, and an outsider in a workspace of their own. */
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

/** What an item's own write notifies: its task, its agent, its workspace, and every member's account. */
const itemTopics = (world: InboxWorld): readonly SyncTopic[] => [
  [TOPIC.TASK, world.taskId],
  [TOPIC.AGENT, world.agentId],
  [TOPIC.WORKSPACE, world.workspaceId],
  [TOPIC.ACCOUNT, world.owner],
  [TOPIC.ACCOUNT, world.teammate],
];

/** A read as one reader follows it: its definition, and the params its procedure binds. */
type Followed = readonly [LiveQuery, LiveParams<string>];

const wokenBy = (topics: readonly SyncTopic[], [query, params]: Followed) =>
  query
    .topics(params)
    .some((woken) => topics.some(([kind, id]) => woken[0] === kind && woken[1] === id));

/** Runs the write, held to exactly the topics it notifies, and fails unless each followed read is woken by one of them. */
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

/** The four reads of the world's inbox, as the member follows them. */
const inboxReadsOf = (world: InboxWorld, userId: string) => ({
  account: [inboxLive, { userId }] as const,
  task: [taskInboxLive, { userId, taskId: world.taskId }] as const,
  agent: [agentInboxLive, { userId, agentId: world.agentId }] as const,
  channels: [channelsLive, { userId, workspaceId: world.workspaceId }] as const,
});

/** The agent's question on the world's task, posted as its tool posts one; the item's id. */
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
          owner.task,
          owner.agent,
          teammate.account,
          teammate.channels,
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
        // The reply comes after the post, so it moves the item's last change.
        yield* TestClock.adjust(Duration.seconds(1));

        yield* wakes(
          postInboxMessage(world.teammate, itemId, {
            text: "Here's the trace.",
            clientKey,
            files: [
              {
                name: "trace.txt",
                mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
                data: Buffer.from("TypeError: deploy is undefined\n").toString("base64"),
              },
            ],
          }),
          itemTopics(world),
          [teammate.account, teammate.task, teammate.agent, teammate.channels],
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
          [teammate.account, teammate.task, teammate.agent],
        );
        assert.ok(marked.value !== false && marked.value.txid !== undefined, "the mark moved");
        assert.deepEqual(marked.txids, [marked.value.txid]);
      }),
  );

  it.effect("a channel made in the workspace wakes every member's channels", () =>
    Effect.gen(function* () {
      const world = yield* openInboxWorld;
      const owner = inboxReadsOf(world, world.owner);

      yield* wakes(
        Effect.map(
          createChannel(
            world.teammate,
            world.workspaceId,
            { name: "deploys", purpose: "Where previews ship.", project: false },
            yield* DateTime.nowAsDate,
          ),
          (made) => assert.ok(Result.isSuccess(made), "the channel was made"),
        ),
        [
          [TOPIC.WORKSPACE, world.workspaceId],
          [TOPIC.ACCOUNT, world.owner],
          [TOPIC.ACCOUNT, world.teammate],
        ],
        [owner.channels],
      );
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
              taskId: world.taskId,
              name: "Nightly flaky-test sweep",
              trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
              action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
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
