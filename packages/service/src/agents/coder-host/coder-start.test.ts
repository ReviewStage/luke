import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { listAgents, readAgent, readAgentByKey } from "@luke/database/models/agent-store";
import { heardFromAnotherAccount } from "@luke/database/models/mac-command-store";
import { createTask, readTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { messages } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { AGENT_KIND } from "@luke/features/agent-wire";
import { AUTOMATION_FIRING, type AutomationFiring } from "@luke/features/automation-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { TASK_MODE, TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { EXPERIMENT } from "@luke/settings";
import { and, eq, isNotNull } from "drizzle-orm";
import { Deferred, Effect, ErrorReporter, Fiber, Layer, Option, Result } from "effect";
import { MESSAGE_ROLE, RUN_EVENT, RUN_TURN_ORIGIN, TURN_ORIGIN, TURN_TRIGGER } from "../../core.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { EVE_HOST_TURN } from "../eve-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveFailed,
  type EveMessage,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
} from "../eve-host/eve-sessions.js";
import { type StartAsk, startAgent } from "./start.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * coder-start.test.ts -- an agent started in a workspace with no task, as an automation's run starts one, and one started on a task.
 *
 * The Start opens one agent on no task, in the workspace named, on the
 * repository named, handed the task, and a retry under its key is that
 * agent and opens nothing again; a member who did not make the workspace
 * starts one as well, an account outside it starts nothing, and a
 * repository the workspace's installation does not reach is refused before
 * eve is asked, and a Start whose session never opened leaves no agent. An agent started on a task moves it into progress from the
 * backlog or to do, and on a task worked in pilot mode the first is its pilot,
 * refused to an account with Pilot off. eve is a fake at the client's boundary, GitHub a script,
 * the catalog fixed, and the store PGlite. Synthetic accounts and words
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_REPOSITORY = `${RELAY.owner}/${RELAY.name}`;
/** One installation for each test's workspace, since one installation connects to one workspace and the suite's tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 10 }, (_, index) => ({
  id: 8_000 + index,
  login: RELAY.owner,
  accountId: 80_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

const TASK = "Find the flakiest test in CI this week and fix it.";

/** eve's coding-agent service, writing down the first message of every session opened. */
function fakeEve() {
  const opened: EveMessage[] = [];
  const sessions: AgentSessions = {
    open: (message) =>
      Effect.sync(() => {
        opened.push(message);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: () => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 500 }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
  };
  return { opened, sessions, eve: Effect.succeed(sessions) };
}

/** What a Start reaches beside the store: GitHub reaching the repository, and the catalog. */
const services = Layer.mergeAll(
  githubReaching(INSTALLATIONS).layer,
  modelCatalogOf([
    {
      id: AGENT_DEFAULT_CHOICE.model,
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "max"],
    },
  ]),
);

/** A workspace connected to an installation reaching the repository, and its owner. */
const openConnectedWorkspace = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  yield* connectAgentApiKeys(owner);
  const workspaceId = yield* openWorkspace(owner);
  const installation = INSTALLATIONS[installationsConnected++];
  assert.ok(installation);
  yield* connectWorkspaceGitHub(workspaceId, installation);
  return { owner, workspaceId };
});

/** A Start in the workspace with no task, under a fresh key unless one is given. */
function workspaceAsk(workspaceId: string, repository = RELAY_REPOSITORY, key?: string): StartAsk {
  return {
    taskId: null,
    organizationId: workspaceId,
    repository,
    prompt: TASK,
    idempotencyKey: key ?? randomUUID(),
    choice: undefined,
  };
}

/**
 * The agent's lines once its first turn took the first message its Start
 * opened the session with, by the line's own id, as a native harness's
 * runner names it back, and whether it has heard from another account by
 * then.
 */
const openedLineTaken = (owner: string, conversationId: string, opened: readonly EveMessage[]) =>
  Effect.gen(function* () {
    const target = { userId: owner, conversationId };
    const lineId = opened[0]?.lineId;
    assert.ok(lineId !== undefined);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: turnId });
    yield* writer.consume(target, {
      conversationId: sessionKey(conversationId),
      turnId,
      sequence: 1,
      kind: RUN_EVENT.TURN_STARTED,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: 0,
    });
    const taken = yield* writer.takeAwaitingLine(target, { clientId: lineId, turnId });
    assert.equal(Result.getOrUndefined(taken)?.length, 1);

    const db = yield* Database;
    const lines = yield* db
      .select({
        sender: messages.sender,
        senderUserId: messages.senderUserId,
        metadata: messages.metadata,
        taken: isNotNull(messages.turnId),
      })
      .from(messages)
      .where(
        and(eq(messages.conversationId, conversationId), eq(messages.role, MESSAGE_ROLE.USER)),
      );
    return { lines, heard: yield* heardFromAnotherAccount(target) };
  });

it.layer(getTestDB())("an agent started in a workspace with no plan", (it) => {
  it.effect(
    "a Start opens one agent on no plan in the workspace, on the repository, handed the task, and a retry under its key opens nothing again",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const { opened, eve } = fakeEve();
        const ask = workspaceAsk(workspaceId);

        const first = yield* startAgent(eve, owner, ask).pipe(Effect.provide(services));
        const again = yield* startAgent(eve, owner, ask).pipe(Effect.provide(services));

        assert.equal(first.created, true);
        assert.deepEqual([again.created, again.agent.id], [false, first.agent.id]);
        const agent = Option.getOrThrow(yield* readAgent(owner, first.agent.id));
        assert.deepEqual(
          [agent.taskId, agent.organizationId, agent.repository, agent.prompt, agent.planSnapshot],
          [null, workspaceId, RELAY_REPOSITORY, TASK, null],
        );
        assert.deepEqual(
          opened.map((message) => message.conversationId),
          [agent.conversationId],
        );
      }),
  );

  it.effect(
    "a member who did not make the workspace starts one, and an account outside it starts nothing and opens no session",
    () =>
      Effect.gen(function* () {
        const { workspaceId } = yield* openConnectedWorkspace;
        const teammate = yield* openGithubUser();
        yield* connectAgentApiKeys(teammate);
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openGithubUser();
        yield* connectAgentApiKeys(outsider);
        yield* openWorkspace(outsider);
        const { opened, eve } = fakeEve();

        const theirs = yield* startAgent(eve, teammate, workspaceAsk(workspaceId)).pipe(
          Effect.provide(services),
        );
        const refused = yield* Effect.result(
          startAgent(eve, outsider, workspaceAsk(workspaceId)).pipe(Effect.provide(services)),
        );

        assert.equal(theirs.agent.organizationId, workspaceId);
        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure, HOSTED_REFUSAL.NOT_FOUND);
        assert.equal(opened.length, 1, "only the member's Start opened a session");
      }),
  );

  it.effect(
    "a repository the workspace's installation does not reach is refused before eve is asked",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const { opened, eve } = fakeEve();

        const refused = yield* Effect.result(
          startAgent(eve, owner, workspaceAsk(workspaceId, "Acme/Elsewhere")).pipe(
            Effect.provide(services),
          ),
        );

        assert.ok(Result.isFailure(refused));
        assert.deepEqual(opened, []);
      }),
  );

  it.effect(
    "a Start whose session never opened, eve not reached or the Start cut short before eve was asked, leaves no agent behind, and one cut short while eve was asked keeps it",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const unreached = workspaceAsk(workspaceId);
        const refused = yield* Effect.result(
          startAgent(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE), owner, unreached).pipe(
            Effect.provide(services),
          ),
        );
        // Each Start is held where it never gets past, and interrupted there.
        const cutAt = (eve: (reached: Deferred.Deferred<void>) => Effect.Effect<AgentSessions>) =>
          Effect.gen(function* () {
            const reached = yield* Deferred.make<void>();
            const ask = workspaceAsk(workspaceId);
            const starting = yield* startAgent(eve(reached), owner, ask).pipe(
              Effect.provide(services),
              Effect.forkChild,
            );
            yield* Deferred.await(reached);
            yield* Fiber.interrupt(starting);
            return yield* readAgentByKey(owner, ask.idempotencyKey);
          });
        const beforeAsking = yield* cutAt((reached) =>
          Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
        );
        const whileAsking = yield* cutAt((reached) =>
          Effect.succeed({
            ...fakeEve().sessions,
            open: () => Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
          }),
        );

        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure, HOSTED_REFUSAL.UNAVAILABLE);
        assert.ok(Option.isNone(yield* readAgentByKey(owner, unreached.idempotencyKey)));
        assert.ok(Option.isNone(beforeAsking));
        assert.ok(Option.isSome(whileAsking));
      }),
  );

  it.effect(
    "a Start no harness here could take is reported with the agent's ids, and one its plan refused is not",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const reported: Readonly<Record<string, unknown>>[] = [];
        const reporting = ErrorReporter.layer([
          ErrorReporter.make(({ attributes }) => {
            reported.push(attributes);
          }),
        ]);
        const refusing = (failed: EveFailed) =>
          Effect.succeed<AgentSessions>({
            ...fakeEve().sessions,
            open: () => Effect.succeed(failed),
          });
        const started = (failed: EveFailed) =>
          Effect.result(
            startAgent(refusing(failed), owner, workspaceAsk(workspaceId)).pipe(
              Effect.provide(Layer.merge(services, reporting)),
            ),
          );

        yield* started({
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 503,
          runtimeRefusal: RUNTIME_REFUSAL.NOT_HERE,
        });
        yield* started({
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 429,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
        });

        assert.equal(reported.length, 1);
        assert.equal(reported[0]?.reason, HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE.error);
        assert.equal(typeof reported[0]?.agentId, "string");
        assert.equal(typeof reported[0]?.conversationId, "string");
      }),
  );

  it.effect(
    "a fresh agent, whose prompt stands as its first line, the Start's brief sent by its starter, which its first turn takes by its id, has heard from no one but its starter, so its Mac is still its own, unless the automation's run that started it handed it a webhook's body",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const openedTaken = (ask: StartAsk) =>
          Effect.gen(function* () {
            const { opened, eve } = fakeEve();
            const { agent } = yield* startAgent(eve, owner, ask).pipe(Effect.provide(services));
            return yield* openedLineTaken(owner, agent.conversationId, opened);
          });
        const ranFor = (firing: AutomationFiring): StartAsk => ({
          ...workspaceAsk(workspaceId),
          automationOrigin: { name: "Triage", firing, prompt: TASK },
        });

        const byHand = yield* openedTaken(workspaceAsk(workspaceId));
        assert.deepEqual(
          byHand.lines,
          [
            {
              sender: MESSAGE_SENDER.MEMBER,
              senderUserId: owner,
              metadata: { channel: "start", brief: "prompt" },
              taken: true,
            },
          ],
          "the prompt is the conversation's one line",
        );
        assert.equal(byHand.heard, false, "by hand");
        const scheduled = yield* openedTaken(
          ranFor({ kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 }),
        );
        assert.equal(scheduled.heard, false, "a schedule's run, its owner's prompt alone");
        const hooked = yield* openedTaken(ranFor({ kind: AUTOMATION_FIRING.WEBHOOK, bytes: 2 }));
        assert.equal(hooked.heard, true, "a webhook's run, its caller's body beside the prompt");
      }),
  );
});

it.layer(getTestDB())("an agent started on a task", (it) => {
  /** A Start on the task, handed the plan, under a fresh key. */
  const taskAsk = (taskId: string): StartAsk => ({
    taskId,
    prompt: undefined,
    idempotencyKey: randomUUID(),
    choice: undefined,
  });

  it.effect(
    "moves the task into progress from the backlog or to do, and takes up one done again",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const made = (status: TaskStatus) =>
          createTask(owner, {
            organizationId: workspaceId,
            name: "Invites",
            repository: RELAY_REPOSITORY,
            status,
          });
        const filed = yield* made(TASK_STATUS.BACKLOG);
        const todo = yield* made(TASK_STATUS.TODO);
        const done = yield* made(TASK_STATUS.DONE);
        const { eve } = fakeEve();

        for (const task of [filed, todo, done]) {
          yield* startAgent(eve, owner, taskAsk(task.id)).pipe(Effect.provide(services));
        }

        const statusOf = (taskId: string) =>
          Effect.map(readTask(owner, taskId), (read) => Option.getOrUndefined(read)?.task.status);
        assert.equal(yield* statusOf(filed.id), TASK_STATUS.IN_PROGRESS);
        assert.equal(yield* statusOf(todo.id), TASK_STATUS.IN_PROGRESS);
        assert.equal(yield* statusOf(done.id), TASK_STATUS.IN_PROGRESS);
      }),
  );
  it.effect(
    "assigns its starter a task no one is assigned to when started by hand, and never one an automation's run starts or one already assigned",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const made = (assigneeId?: string) =>
          createTask(owner, {
            organizationId: workspaceId,
            name: "Invites",
            repository: RELAY_REPOSITORY,
            ...(assigneeId === undefined ? undefined : { assigneeId }),
          });
        const byHand = yield* made();
        const byAutomation = yield* made();
        const { eve } = fakeEve();

        yield* startAgent(eve, owner, taskAsk(byHand.id)).pipe(Effect.provide(services));
        yield* startAgent(eve, owner, {
          ...taskAsk(byAutomation.id),
          automationOrigin: {
            name: "Nightly",
            firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 },
            prompt: "Sweep it.",
          },
        }).pipe(Effect.provide(services));

        const assigneeOf = (taskId: string) =>
          Effect.map(
            readTask(owner, taskId),
            (read) => Option.getOrUndefined(read)?.task.assignee?.userId,
          );
        assert.equal(yield* assigneeOf(byHand.id), owner);
        assert.equal(yield* assigneeOf(byAutomation.id), undefined);
      }),
  );

  /** A task of the workspace worked in pilot mode, as the composer's Pilot starts one. */
  const pilotTask = (owner: string, workspaceId: string) =>
    Effect.gen(function* () {
      const made = yield* createTask(owner, {
        organizationId: workspaceId,
        name: "Invites",
        repository: RELAY_REPOSITORY,
      });
      const db = yield* Database;
      yield* db.update(task).set({ mode: TASK_MODE.PILOT }).where(eq(task.id, made.id));
      return made;
    });

  it.effect(
    "on a task worked in pilot mode, the first Start makes its pilot and the next a coder",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.PILOT]: true } });
        const piloted = yield* pilotTask(owner, workspaceId);
        const { eve } = fakeEve();

        const first = yield* startAgent(eve, owner, taskAsk(piloted.id)).pipe(
          Effect.provide(services),
        );
        const next = yield* startAgent(eve, owner, taskAsk(piloted.id)).pipe(
          Effect.provide(services),
        );

        assert.deepEqual([first.agent.kind, next.agent.kind], [AGENT_KIND.PILOT, AGENT_KIND.CODER]);
      }),
  );

  it.effect("refuses a pilot task's pilot to an account with Pilot off, and makes no agent", () =>
    Effect.gen(function* () {
      const { owner, workspaceId } = yield* openConnectedWorkspace;
      const piloted = yield* pilotTask(owner, workspaceId);
      const { eve } = fakeEve();

      const refused = yield* Effect.result(
        startAgent(eve, owner, taskAsk(piloted.id)).pipe(Effect.provide(services)),
      );

      assert.ok(Result.isFailure(refused));
      assert.deepEqual(refused.failure, HOSTED_REFUSAL.NOT_PERMITTED);
      assert.deepEqual(yield* listAgents(owner, piloted.id), []);
    }),
  );
});
