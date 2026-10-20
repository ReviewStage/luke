import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@luke/database/core/query";
import { createAutomation, readAutomation } from "@luke/database/models/automation-store";
import { archiveCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { createTask } from "@luke/database/models/task-store";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CODING_AGENT_ARCHIVER } from "@luke/features/coding-agent-wire";
import {
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxPost,
} from "@luke/features/inbox-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { Effect, Layer, Option, Result, Stream } from "effect";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import {
  agentInboxItems,
  answerInboxItem,
  postInboxItem,
  readInboxItem,
} from "../../inbox/inbox-store.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../brain-host/eve-sessions.js";
import { type StartAsk, startCodingAgent } from "./start.js";
import { TAKEN_OVER_REASON, takeOverCodingAgent } from "./take-over.js";

/**
 * take-over.test.ts -- a teammate's coding agent taken over: a new agent of the member who asks goes on from it, and the teammate's is archived, its open inbox items and its automations moved to the new one.
 *
 * A member takes over a teammate's agent with no task, and one on a task:
 * the agent that goes on is theirs, where the source stood, handed the
 * source's brief, and the source is archived by them as taken over; the
 * source's open item is the new agent's and the member's, answered there,
 * while an answered one stays with the source, and an automation that sent
 * its runs to the source sends them to the new agent. A retry under the
 * same key answers the same agent; of two members racing, one takes the
 * work and the other's agent is archived and refused; a key spent on
 * another Start hands nothing on; no member takes over their own agent; an
 * account of another workspace reaches none, and moves nothing; and an
 * agent archived by anything else is taken over by nobody. eve is a fake at
 * the client's boundary, GitHub a script, the catalog fixed, and the store
 * PGlite. Synthetic accounts and words throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_REPOSITORY = `${RELAY.owner}/${RELAY.name}`;
/** One installation for each test's workspace, since one installation connects to one workspace and the suite's tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 8 }, (_, index) => ({
  id: 9_100 + index,
  login: RELAY.owner,
  accountId: 91_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

const TASK = "Find the flakiest test in CI this week and fix it.";

/** An item the agent asks the developer to do, open until answered. */
const PROTECT: InboxPost = {
  key: "branch-protection",
  title: "Require a review on main",
  response: { type: INBOX_RESPONSE.TODO },
  needsReply: true,
};

/** eve's coding-agent service, writing down the first message of every session opened. */
function fakeEve() {
  const opened: EveMessage[] = [];
  const sessions: EveSessions = {
    open: (message) =>
      Effect.sync(() => {
        opened.push(message);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: () => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 500 }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
    stream: () => Stream.empty,
  };
  return { opened, sessions, eve: Effect.succeed(sessions) };
}

/** What a Start reaches beside the store: GitHub reaching the repository, and the catalog. */
const services = Layer.mergeAll(
  githubReaching(INSTALLATIONS).layer,
  modelCatalogOf([
    {
      id: CODING_AGENT_DEFAULT_CHOICE.model,
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "max"],
    },
  ]),
);

/** A workspace connected to an installation reaching the repository, its owner, and a teammate in it. */
const openTeam = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const workspaceId = yield* openWorkspace(owner);
  const installation = INSTALLATIONS[installationsConnected++];
  assert.ok(installation);
  yield* connectWorkspaceGitHub(workspaceId, installation);
  const teammate = yield* openGithubUser();
  yield* joinWorkspace(workspaceId, teammate);
  return { owner, teammate, workspaceId };
});

/** A Start in the workspace with no task, under a fresh key. */
function workspaceAsk(workspaceId: string): StartAsk {
  return {
    taskId: null,
    organizationId: workspaceId,
    repository: RELAY_REPOSITORY,
    prompt: TASK,
    idempotencyKey: randomUUID(),
    choice: undefined,
  };
}

/** The owner's agent started with no task, as the agent a teammate takes over. */
const ownersAgent = (owner: string, workspaceId: string) =>
  Effect.map(
    startCodingAgent(fakeEve().eve, owner, workspaceAsk(workspaceId)).pipe(
      Effect.provide(services),
    ),
    (started) => started.agent,
  );

it.layer(getTestDB())("a teammate's agent taken over", (it) => {
  it.effect(
    "a member takes over a teammate's agent with no task: the new agent is theirs, in its workspace, handed its brief, and the source is archived by them as taken over",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const source = yield* ownersAgent(owner, workspaceId);
        const { opened, eve } = fakeEve();
        const key = randomUUID();

        const taken = yield* takeOverCodingAgent(eve, teammate, source.id, key).pipe(
          Effect.provide(services),
        );
        const again = yield* takeOverCodingAgent(eve, teammate, source.id, key).pipe(
          Effect.provide(services),
        );

        assert.deepEqual([taken.created, again.created], [true, false]);
        assert.equal(again.agent.id, taken.agent.id);
        const goesOn = Option.getOrThrow(yield* readCodingAgent(teammate, taken.agent.id));
        assert.deepEqual(
          [goesOn.userId, goesOn.taskId, goesOn.organizationId, goesOn.repository],
          [teammate, null, workspaceId, RELAY_REPOSITORY],
        );
        assert.equal(goesOn.startedFrom?.agentId, source.id);
        assert.equal(opened.length, 1, "one session opened for the agent that goes on");
        assert.ok(String(opened[0]?.message).startsWith(TASK), "handed the source's brief");
        const archived = Option.getOrThrow(yield* readCodingAgent(owner, source.id));
        assert.notEqual(archived.archivedAt, null);
        assert.deepEqual(archived.archivedBy, {
          by: CODING_AGENT_ARCHIVER.MEMBER,
          userId: teammate,
          reason: TAKEN_OVER_REASON,
          agentId: taken.agent.id,
        });
      }),
  );

  it.effect(
    "a member takes over a teammate's agent on a task, and the agent that goes on stands on that task",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const task = yield* createTask(owner, {
          organizationId: workspaceId,
          name: "Tidy the relay",
          repository: RELAY_REPOSITORY,
        });
        const { eve } = fakeEve();
        const source = yield* startCodingAgent(eve, owner, {
          taskId: task.id,
          prompt: undefined,
          idempotencyKey: randomUUID(),
          choice: undefined,
        }).pipe(Effect.provide(services));

        const taken = yield* takeOverCodingAgent(eve, teammate, source.agent.id, randomUUID()).pipe(
          Effect.provide(services),
        );

        const goesOn = Option.getOrThrow(yield* readCodingAgent(teammate, taken.agent.id));
        assert.deepEqual([goesOn.userId, goesOn.taskId], [teammate, task.id]);
        const archived = Option.getOrThrow(yield* readCodingAgent(owner, source.agent.id));
        assert.notEqual(archived.archivedAt, null);
      }),
  );

  it.effect(
    "the source's open item becomes the new agent's and the member's, and is answered there, while an answered one stays with the source",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const source = yield* ownersAgent(owner, workspaceId);
        const sourceInbox = { userId: owner, taskId: null, agentId: source.id };
        const open = yield* postInboxItem(sourceInbox, PROTECT);
        const settled = yield* postInboxItem(sourceInbox, { ...PROTECT, key: "settled" });
        assert.ok(Result.isSuccess(open) && Result.isSuccess(settled));
        const answered = yield* answerInboxItem(
          owner,
          settled.success.id,
          settled.success.revision,
          { reply: INBOX_REPLY.DONE },
          randomUUID(),
        );
        assert.ok(Option.isSome(answered));

        const taken = yield* takeOverCodingAgent(
          fakeEve().eve,
          teammate,
          source.id,
          randomUUID(),
        ).pipe(Effect.provide(services));

        const theirs = yield* agentInboxItems({ userId: teammate, agentId: taken.agent.id });
        assert.deepEqual(
          theirs.map((item) => [item.id, item.status]),
          [[open.success.id, INBOX_STATUS.OPEN]],
        );
        const left = yield* agentInboxItems({ userId: owner, agentId: source.id });
        assert.deepEqual(
          left.map((item) => item.id),
          [settled.success.id],
        );
        const answer = yield* answerInboxItem(
          teammate,
          open.success.id,
          open.success.revision,
          { reply: INBOX_REPLY.DONE },
          randomUUID(),
        );
        assert.ok(Option.isSome(answer));
        const read = Option.getOrThrow(yield* readInboxItem(teammate, open.success.id));
        assert.equal(read.item.agentId, taken.agent.id);
      }),
  );

  it.effect("an automation that sent its runs to the source sends them to the new agent", () =>
    Effect.gen(function* () {
      const { owner, teammate, workspaceId } = yield* openTeam;
      const source = yield* ownersAgent(owner, workspaceId);
      const made = yield* createAutomation(owner, {
        taskId: null,
        organizationId: workspaceId,
        repositories: [RELAY_REPOSITORY],
        name: "Flaky-test sweep",
        scope: AUTOMATION_SCOPE.WORKSPACE,
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the flakiest test." },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: new Date("2026-10-15T09:00:00Z"),
        webhookSecretHash: null,
        targetKind: AUTOMATION_TARGET.SAME_AGENT,
        targetAgentId: source.id,
      });
      const automationId = Option.getOrThrow(made).id;

      const taken = yield* takeOverCodingAgent(
        fakeEve().eve,
        teammate,
        source.id,
        randomUUID(),
      ).pipe(Effect.provide(services));

      const automation = Option.getOrThrow(yield* readAutomation(owner, automationId));
      assert.equal(automation.targetAgentId, taken.agent.id);
    }),
  );

  it.effect(
    "of two members taking over at once, the one who archives the source first takes its items, and the other's take-over is refused",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const second = yield* openGithubUser();
        yield* joinWorkspace(workspaceId, second);
        const source = yield* ownersAgent(owner, workspaceId);
        const posted = yield* postInboxItem(
          { userId: owner, taskId: null, agentId: source.id },
          PROTECT,
        );
        assert.ok(Result.isSuccess(posted));
        const first = fakeEve();
        const store = yield* Effect.context<DatabaseServices>();
        let winner: string | undefined;
        // The teammate's take-over lands whole while the second member's agent is being opened.
        const racing: EveSessions = {
          ...first.sessions,
          open: (message) =>
            Effect.gen(function* () {
              const won = yield* takeOverCodingAgent(
                first.eve,
                teammate,
                source.id,
                randomUUID(),
              ).pipe(Effect.provide(services), Effect.provide(store), Effect.orDie);
              winner = won.agent.id;
              return {
                outcome: EVE_SEND_OUTCOME.ACCEPTED,
                sessionId: `wrun_${message.conversationId}`,
              };
            }),
        };

        const lost = yield* Effect.result(
          takeOverCodingAgent(Effect.succeed(racing), second, source.id, randomUUID()).pipe(
            Effect.provide(services),
          ),
        );

        assert.ok(Result.isFailure(lost));
        assert.equal(lost.failure, HOSTED_REFUSAL.AGENT_RETIRED);
        assert.ok(winner !== undefined);
        const theirs = yield* agentInboxItems({ userId: teammate, agentId: winner });
        assert.deepEqual(
          theirs.map((item) => item.id),
          [posted.success.id],
        );
        const archived = Option.getOrThrow(yield* readCodingAgent(owner, source.id));
        assert.equal(archived.archivedBy?.userId, teammate);
      }),
  );

  it.effect(
    "the take-over's key answers the agent it made even once that agent is archived, and a second request under the same key shares its outcome",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const source = yield* ownersAgent(owner, workspaceId);
        const key = randomUUID();
        const takeOver = takeOverCodingAgent(fakeEve().eve, teammate, source.id, key).pipe(
          Effect.provide(services),
        );

        const taken = yield* takeOver;
        const shared = yield* takeOver;
        yield* archiveCodingAgent(teammate, taken.agent.id, true);
        const later = yield* takeOver;

        assert.deepEqual(
          [shared.agent.id, later.agent.id, later.created],
          [taken.agent.id, taken.agent.id, false],
        );
      }),
  );

  it.effect("a key already spent on another Start hands the source's work to nothing", () =>
    Effect.gen(function* () {
      const { owner, teammate, workspaceId } = yield* openTeam;
      const source = yield* ownersAgent(owner, workspaceId);
      const spent = workspaceAsk(workspaceId);
      yield* startCodingAgent(fakeEve().eve, teammate, spent).pipe(Effect.provide(services));

      const refused = yield* Effect.result(
        takeOverCodingAgent(fakeEve().eve, teammate, source.id, spent.idempotencyKey).pipe(
          Effect.provide(services),
        ),
      );

      assert.ok(Result.isFailure(refused));
      assert.equal(refused.failure, HOSTED_REFUSAL.INVALID_REQUEST);
      const standing = Option.getOrThrow(yield* readCodingAgent(owner, source.id));
      assert.equal(standing.archivedAt, null);
    }),
  );

  it.effect(
    "no member takes over their own agent, an account of another workspace reaches none and moves nothing, and an agent archived otherwise is taken over by nobody",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const outsider = yield* openGithubUser();
        yield* openWorkspace(outsider);
        const source = yield* ownersAgent(owner, workspaceId);
        const posted = yield* postInboxItem(
          { userId: owner, taskId: null, agentId: source.id },
          PROTECT,
        );
        assert.ok(Result.isSuccess(posted));
        const { opened, eve } = fakeEve();
        const takeOver = (userId: string) =>
          Effect.result(
            takeOverCodingAgent(eve, userId, source.id, randomUUID()).pipe(
              Effect.provide(services),
            ),
          );

        const own = yield* takeOver(owner);
        const outside = yield* takeOver(outsider);

        assert.ok(Result.isFailure(own) && Result.isFailure(outside));
        assert.deepEqual(
          [own.failure, outside.failure],
          [HOSTED_REFUSAL.NOT_PERMITTED, HOSTED_REFUSAL.NOT_FOUND],
        );
        assert.deepEqual(opened, []);
        const standing = Option.getOrThrow(yield* readCodingAgent(owner, source.id));
        assert.equal(standing.archivedAt, null);
        const items = yield* agentInboxItems({ userId: owner, agentId: source.id });
        assert.deepEqual(
          items.map((item) => item.id),
          [posted.success.id],
        );

        const first = yield* takeOver(teammate);
        assert.ok(Result.isSuccess(first));
        const third = yield* openGithubUser();
        yield* joinWorkspace(workspaceId, third);
        const late = yield* takeOver(third);
        assert.ok(Result.isFailure(late));
        assert.equal(late.failure, HOSTED_REFUSAL.AGENT_RETIRED);
      }),
  );
});
