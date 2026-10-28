import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { heardFromAnotherAccount } from "@luke/database/models/mac-command-store";
import { createTask, readTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { messages } from "@luke/database/schemas/storage";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { AUTOMATION_FIRING, type AutomationFiring } from "@luke/features/automation-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { and, eq, isNotNull } from "drizzle-orm";
import { Effect, Layer, Option, Result, Stream } from "effect";
import { MESSAGE_ROLE } from "../../core.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
} from "../brain-host/eve-sessions.js";
import { memoryRelayState, StreamRelay } from "../brain-host/relay.js";
import { type StartAsk, startCodingAgent } from "./start.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * coder-start.test.ts -- an agent started in a workspace with no task, as an automation's run starts one, and one started on a task.
 *
 * The Start opens one agent on no task, in the workspace named, on the
 * repository named, handed the task, and a retry under its key is that
 * agent and opens nothing again; a member who did not make the workspace
 * starts one as well, an account outside it starts nothing, and a
 * repository the workspace's installation does not reach is refused before
 * eve is asked. An agent started on a task moves it into progress from the
 * backlog or to do. eve is a fake at the client's boundary, GitHub a script,
 * the catalog fixed, and the store PGlite. Synthetic accounts and words
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_REPOSITORY = `${RELAY.owner}/${RELAY.name}`;
/** One installation for each test's workspace, since one installation connects to one workspace and the suite's tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 8 }, (_, index) => ({
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
    stream: () => Stream.empty,
  };
  return { opened, eve: Effect.succeed(sessions) };
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
 * The agent's lines once eve took the first message its Start opened the
 * session with and told of it as its first turn's received message, and
 * whether it has heard from another account by then.
 */
const openedThroughRelay = (owner: string, conversationId: string, opened: readonly EveMessage[]) =>
  Effect.gen(function* () {
    const target = { userId: owner, conversationId };
    const handed = opened[0];
    assert.ok(handed !== undefined && typeof handed.message === "string");
    const relay = new StreamRelay({
      writer: yield* storeWriter({ tools: CODER_TOOL_SET }),
      asks: { binding: askRecord(), stopTurn: () => Effect.void },
      now: () => Date.UTC(2026, 9, 23),
      report: () => undefined,
    });
    const standing = {
      sessionId: `wrun_${randomUUID()}`,
      target,
      turn: BRAIN_HOST_TURN.TYPED,
      state: memoryRelayState(),
    };
    const turn = { turnId: "turn_0", sequence: 0 };
    for (const event of [
      stampedEveEvent({ type: "turn.started", data: turn }, 0),
      stampedEveEvent({ type: "message.received", data: { ...turn, message: handed.message } }, 0),
    ]) {
      yield* relay.handle(event, standing);
    }

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

        const first = yield* startCodingAgent(eve, owner, ask).pipe(Effect.provide(services));
        const again = yield* startCodingAgent(eve, owner, ask).pipe(Effect.provide(services));

        assert.equal(first.created, true);
        assert.deepEqual([again.created, again.agent.id], [false, first.agent.id]);
        const agent = Option.getOrThrow(yield* readCodingAgent(owner, first.agent.id));
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

        const theirs = yield* startCodingAgent(eve, teammate, workspaceAsk(workspaceId)).pipe(
          Effect.provide(services),
        );
        const refused = yield* Effect.result(
          startCodingAgent(eve, outsider, workspaceAsk(workspaceId)).pipe(Effect.provide(services)),
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
          startCodingAgent(eve, owner, workspaceAsk(workspaceId, "Acme/Elsewhere")).pipe(
            Effect.provide(services),
          ),
        );

        assert.ok(Result.isFailure(refused));
        assert.deepEqual(opened, []);
      }),
  );

  it.effect(
    "a fresh agent on eve, whose prompt stands as its first line, the Start's brief sent by its starter, and eve's receipt takes that line rather than writing a typed one, has heard from no one but its starter, so its Mac is still its own, unless the automation's run that started it handed it a webhook's body",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const openedOnEve = (ask: StartAsk) =>
          Effect.gen(function* () {
            const { opened, eve } = fakeEve();
            const { agent } = yield* startCodingAgent(eve, owner, ask).pipe(
              Effect.provide(services),
            );
            return yield* openedThroughRelay(owner, agent.conversationId, opened);
          });
        const ranFor = (firing: AutomationFiring): StartAsk => ({
          ...workspaceAsk(workspaceId),
          automationOrigin: { name: "Triage", firing, prompt: TASK },
        });

        const byHand = yield* openedOnEve(workspaceAsk(workspaceId));
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
        const scheduled = yield* openedOnEve(
          ranFor({ kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 }),
        );
        assert.equal(scheduled.heard, false, "a schedule's run, its owner's prompt alone");
        const hooked = yield* openedOnEve(ranFor({ kind: AUTOMATION_FIRING.WEBHOOK, bytes: 2 }));
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
          yield* startCodingAgent(eve, owner, taskAsk(task.id)).pipe(Effect.provide(services));
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

        yield* startCodingAgent(eve, owner, taskAsk(byHand.id)).pipe(Effect.provide(services));
        yield* startCodingAgent(eve, owner, {
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
});
