import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentPublished,
} from "@sidecar/database/models/coding-agent-store";
import { hostTurnId } from "@sidecar/database/models/ids";
import { openPlanConversation, readPlan, savePlanText } from "@sidecar/database/models/plan-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { user } from "@sidecar/database/schemas/auth";
import { turns } from "@sidecar/database/schemas/storage";
import { getTestDB } from "@sidecar/database/testing";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
  ROLLOUT_ROLE,
  type RolloutRole,
} from "@sidecar/hosted/coding-agent-wire";
import {
  type PlanDocument,
  planDocumentSchema,
  ROLLOUT_BASE,
  type RolloutItem,
  rolloutSchema,
} from "@sidecar/hosted/plan-wire";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import {
  generateText,
  type JSONValue,
  jsonSchema,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
  tool,
} from "ai";
import { Effect, Layer, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import {
  SCRIPTED_PLANNING_REPLY,
  SCRIPTED_READ,
  SCRIPTED_READ_REPLY,
  scriptedModel,
} from "../eve/scripted-model";
import type { GitHubApp } from "../server/github/github-app";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_TURN,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
} from "../server/hosted/brain-host/bounds";
import { readRecentMessages } from "../server/hosted/brain-host/context";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState, type RelayStateStore } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { modelCatalogOf } from "../server/hosted/model-catalog";
import { type RolloutWorker, rolloutStateOf } from "../server/hosted/plan-agents";
import type { RepositorySandboxDoor } from "../server/hosted/repository-shell";
import { stampedEveEvent } from "./support/eve-events";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  NO_GITHUB,
  openGithubUser,
} from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { cutRollout, INVITATIONS_ROLLOUT } from "./support/plan-rollouts";
import { sandboxDouble } from "./support/repository-sandbox";
import { startPlan } from "./support/workspaces";

/**
 * The planning model as the hosted brain runs it, end to end in one process:
 * a plan's conversation opened and attached, a session admitted for it, the
 * scripted fixture model handed the planning instructions, the saved document
 * as its standing context, and the planning tools, and each of its steps
 * carried as eve carries them, the tool calls through the host's `runTool`
 * and every event through the relay into the store. What a caller reads
 * afterwards (the window's `readPlan`, the next turn's standing context, a
 * resumed session's seed) is what must show the model's save and the words
 * that were said. The model is scripted, so nothing here claims to prove how
 * a real model reads agreement; it proves the model is handed the document
 * and the conversation and that its update lands.
 *
 * Synthetic accounts, repositories, and words throughout.
 */

const NOW = 1_800_000_000_000;

const RELAY_PLAN = {
  name: "Teammate invitations",
} as const;

const SAVED_TEXT =
  "## Open questions\n\n- Who may invite?\n\n## Assumptions\n\n- Invites reuse `memberships` with a `pending` state.\n";

/** The saved text as the window opens it and the model is handed it: the document's body. */
const SAVED: PlanDocument = { body: SAVED_TEXT, assumptions: [] };

const CORRECTION = "Any member should be able to invite, not only admins.";

/** The repository the reading scenarios' plan is about, and the installation connected to the plan's workspace that reaches it. */
const RELAY = { owner: "acme", name: "relay", defaultBranch: "main" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const RELAY_INSTALLATION = { id: 11, login: RELAY.owner, repositories: [RELAY] } as const;

/** What the checkout answers `ls`, on one line so the record is read for it as written. */
const RELAY_LISTING = "README.md src";

/** A pull request of the rollout's, saying nothing past its title and base. */
function rolloutItem(title: string, base: RolloutItem["base"]): RolloutItem {
  return { title, scope: `${title}, and its tests.`, base, acceptance: null };
}

/** Two pull requests both on the first and not on each other. */
const SIBLINGS: readonly RolloutItem[] = [
  rolloutItem("Schema", ROLLOUT_BASE.MAIN),
  rolloutItem("Route", 1),
  rolloutItem("Screen", 1),
];

/** Each pull request on the one before it. */
const CHAIN: readonly RolloutItem[] = [
  rolloutItem("Schema", ROLLOUT_BASE.MAIN),
  rolloutItem("Route", 1),
  rolloutItem("Accept flow", 2),
];

/** A pull request as GitHub last answered it for a worker's branch. */
function pullRequest(
  number: number,
  state: CodingAgentPullRequest["state"],
  checks: CodingAgentPullRequest["checks"] = CHECK_SUMMARY.PENDING,
): CodingAgentPullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
  };
}

/** A worker at a position, live unless its newest turn failed or was stopped, as the store reads one. */
function worker(
  position: number,
  status: CodingAgentStatus,
  published: CodingAgentPullRequest | null = null,
): RolloutWorker {
  const ended = status === CODING_AGENT_STATUS.FAILED || status === CODING_AGENT_STATUS.CANCELLED;
  return { position, status, live: !ended, published };
}

/** The two ready lines of a rollout's state. */
function readyLines(rollout: readonly RolloutItem[], builders: readonly RolloutWorker[]) {
  return rolloutStateOf(rollout, { builders, keeper: undefined }).slice(-2);
}

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

/** The host over the test database, with the writer holding rows to the hosted tool set as production's does. */
const planningHost = (
  openAi: BrainHostSeams["openAi"] = () => undefined,
  spend: BrainHostSeams["spend"] = unreached("spend"),
) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
    const seams: BrainHostSeams = {
      writer: () => Effect.succeed(writer),
      userInfo: () => Effect.succeed(undefined),
      ownership: {
        reachesSession: unreached("reachesSession"),
        reachesConversation: unreached("reachesConversation"),
      },
      openAi,
      deploymentSecret: () => undefined,
      eveOrigin: () => undefined,
      titleModel: () => undefined,
      scriptedModel: () => true,
      spend,
      now: () => NOW,
    };
    return brainHost(seams);
  });

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan with a saved document and its conversation opened, as the Plans tab would leave it. */
const savedPlanWithConversation = () =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    const started = yield* startPlan(userId, RELAY_PLAN);
    const host = yield* planningHost();
    const conversationId = Option.getOrThrow(
      yield* openPlanConversation(userId, started.id),
    ).conversationId;
    return { host, userId, planId: started.id, conversationId };
  });

let minted = 0;

/** An eve session id unique to its call, sorting as eve's do: later mints sort later. */
function sessionId(): string {
  minted += 1;
  return `wrun_01P${String(minted).padStart(22, "0")}`;
}

function seat(userId: string, conversationId: string, kind: BrainHostTurn): SessionAuth {
  const own: SessionAuthContext = {
    principalId: userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: kind,
    },
  };
  return { current: own, initiator: own };
}

interface Session {
  readonly id: string;
  readonly auth: SessionAuth;
  readonly state: RelayStateStore;
  /** The session's sandbox door, as eve hands a tool `getSandbox`. */
  readonly sandbox: RepositorySandboxDoor;
}

/** A session claiming the conversation as the store hook does at its start. */
const startSession = (
  host: BrainHost,
  userId: string,
  conversationId: string,
  kind: BrainHostTurn = BRAIN_HOST_TURN.TYPED,
  sandbox: Session["sandbox"] = unreached("getSandbox"),
) =>
  Effect.gen(function* () {
    const id = sessionId();
    const auth = seat(userId, conversationId, kind);
    const starting = yield* host.admitStarting(auth, id);
    if (Result.isFailure(starting)) return assert.fail(starting.failure);
    assert.equal(yield* host.sessionStarted(starting.success, id), true);
    return { id, auth, state: memoryRelayState(), sandbox } satisfies Session;
  });

const admitted = (host: BrainHost, session: Session) =>
  Effect.flatMap(host.admit(session.auth, session.id), (admission) =>
    Result.isFailure(admission) ? Effect.die(admission.failure) : Effect.succeed(admission.success),
  );

function toolContext(session: Session, name: string): EveToolContext {
  return {
    session: { id: session.id, auth: session.auth, turn: { id: "turn_0", sequence: 0 } },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: name,
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    // SAFETY: the session's sandbox as eve hands a tool it; the double stands for the live one, and a test that opens none hands the unreached door.
    getSandbox: session.sandbox as EveToolContext["getSandbox"],
  };
}

/**
 * One turn as eve runs it: the session's prompt, the seed where a resumed
 * session has one, and the turn's standing context handed to the scripted
 * model with the turn's tools; each tool call carried through the host; and
 * every event relayed into the store. Answers what the model said.
 */
const planningTurn = (
  host: BrainHost,
  session: Session,
  eveTurnId: string,
  words: string,
  services: Layer.Layer<HttpClient.HttpClient | GitHubApp> = NO_GITHUB,
  kind: BrainHostTurn = BRAIN_HOST_TURN.TYPED,
) =>
  Effect.gen(function* () {
    const standing = yield* admitted(host, session);
    const turnKind = BRAIN_HOST_TURN_KIND[kind];
    const turn = {
      kind,
      trigger: turnKind.trigger,
      turnId: hostTurnId(session.id, eveTurnId),
    };
    const sequence = 0;
    const relay = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
      host
        .relay(
          stampedEveEvent(event, NOW),
          standing,
          { id: session.id, auth: session.auth, turn: { id: eveTurnId, sequence } },
          session.state,
          {},
        )
        .pipe(Effect.provide(noNetwork));

    const prompt = host.prompt();
    const seed = yield* host.seed(standing);
    const context = yield* host.standingContext(standing);
    const declarations = host.toolDeclarations();
    const tools: ToolSet = Object.fromEntries(
      declarations.map((declared) => [
        declared.name,
        tool({ description: declared.description, inputSchema: jsonSchema(declared.inputSchema) }),
      ]),
    );
    const instructions: SystemModelMessage[] = [
      { role: "system", content: prompt.text },
      { role: "system", content: context },
    ];
    const messages: ModelMessage[] = [
      ...(seed === undefined ? [] : [{ role: "user" as const, content: seed }]),
      { role: "user", content: words },
    ];

    yield* relay({ type: "turn.started", data: { turnId: eveTurnId, sequence } });
    yield* relay({
      type: "message.received",
      data: { turnId: eveTurnId, sequence, message: words },
    });
    for (let stepIndex = 0; ; stepIndex += 1) {
      yield* relay({
        type: "step.started",
        data: { turnId: eveTurnId, sequence, stepIndex, modelId: "m" },
      });
      const step = yield* Effect.promise(() =>
        generateText({ model: scriptedModel(), instructions, messages, tools }),
      );
      if (step.toolCalls.length === 0) {
        yield* relay({
          type: "message.completed",
          data: {
            turnId: eveTurnId,
            sequence,
            stepIndex,
            finishReason: "stop",
            message: step.text,
          },
        });
        yield* relay({
          type: "step.completed",
          data: { turnId: eveTurnId, sequence, stepIndex, finishReason: "stop" },
        });
        yield* relay({ type: "turn.completed", data: { turnId: eveTurnId, sequence } });
        return step.text;
      }
      yield* relay({
        type: "actions.requested",
        data: {
          turnId: eveTurnId,
          sequence,
          stepIndex,
          actions: step.toolCalls.map((call) => ({
            kind: "tool-call" as const,
            callId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        },
      });
      for (const call of step.toolCalls) {
        const output = yield* host
          .runTool(
            call.toolName,
            { target: standing.target, turn },
            // SAFETY: the SDK hands the call's input back as the JSON the model emitted.
            unparsedWire(call.input as WireBoundaryInput),
            toolContext(session, call.toolName),
          )
          .pipe(Effect.provide(Layer.merge(services, modelCatalogOf([]))));
        yield* relay({
          type: "action.result",
          data: {
            turnId: eveTurnId,
            sequence,
            stepIndex,
            status: "completed",
            result: {
              kind: "tool-result",
              callId: call.toolCallId,
              toolName: call.toolName,
              output,
            },
          },
        });
        messages.push(
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                input: call.input,
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                // SAFETY: a tool's result is the JSON record the host answered.
                output: { type: "json", value: output as JSONValue },
              },
            ],
          },
        );
      }
      yield* relay({
        type: "step.completed",
        data: { turnId: eveTurnId, sequence, stepIndex, finishReason: "tool-calls" },
      });
    }
  });

const readDocument = Schema.decodeUnknownSync(Schema.fromJsonString(planDocumentSchema));

/** The line the saved document follows in a standing context, as the model reads it. */
const DOCUMENT_MARKER = "[saved document]";

/** The line the plan's rollout follows in a standing context, beside the document. */
const ROLLOUT_MARKER = "[rollout]";

const readRollout = Schema.decodeUnknownSync(Schema.fromJsonString(rolloutSchema));

/** The document a standing context hands the model, on the line after its marker, failing the test where it carries none. */
function handedDocument(context: string): PlanDocument {
  const lines = context.split("\n");
  const at = lines.indexOf(DOCUMENT_MARKER);
  return at === -1
    ? assert.fail("the standing context carries no document")
    : readDocument(lines[at + 1]);
}

/** The document the Plans tab opens, failing the test where the plan does not open. */
const windowDocument = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (opened) =>
    Option.match(opened, {
      onNone: () => assert.fail("the plan did not open"),
      onSome: (found) => found.plan.document,
    }),
  );

it.layer(getTestDB())("the planning model on the hosted brain", (it) => {
  it.effect(
    "a plan's conversation is opened once, attached, and read back as the one it resumes in",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* startPlan(userId, RELAY_PLAN);

        const first = Option.getOrThrow(
          yield* openPlanConversation(userId, started.id),
        ).conversationId;
        const again = Option.getOrThrow(
          yield* openPlanConversation(userId, started.id),
        ).conversationId;

        assert.equal(again, first);
        const stored = Option.getOrThrow(yield* readPlan(userId, started.id));
        assert.equal(stored.conversationId, first);
      }),
  );

  it.effect("another account opens no conversation on a plan it does not own", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const stranger = yield* openUser;
      const started = yield* startPlan(owner, RELAY_PLAN);

      assert.ok(Option.isNone(yield* openPlanConversation(stranger, started.id)));
      const stored = Option.getOrThrow(yield* readPlan(owner, started.id));
      assert.equal(stored.conversationId, undefined);
    }),
  );

  it.effect(
    "the model is handed the saved document every turn, and its turn leaves the document as the notetaker saved it",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        yield* savePlanText(userId, planId, SAVED_TEXT);

        const reply = yield* planningTurn(host, session, "turn_0", CORRECTION);

        assert.equal(reply, SCRIPTED_PLANNING_REPLY);
        assert.deepEqual(yield* windowDocument(userId, planId), SAVED);
        assert.deepEqual(
          handedDocument(yield* host.standingContext(yield* admitted(host, session))),
          SAVED,
        );
      }),
  );

  it.effect(
    "the plan's rollout reaches the planning model beside the document once it has one, and nothing of it before",
    () =>
      Effect.gen(function* () {
        const { host, planId, userId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        const before = yield* host.standingContext(yield* admitted(host, session));

        yield* cutRollout(planId, INVITATIONS_ROLLOUT);
        const lines = (yield* host.standingContext(yield* admitted(host, session))).split("\n");

        assert.ok(!before.split("\n").includes(ROLLOUT_MARKER));
        const at = lines.indexOf(ROLLOUT_MARKER);
        assert.notEqual(at, -1);
        assert.deepEqual(readRollout(lines[at + 1]), INVITATIONS_ROLLOUT);
        assert.ok(!(lines[lines.indexOf(DOCUMENT_MARKER) + 1] ?? "").includes("Invite route"));
      }),
  );

  it.effect(
    "asked to read, the planning model reads a checkout of the plan's repository in the session's sandbox, and the token reaches no row of the record",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const host = yield* planningHost();
        const started = yield* startPlan(userId, { ...RELAY_PLAN, repository: RELAY_FULL_NAME });
        yield* connectWorkspaceGitHub(started.workspaceId, RELAY_INSTALLATION);
        const conversationId = Option.getOrThrow(
          yield* openPlanConversation(userId, started.id),
        ).conversationId;
        const sandbox = sandboxDouble((command) =>
          command === "ls" ? { exitCode: 0, stdout: RELAY_LISTING, stderr: "" } : undefined,
        );
        const session = yield* startSession(
          host,
          userId,
          conversationId,
          BRAIN_HOST_TURN.TYPED,
          sandbox.door,
        );
        const github = githubReaching([RELAY_INSTALLATION]);

        const first = yield* planningTurn(
          host,
          session,
          "turn_0",
          `${SCRIPTED_READ}ls`,
          github.layer,
        );
        const again = yield* planningTurn(
          host,
          session,
          "turn_1",
          `${SCRIPTED_READ}ls`,
          github.layer,
        );

        assert.equal(first, `${SCRIPTED_READ_REPLY} ${RELAY_LISTING}`);
        assert.equal(again, first);
        assert.equal(sandbox.clones.length, 1);
        const rows = yield* readRecentMessages(
          (yield* admitted(host, session)).target,
          HOSTED_TOOL_SET,
          10,
        );
        const record = JSON.stringify(rows);
        assert.ok(record.includes(RELAY_LISTING));
        const header = Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString(
          "base64",
        );
        for (const text of [record, JSON.stringify(sandbox.runs)]) {
          assert.equal(text.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
          assert.equal(text.includes(header), false);
        }
      }),
  );

  it.effect(
    "a plan's rollout reaches the planning model with each position's builder and pull request, its stack keeper, and what is ready; a plain agent is neither",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        const standing = yield* admitted(host, session);
        const start = (role: RolloutRole | undefined, position?: number) =>
          Effect.map(
            createCodingAgent(userId, {
              planId,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              planSnapshot: "# Relay",
              task: null,
              repository: RELAY_FULL_NAME,
              ...(role === undefined ? undefined : { role }),
              ...(position === undefined ? undefined : { position }),
            }),
            Option.getOrThrow,
          );
        const first = yield* start(ROLLOUT_ROLE.BUILDER, 1);
        yield* recordCodingAgentPublished(
          userId,
          first.agent.id,
          pullRequest(415, PULL_REQUEST_STATE.OPEN),
        );
        const plain = yield* start(undefined);
        yield* start(ROLLOUT_ROLE.KEEPER);
        yield* recordCodingAgentPublished(
          userId,
          plain.agent.id,
          pullRequest(9, PULL_REQUEST_STATE.MERGED),
        );

        yield* cutRollout(planId, SIBLINGS);
        const lines = (yield* host.standingContext(standing)).split("\n");
        const at = lines.indexOf(ROLLOUT_MARKER);
        assert.notEqual(at, -1);
        assert.deepEqual(readRollout(lines[at + 1]), SIBLINGS);
        assert.deepEqual(lines.slice(at + 2, at + 8), [
          '1. "Schema" · base: main · worker: working · pull request: #415 open',
          '2. "Route" · base: 1 · worker: none · pull request: none',
          '3. "Screen" · base: 1 · worker: none · pull request: none',
          "Stack keeper: working",
          "Ready to start: 2, 3",
          "Ready to merge: none",
        ]);
      }),
  );

  it.effect(
    "a builder that finished with its pull request open still holds its position, so it is not ready to start again; a builder past the rollout's end draws no line",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        const standing = yield* admitted(host, session);
        const builder = (position: number) =>
          Effect.map(
            createCodingAgent(userId, {
              planId,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              planSnapshot: "# Relay",
              task: null,
              repository: RELAY_FULL_NAME,
              role: ROLLOUT_ROLE.BUILDER,
              position,
            }),
            (started) => Option.getOrThrow(started).agent,
          );
        const finished = yield* builder(1);
        yield* Database.use((db) =>
          db.insert(turns).values({
            userId,
            conversationId: finished.conversationId,
            origin: TURN_ORIGIN.TYPED,
            status: TURN_STATUS.SETTLED,
            queuedAt: new Date(NOW),
            settledAt: new Date(NOW),
          }),
        );
        yield* recordCodingAgentPublished(
          userId,
          finished.id,
          pullRequest(415, PULL_REQUEST_STATE.OPEN),
        );
        // A rollout cut to three after a builder started at a fourth position.
        yield* builder(4);

        yield* cutRollout(planId, SIBLINGS);
        const lines = (yield* host.standingContext(standing)).split("\n");
        const at = lines.indexOf(ROLLOUT_MARKER);
        assert.deepEqual(lines.slice(at + 2, at + 8), [
          '1. "Schema" · base: main · worker: finished · pull request: #415 open',
          '2. "Route" · base: 1 · worker: none · pull request: none',
          '3. "Screen" · base: 1 · worker: none · pull request: none',
          "Stack keeper: none",
          "Ready to start: 2, 3",
          "Ready to merge: none",
        ]);
      }),
  );
});

describe("the rollout's state as the planning model reads it", () => {
  it("names each position's base, newest worker, and pull request, a closed one among them", () => {
    assert.deepEqual(
      rolloutStateOf(CHAIN, {
        builders: [
          worker(1, CODING_AGENT_STATUS.COMPLETED, pullRequest(415, PULL_REQUEST_STATE.MERGED)),
          worker(2, CODING_AGENT_STATUS.FAILED, pullRequest(416, PULL_REQUEST_STATE.CLOSED)),
          worker(2, CODING_AGENT_STATUS.RUNNING),
          worker(3, CODING_AGENT_STATUS.CANCELLED),
        ],
        keeper: CODING_AGENT_STATUS.RUNNING,
      }),
      [
        '1. "Schema" · base: main · worker: finished · pull request: #415 merged',
        '2. "Route" · base: 1 · worker: working · pull request: #416 closed',
        '3. "Accept flow" · base: 2 · worker: stopped · pull request: none',
        "Stack keeper: working",
        "Ready to start: none",
        "Ready to merge: none",
      ],
    );
  });

  it("a sibling pair waits on the pull request both base on, then both are ready at once", () => {
    assert.deepEqual(readyLines(SIBLINGS, []), ["Ready to start: 1", "Ready to merge: none"]);
    assert.deepEqual(readyLines(SIBLINGS, [worker(1, CODING_AGENT_STATUS.STARTING)]), [
      "Ready to start: none",
      "Ready to merge: none",
    ]);
    assert.deepEqual(
      readyLines(SIBLINGS, [
        worker(1, CODING_AGENT_STATUS.RUNNING, pullRequest(415, PULL_REQUEST_STATE.DRAFT)),
      ]),
      ["Ready to start: 2, 3", "Ready to merge: none"],
    );
    assert.deepEqual(
      readyLines(SIBLINGS, [
        worker(
          1,
          CODING_AGENT_STATUS.COMPLETED,
          pullRequest(415, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING),
        ),
        worker(2, CODING_AGENT_STATUS.RUNNING),
      ]),
      ["Ready to start: 3", "Ready to merge: 1"],
    );
  });

  it("a chain starts one position at a time and merges from the bottom", () => {
    const green = (number: number) =>
      pullRequest(number, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING);
    // The second is green, but its base is not on main yet; the third's base is open.
    assert.deepEqual(
      readyLines(CHAIN, [
        worker(1, CODING_AGENT_STATUS.COMPLETED, pullRequest(415, PULL_REQUEST_STATE.OPEN)),
        worker(2, CODING_AGENT_STATUS.COMPLETED, green(416)),
      ]),
      ["Ready to start: 3", "Ready to merge: none"],
    );
    // Once the first merged, the second merges; a merged position is never ready to start again.
    assert.deepEqual(
      readyLines(CHAIN, [
        worker(1, CODING_AGENT_STATUS.FAILED, pullRequest(415, PULL_REQUEST_STATE.MERGED)),
        worker(2, CODING_AGENT_STATUS.COMPLETED, green(416)),
        worker(3, CODING_AGENT_STATUS.RUNNING, green(417)),
      ]),
      ["Ready to start: none", "Ready to merge: 2"],
    );
    // A worker that failed or was stopped frees its position; checks that failed are no green.
    assert.deepEqual(
      readyLines(CHAIN, [
        worker(
          1,
          CODING_AGENT_STATUS.COMPLETED,
          pullRequest(415, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING),
        ),
        worker(2, CODING_AGENT_STATUS.FAILED),
      ]),
      ["Ready to start: 2", "Ready to merge: none"],
    );
    assert.equal(
      rolloutStateOf(CHAIN, {
        builders: [
          worker(
            1,
            CODING_AGENT_STATUS.COMPLETED,
            pullRequest(415, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING),
          ),
        ],
        keeper: undefined,
      })[0],
      '1. "Schema" · base: main · worker: finished · pull request: #415 checks failing',
    );
  });

  it("names the stack keeper by the newest started: none, at work, or how it ended", () => {
    const keeperLine = (keeper: CodingAgentStatus | undefined) =>
      rolloutStateOf(SIBLINGS, { builders: [], keeper }).at(-3);
    assert.deepEqual(
      [
        undefined,
        CODING_AGENT_STATUS.STARTING,
        CODING_AGENT_STATUS.RUNNING,
        CODING_AGENT_STATUS.COMPLETED,
        CODING_AGENT_STATUS.FAILED,
        CODING_AGENT_STATUS.CANCELLED,
      ].map(keeperLine),
      [
        "Stack keeper: none",
        "Stack keeper: working",
        "Stack keeper: working",
        "Stack keeper: finished",
        "Stack keeper: failed",
        "Stack keeper: stopped",
      ],
    );
  });

  it("a builder at a position past the rollout's end draws no line and readies nothing", () => {
    assert.deepEqual(
      rolloutStateOf(SIBLINGS.slice(0, 1), {
        builders: [
          worker(2, CODING_AGENT_STATUS.RUNNING, pullRequest(416, PULL_REQUEST_STATE.OPEN)),
        ],
        keeper: undefined,
      }),
      [
        '1. "Schema" · base: main · worker: none · pull request: none',
        "Stack keeper: none",
        "Ready to start: 1",
        "Ready to merge: none",
      ],
    );
  });
});
