import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { type PlanDocument, planDocumentSchema } from "@sidecar/hosted/plan-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import {
  generateText,
  type JSONValue,
  jsonSchema,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
  tool,
} from "ai";
import { Effect, Option, Redacted, Result, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { scriptedModel } from "../eve/scripted-model";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
  BRAIN_HOST_TURN_KIND,
} from "../server/hosted/brain-host/bounds";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import { documentTextOf } from "../server/hosted/brain-host/planning";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState, type RelayStateStore } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { payloadKeyRing } from "../server/hosted/encryption";
import {
  GITHUB_ACCESS_WITHOUT_CONNECTIONS,
  type GitHubAccessShape,
} from "../server/hosted/github-source";
import {
  createPlan,
  deletePlan,
  openPlan,
  openPlanConversation,
  readPlan,
  savePlanDocument,
} from "../server/hosted/plan-store";
import {
  GET_FILE_CONTENTS_TOOL,
  REPOSITORY_READ_REFUSAL,
  REPOSITORY_READ_STATUS,
} from "../server/hosted/repository-tools";
import { hostedStore, storeWriter } from "../server/hosted/store";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool";
import { stampedEveEvent } from "./support/eve-events";
import { fakeGitHub } from "./support/github-fake";
import { noNetwork } from "./support/no-network";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model as the hosted brain runs it, end to end in one process:
 * a plan's conversation opened and attached, a session admitted for it, the
 * scripted fixture model handed the planning instructions, the saved document
 * as its standing context, and the planning tools, and each of its steps
 * carried as eve carries them, the tool calls through the host's `runTool`
 * and every event through the relay into the store. What a caller reads
 * afterwards (the window's `openPlan`, the next turn's standing context, a
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
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
} as const;

const SAVED: PlanDocument = {
  body: "# Teammate invitations\n\n## Open questions\n- Who may invite?\n",
  assumptions: [{ text: "Invites reuse `memberships` with a `pending` state.", confirmed: true }],
};

const CORRECTION = "Any member should be able to invite, not only admins.";

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

/** The host over the test database, with the writer holding rows to the hosted tool set as production's does. */
const planningHost = (githubAccess: GitHubAccessShape = GITHUB_ACCESS_WITHOUT_CONNECTIONS) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
    const seams: BrainHostSeams = {
      eveOrigin: () => undefined,
      store: () =>
        Effect.succeed(hostedStore({ keys: payloadKeyRing(Redacted.make("c".repeat(64))) })),
      writer: () => Effect.succeed(writer),
      userInfo: () => Effect.succeed(undefined),
      ownership: {
        sessionOwner: unreached("sessionOwner"),
        ownsConversation: unreached("ownsConversation"),
      },
      openAi: () => undefined,
      embedder: () => undefined,
      deploymentSecret: () => undefined,
      scriptedModel: () => true,
      spend: unreached("spend"),
      vaultRows: () => Effect.succeed([]),
      vaultSecret: unreached("vaultSecret"),
      providerKey: unreached("providerKey"),
      executeAction: unreached("executeAction"),
      githubAccess,
      now: () => NOW,
    };
    return yield* brainHost(seams);
  });

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan with a saved document and its conversation opened, as the planning window would leave it. */
const savedPlanWithConversation = (githubAccess?: GitHubAccessShape) =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    const started = yield* createPlan(userId, RELAY_PLAN);
    const host = yield* planningHost(githubAccess);
    const conversationId = Option.getOrThrow(yield* openPlanConversation(userId, started.id));
    return { host, userId, planId: started.id, conversationId };
  });

let minted = 0;

/** An eve session id unique to its call, sorting as eve's do: later mints sort later. */
function sessionId(): string {
  minted += 1;
  return `wrun_01P${String(minted).padStart(22, "0")}`;
}

function seat(userId: string, conversationId: string): SessionAuth {
  const own: SessionAuthContext = {
    principalId: userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  };
  return { current: own, initiator: own };
}

interface Session {
  readonly id: string;
  readonly auth: SessionAuth;
  readonly state: RelayStateStore;
}

/** A session claiming the conversation as the store hook does at its start. */
const startSession = (host: BrainHost, userId: string, conversationId: string) =>
  Effect.gen(function* () {
    const id = sessionId();
    const auth = seat(userId, conversationId);
    const starting = yield* host.admitStarting(auth, id);
    if (Result.isFailure(starting)) return assert.fail(starting.failure);
    assert.equal(yield* host.sessionStarted(starting.success, id), true);
    return { id, auth, state: memoryRelayState() } satisfies Session;
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
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    getSandbox: unreached("getSandbox"),
    getSkill: unreached("getSkill"),
  };
}

/**
 * One turn as eve runs it: the session's prompt, the seed where a resumed
 * session has one, and the turn's standing context handed to the scripted
 * model with the turn's tools; each tool call carried through the host; and
 * every event relayed into the store. Answers what the model said.
 */
const planningTurn = (host: BrainHost, session: Session, eveTurnId: string, words: string) =>
  Effect.gen(function* () {
    const standing = yield* admitted(host, session);
    const turnKind = BRAIN_HOST_TURN_KIND[BRAIN_HOST_TURN.TYPED];
    const turn = {
      kind: BRAIN_HOST_TURN.TYPED,
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

    const prompt = yield* host.prompt(standing);
    const seed = yield* host.seed(standing);
    const context = yield* host.standingContext(standing);
    const declarations = yield* host.toolDeclarations(standing, turn);
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
          .pipe(Effect.provide(noNetwork));
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

/** The document a standing context hands the model, failing the test where it carries none. */
function handedDocument(context: string): PlanDocument {
  const text = documentTextOf(context);
  return text === undefined
    ? assert.fail("the standing context carries no document")
    : readDocument(text);
}

/** The document the planning window opens, failing the test where the plan does not open. */
const windowDocument = (userId: string, planId: string) =>
  Effect.map(openPlan(userId, planId), (opened) =>
    Option.match(opened, {
      onNone: () => assert.fail("the plan did not open"),
      onSome: (found) => found.document,
    }),
  );

it.layer(testSqlClient)("the planning model on the hosted brain", (it) => {
  it.effect(
    "a plan's conversation is opened once, attached, and read back as the one it resumes in",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* createPlan(userId, RELAY_PLAN);

        const first = Option.getOrThrow(yield* openPlanConversation(userId, started.id));
        const again = Option.getOrThrow(yield* openPlanConversation(userId, started.id));

        assert.equal(again, first);
        const stored = Option.getOrThrow(yield* readPlan(userId, started.id));
        assert.equal(stored.conversationId, first);
      }),
  );

  it.effect("another account opens no conversation on a plan it does not own", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const stranger = yield* openUser;
      const started = yield* createPlan(owner, RELAY_PLAN);

      assert.ok(Option.isNone(yield* openPlanConversation(stranger, started.id)));
      const stored = Option.getOrThrow(yield* readPlan(owner, started.id));
      assert.equal(stored.conversationId, undefined);
    }),
  );

  it.effect(
    "a planning turn is offered update_plan and get_file_contents and none of the brain's catalog",
    () =>
      Effect.gen(function* () {
        const { host, userId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        const standing = yield* admitted(host, session);
        assert.equal(standing.kind, CONVERSATION_KIND.PLAN);

        const offered = yield* host.toolDeclarations(standing, {
          kind: BRAIN_HOST_TURN.TYPED,
          trigger: BRAIN_HOST_TURN_KIND[BRAIN_HOST_TURN.TYPED].trigger,
          turnId: hostTurnId(session.id, "turn_0"),
        });

        assert.deepEqual(
          offered.map((declared) => declared.name),
          [UPDATE_PLAN_TOOL.name, GET_FILE_CONTENTS_TOOL.name],
        );
      }),
  );

  it.effect(
    "the model reads the document it is handed and its update_plan changes what the window and the next turn read",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        yield* savePlanDocument(userId, planId, SAVED);

        yield* planningTurn(host, session, "turn_0", CORRECTION);

        const expected: PlanDocument = {
          body: SAVED.body,
          assumptions: [...SAVED.assumptions, { text: CORRECTION, confirmed: false }],
        };
        assert.deepEqual(yield* windowDocument(userId, planId), expected);
        assert.deepEqual(
          handedDocument(yield* host.standingContext(yield* admitted(host, session))),
          expected,
        );
      }),
  );

  it.effect(
    "resuming the plan in a new session hands the model its saved document and the conversation so far",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const first = yield* startSession(host, userId, conversationId);
        const reply = yield* planningTurn(host, first, "turn_0", CORRECTION);

        const resumed = yield* startSession(host, userId, conversationId);
        const standing = yield* admitted(host, resumed);
        const seed = yield* host.seed(standing);
        const context = yield* host.standingContext(standing);

        assert.ok(seed);
        assert.ok(seed.includes(CORRECTION));
        assert.ok(seed.includes(reply));
        assert.ok(seed.includes(UPDATE_PLAN_TOOL.name));
        assert.deepEqual(handedDocument(context), yield* windowDocument(userId, planId));
        assert.ok(context.includes(RELAY_PLAN.repository.commit));
      }),
  );

  it.effect(
    "a deleted plan's conversation is cleared with it and admits its session no further",
    () =>
      Effect.gen(function* () {
        const { host, userId, planId, conversationId } = yield* savedPlanWithConversation();
        const session = yield* startSession(host, userId, conversationId);

        assert.equal(yield* deletePlan(userId, planId), true);

        const admission = yield* host.admit(session.auth, session.id);
        assert.ok(Result.isFailure(admission));
        assert.equal(admission.failure, BRAIN_HOST_REFUSAL.NO_CONVERSATION);
      }),
  );

  it.effect(
    "the model's get_file_contents reads the plan's repository at its commit through the host",
    () => {
      const github = fakeGitHub();
      return Effect.gen(function* () {
        const { host, userId, conversationId } = yield* savedPlanWithConversation(github.access);
        github.connect(userId, "fixture-token-planning", [
          {
            owner: RELAY_PLAN.repository.owner,
            name: RELAY_PLAN.repository.name,
            private: true,
            defaultBranch: RELAY_PLAN.repository.branch,
            branches: new Map([[RELAY_PLAN.repository.branch, RELAY_PLAN.repository.commit]]),
            commits: new Map([
              [RELAY_PLAN.repository.commit, new Map([["README.md", { text: "# Relay\n" }]])],
            ]),
          },
        ]);
        const session = yield* startSession(host, userId, conversationId);
        const standing = yield* admitted(host, session);
        const turn = {
          kind: BRAIN_HOST_TURN.TYPED,
          trigger: BRAIN_HOST_TURN_KIND[BRAIN_HOST_TURN.TYPED].trigger,
          turnId: hostTurnId(session.id, "turn_0"),
        };
        const call = (input: WireBoundaryInput) =>
          host.runTool(
            GET_FILE_CONTENTS_TOOL.name,
            { target: standing.target, turn },
            unparsedWire(input),
            toolContext(session, GET_FILE_CONTENTS_TOOL.name),
          );

        const readme = yield* call({ path: "README.md" }).pipe(Effect.provide(github.layer));
        const steered = yield* call({ path: "README.md", sha: "0".repeat(40) }).pipe(
          Effect.provide(github.layer),
        );

        assert.deepEqual(readme, {
          status: REPOSITORY_READ_STATUS.FILE,
          repository: { owner: RELAY_PLAN.repository.owner, name: RELAY_PLAN.repository.name },
          commit: RELAY_PLAN.repository.commit,
          path: "README.md",
          content: "# Relay\n",
          characters: 8,
          truncated: false,
        });
        assert.equal(steered.reason, REPOSITORY_READ_REFUSAL.UNREADABLE);
      });
    },
  );

  it.effect("with no GitHub connection, the model's get_file_contents says nothing was read", () =>
    Effect.gen(function* () {
      const { host, userId, conversationId } = yield* savedPlanWithConversation();
      const session = yield* startSession(host, userId, conversationId);
      const standing = yield* admitted(host, session);

      const result = yield* host
        .runTool(
          GET_FILE_CONTENTS_TOOL.name,
          {
            target: standing.target,
            turn: {
              kind: BRAIN_HOST_TURN.TYPED,
              trigger: BRAIN_HOST_TURN_KIND[BRAIN_HOST_TURN.TYPED].trigger,
              turnId: hostTurnId(session.id, "turn_0"),
            },
          },
          unparsedWire({ path: "" }),
          toolContext(session, GET_FILE_CONTENTS_TOOL.name),
        )
        .pipe(Effect.provide(noNetwork));

      assert.equal(result.status, REPOSITORY_READ_STATUS.NOT_READ);
      assert.equal(result.reason, REPOSITORY_READ_REFUSAL.NOT_CONNECTED);
    }),
  );
});
