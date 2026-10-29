import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { renameAgent } from "@luke/database/models/agent-store";
import {
  attachRunAgent,
  createAutomation,
  deleteAutomation,
  recordAutomationRun,
  updateAutomation,
} from "@luke/database/models/automation-store";
import { storeWriter } from "@luke/database/models/writer";
import { agentTable } from "@luke/database/schemas/agent";
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
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import {
  automationRunsLive,
  automationsLive,
  automationWorkspaceRunsLive,
} from "./live-queries.js";
import type { LiveParams, LiveQuery } from "./live-query.js";

/**
 * A workspace's automations and runs (`automationsLive`,
 * `automationWorkspaceRunsLive`, `automationRunsLive`) on the migrated
 * capture: each write that moves them, through its real writer, notifies
 * the workspace's topic, which all three reads are woken on, so a
 * teammate's window hears the owner's write within a coalesce window rather
 * than at the hold's end. That holds for a member joining, an automation
 * made, changed, and deleted, a run fired and its agent started, and that
 * agent renamed and its turn queued, started, and settled. A line awaiting
 * the agent's next turn notifies its conversation alone, which the
 * transcript's own test holds (`transcript-topics.test.ts`), so these reads
 * show it with the next turn or at the hold's end.
 *
 * Synthetic accounts, workspaces, automations, agents, and turns throughout.
 */

/** A fixed instant the run events are stamped at, since no read here measures time. */
const NOW = 1_800_000_000_000;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/**
 * An owner and a teammate in one workspace, the owner's agent on no task in
 * it, and the id the owner's workspace automation will be made under.
 */
const openAutomationWorld = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  const agentId = yield* openTaskAgent(owner, workspaceId, null);
  const db = yield* Database;
  const [row] = yield* db
    .select({ conversationId: agentTable.conversationId })
    .from(agentTable)
    .where(eq(agentTable.id, agentId));
  const conversationId = row?.conversationId ?? assert.fail("the agent has no conversation");
  return { owner, teammate, workspaceId, agentId, conversationId, automationId: randomUUID() };
});

type AutomationWorld = Effect.Success<typeof openAutomationWorld>;

/** The owner's workspace automation, made under the world's id, as the settings page makes one. */
const makeAutomation = (world: AutomationWorld) =>
  Effect.map(
    createAutomation(world.owner, {
      id: world.automationId,
      organizationId: world.workspaceId,
      repositories: ["acme/api"],
      name: "Nightly flaky-test sweep",
      scope: AUTOMATION_SCOPE.WORKSPACE,
      trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix one flaky test." },
      guards: AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: null,
      webhookSecretHash: null,
    }),
    Option.getOrThrow,
  );

/** A read as one reader follows it: its definition, and the params its procedure binds. */
type Followed = readonly [LiveQuery<string, string, readonly SyncTopic[]>, LiveParams<string>];

/** The three reads as the teammate follows them: the workspace's automations and runs, and the world's automation's runs. */
const teammateReads = (world: AutomationWorld): readonly Followed[] => {
  const workspace = { userId: world.teammate, workspaceId: world.workspaceId };
  return [
    [automationsLive, workspace],
    [automationWorkspaceRunsLive, workspace],
    [automationRunsLive, { ...workspace, automationId: world.automationId }],
  ];
};

/** Runs the write, held to exactly the topics it notifies, and fails unless each of the teammate's reads is woken by one of them. */
const wakesTheTeammate = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  world: AutomationWorld,
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    for (const [query, params] of teammateReads(world)) {
      const woken = query.topics(params);
      assert.ok(
        topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
        `${query.name} is woken by a topic the write notifies`,
      );
    }
    return fired;
  });

it.layer(getTestDB())("what moves a workspace's automations notifies", (it) => {
  it.effect(
    "a member joining, an automation made, changed, and deleted, and a run fired and its agent started each wake a teammate's automations and runs",
    () =>
      Effect.gen(function* () {
        const world = yield* openAutomationWorld;
        const workspace: SyncTopic = [TOPIC.WORKSPACE, world.workspaceId];
        const owners: readonly SyncTopic[] = [workspace, [TOPIC.ACCOUNT, world.owner]];
        const newcomer = yield* openAccount;

        yield* wakesTheTeammate(
          joinWorkspace(world.workspaceId, newcomer),
          [workspace, [TOPIC.ACCOUNT, newcomer]],
          world,
        );
        const made = yield* wakesTheTeammate(makeAutomation(world), owners, world);
        yield* wakesTheTeammate(
          updateAutomation(world.owner, world.automationId, { name: "Weekly flaky-test sweep" }),
          owners,
          world,
        );
        const fired = yield* wakesTheTeammate(
          Effect.map(
            recordAutomationRun(made.value, {
              dedupeKey: randomUUID(),
              firing: { kind: AUTOMATION_FIRING.MANUAL },
              firedAt: yield* DateTime.nowAsDate,
            }),
            Option.getOrThrow,
          ),
          owners,
          world,
        );
        yield* wakesTheTeammate(attachRunAgent(fired.value.id, world.agentId), owners, world);
        yield* wakesTheTeammate(deleteAutomation(world.owner, world.automationId), owners, world);
      }),
  );

  it.effect(
    "the run's agent renamed, and its turn queued, started, and settled, each wake a teammate's automations and runs",
    () =>
      Effect.gen(function* () {
        const world = yield* openAutomationWorld;
        const made = yield* makeAutomation(world);
        const fired = Option.getOrThrow(
          yield* recordAutomationRun(made, {
            dedupeKey: randomUUID(),
            firing: { kind: AUTOMATION_FIRING.MANUAL },
            firedAt: yield* DateTime.nowAsDate,
          }),
        );
        yield* attachRunAgent(fired.id, world.agentId);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const target = { userId: world.owner, conversationId: world.conversationId };
        const turnId = randomUUID();
        const run = { conversationId: sessionKey(world.conversationId), turnId };
        const agent: readonly SyncTopic[] = [
          [TOPIC.AGENT, world.agentId],
          [TOPIC.WORKSPACE, world.workspaceId],
        ];
        const turn: readonly SyncTopic[] = [[TOPIC.CONVERSATION, world.conversationId], ...agent];

        yield* wakesTheTeammate(
          renameAgent(world.owner, world.agentId, "Flaky-test sweep"),
          agent,
          world,
        );
        yield* wakesTheTeammate(
          writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" }),
          turn,
          world,
        );
        yield* wakesTheTeammate(
          writer.consume(target, {
            ...run,
            kind: RUN_EVENT.TURN_STARTED,
            sequence: 1,
            origin: RUN_TURN_ORIGIN.TYPED,
            trigger: TURN_TRIGGER.ASK,
            at: NOW,
          }),
          turn,
          world,
        );
        yield* wakesTheTeammate(
          writer.consume(target, {
            ...run,
            kind: RUN_EVENT.TURN_ENDED,
            sequence: 2,
            status: RUN_STATUS.SUCCEEDED,
            responseIds: [],
            at: NOW,
          }),
          turn,
          world,
        );
      }),
  );
});
