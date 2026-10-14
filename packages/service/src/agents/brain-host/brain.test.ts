import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  ensureMember,
  ensurePlanChannel,
  history,
  postMessage,
  roster,
} from "@luke/database/models/chat-store";
import { hostTurnId } from "@luke/database/models/ids";
import { openTaskConversation, readTask, savePlanText } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { CHAT_BLOCK, MEMBER_KIND } from "@luke/features/chat-wire";
import { type PlanDocument, planDocumentSchema } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
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
import type { GitHubApp } from "../../github/github-app.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import {
  SCRIPTED_BRAIN_REPLY,
  SCRIPTED_POST,
  SCRIPTED_POSTED_REPLY,
  SCRIPTED_READ,
  SCRIPTED_READ_REPLY,
  scriptedModel,
} from "../../testing/eve-scripted-model.js";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  NO_GITHUB,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { noNetwork } from "../../testing/no-network.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import type { RepositorySandboxDoor } from "../repository-shell.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_TURN,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
} from "./bounds.js";
import { readRecentMessages } from "./context.js";
import type { AdmittedConversation } from "./conversation.js";
import { type BrainHost, brainHost, type TurnStanding } from "./host.js";
import type { BrainHostSeams } from "./production.js";
import { memoryRelayState, type RelayStateStore } from "./relay.js";

/**
 * The brain as the hosted brain runs it, end to end in one process:
 * a task's conversation opened and attached, a session admitted for it, the
 * scripted fixture model handed the brain's instructions, the saved document
 * as its standing context, and the brain's tools, and each of its steps
 * carried as eve carries them, the tool calls through the host's `runTool`
 * and every event through the relay into the store. What a caller reads
 * afterwards (the window's `readTask`, the next turn's standing context, a
 * resumed session's seed) is what must show the model's save and the words
 * that were said. The model is scripted, so nothing here claims to prove how
 * a real model reads agreement; it proves the model is handed the document
 * and the conversation and that its update lands.
 *
 * Synthetic accounts, repositories, and words throughout.
 */

const NOW = 1_800_000_000_000;

const RELAY_TASK = {
  name: "Teammate invitations",
} as const;

const SAVED_TEXT =
  "## Open questions\n\n- Who may invite?\n\n## Assumptions\n\n- Invites reuse `memberships` with a `pending` state.\n";

/** The saved text as the window opens it and the model is handed it: the document's body. */
const SAVED: PlanDocument = { body: SAVED_TEXT, assumptions: [] };

const CORRECTION = "Any member should be able to invite, not only admins.";

/** What the developer asks Luke to post in the plan's chat, and what a teammate answers there. */
const CHAT = {
  POSTED: "The invite table's schema is frozen until Friday.",
  ANSWERED: `Noted: the expiry column waits until then. ${"The invite emails keep their old subject meanwhile. ".repeat(8)}Ship the rest.`,
} as const;

/** The repository the reading scenarios' task is about, and the installation connected to the task's workspace that reaches it. */
const RELAY = { owner: "acme", name: "relay", defaultBranch: "main" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const RELAY_INSTALLATION = { id: 11, login: RELAY.owner, repositories: [RELAY] } as const;

/** What the checkout answers `ls`, on one line so the record is read for it as written. */
const RELAY_LISTING = "README.md src";

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

/** The host over the test database, with the writer holding rows to the hosted tool set as production's does. */
const taskBrainHost = (
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

/** A task with a saved document and its conversation opened, as the Tasks tab would leave it. */
const savedTaskWithConversation = () =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    const started = yield* startTask(userId, RELAY_TASK);
    const host = yield* taskBrainHost();
    const conversationId = Option.getOrThrow(
      yield* openTaskConversation(userId, started.id),
    ).conversationId;
    return { host, userId, taskId: started.id, conversationId };
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
const brainTurn = (
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
    const prompt = host.prompt();
    const seed = yield* host.seed(standing);
    const opened = yield* host.standingContext(standing);
    const context = opened.text;
    const relay = sessionRelay(host, session, standing, eveTurnId, opened);
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

/** The relay of one turn's events as the store hook relays them, with the chat the turn opened with as eve's state keeps it. */
function sessionRelay(
  host: BrainHost,
  session: Session,
  standing: AdmittedConversation,
  eveTurnId: string,
  opened: TurnStanding,
) {
  const handed = {
    eveTurnId,
    ...(opened.chatThrough === undefined ? undefined : { through: opened.chatThrough }),
  };
  return <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    host
      .relay(
        stampedEveEvent(event, NOW),
        standing,
        { id: session.id, auth: session.auth, turn: { id: eveTurnId, sequence: 0 } },
        session.state,
        {},
        handed,
      )
      .pipe(Effect.provide(noNetwork));
}

/** A turn that opens with its standing context, takes the developer's words, and fails before the model answers, as a provider's refusal ends one. */
const failedTurn = (host: BrainHost, session: Session, eveTurnId: string, words: string) =>
  Effect.gen(function* () {
    const standing = yield* admitted(host, session);
    const opened = yield* host.standingContext(standing);
    const relay = sessionRelay(host, session, standing, eveTurnId, opened);
    const sequence = 0;
    yield* relay({ type: "turn.started", data: { turnId: eveTurnId, sequence } });
    yield* relay({
      type: "message.received",
      data: { turnId: eveTurnId, sequence, message: words },
    });
    yield* relay({
      type: "turn.failed",
      data: {
        turnId: eveTurnId,
        sequence,
        code: "MODEL_CALL_FAILED",
        message: "the provider refused",
      },
    });
    return opened.text;
  });

const readDocument = Schema.decodeUnknownSync(Schema.fromJsonString(planDocumentSchema));

/** The line the saved document follows in a standing context, as the model reads it. */
const DOCUMENT_MARKER = "[saved document]";

/** The document a standing context hands the model, on the line after its marker, failing the test where it carries none. */
function handedDocument(context: string): PlanDocument {
  const lines = context.split("\n");
  const at = lines.indexOf(DOCUMENT_MARKER);
  return at === -1
    ? assert.fail("the standing context carries no document")
    : readDocument(lines[at + 1]);
}

/** The document the Tasks tab opens, failing the test where the task does not open. */
const windowDocument = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (opened) =>
    Option.match(opened, {
      onNone: () => assert.fail("the plan did not open"),
      onSome: (found) => found.task.document,
    }),
  );

it.layer(getTestDB())("the planning model on the hosted brain", (it) => {
  it.effect(
    "a plan's conversation is opened once, attached, and read back as the one it resumes in",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* startTask(userId, RELAY_TASK);

        const first = Option.getOrThrow(
          yield* openTaskConversation(userId, started.id),
        ).conversationId;
        const again = Option.getOrThrow(
          yield* openTaskConversation(userId, started.id),
        ).conversationId;

        assert.equal(again, first);
        const stored = Option.getOrThrow(yield* readTask(userId, started.id));
        assert.equal(stored.conversationId, first);
      }),
  );

  it.effect("another account opens no conversation on a plan it does not own", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const stranger = yield* openUser;
      const started = yield* startTask(owner, RELAY_TASK);

      assert.ok(Option.isNone(yield* openTaskConversation(stranger, started.id)));
      const stored = Option.getOrThrow(yield* readTask(owner, started.id));
      assert.equal(stored.conversationId, undefined);
    }),
  );

  it.effect(
    "the model is handed the saved document every turn, and its turn leaves the document as the notetaker saved it",
    () =>
      Effect.gen(function* () {
        const { host, userId, taskId, conversationId } = yield* savedTaskWithConversation();
        const session = yield* startSession(host, userId, conversationId);
        yield* savePlanText(userId, taskId, SAVED_TEXT);

        const reply = yield* brainTurn(host, session, "turn_0", CORRECTION);

        assert.equal(reply, SCRIPTED_BRAIN_REPLY);
        assert.deepEqual(yield* windowDocument(userId, taskId), SAVED);
        assert.deepEqual(
          handedDocument((yield* host.standingContext(yield* admitted(host, session))).text),
          SAVED,
        );
      }),
  );

  it.effect(
    "asked to post, Luke posts in the plan's channel as @luke, and each turn opens with what was said there since Luke last read, until a turn handed it completes",
    () =>
      Effect.gen(function* () {
        const { host, userId, taskId: planId, conversationId } = yield* savedTaskWithConversation();
        const session = yield* startSession(host, userId, conversationId);

        const reply = yield* brainTurn(host, session, "turn_0", `${SCRIPTED_POST}${CHAT.POSTED}`);

        const channel = Option.getOrThrow(yield* ensurePlanChannel(userId, planId));
        const { organizationId } = channel;
        const person = Option.getOrThrow(
          yield* ensureMember(userId, organizationId, { kind: MEMBER_KIND.HUMAN, userId }),
        );
        const said = Option.getOrThrow(
          yield* history(userId, organizationId, person.id, { channelId: channel.id }),
        );
        const luke = (yield* roster(userId, organizationId)).find(
          (member) => member.kind === MEMBER_KIND.PLANNER && member.planId === planId,
        );
        assert.ok(luke);
        assert.equal(luke.handle, "luke");
        assert.deepEqual(
          said.map((message) => [message.authorMemberId, message.blocks]),
          [[luke.id, [{ type: CHAT_BLOCK.MARKDOWN, text: CHAT.POSTED }]]],
        );
        assert.equal(reply, `${SCRIPTED_POSTED_REPLY} ${said[0]?.seq}.`);

        const answered = yield* postMessage(userId, organizationId, {
          authorMemberId: person.id,
          to: { channelId: channel.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: CHAT.ANSWERED }],
          mentions: [],
          clientKey: randomUUID(),
        });
        assert.ok(Result.isSuccess(answered));
        const line = `[chat since the last planning call]\n- m ${answered.success.message.seq} in #teammate-invitations, @${person.handle}: ${JSON.stringify(CHAT.ANSWERED)}`;
        // A turn that fails took nothing in, so the turn after it is handed the same line.
        const failed = yield* failedTurn(host, session, "turn_1", CORRECTION);
        assert.ok(failed.includes(line), failed);
        const retried = yield* failedTurn(host, session, "turn_2", CORRECTION);
        assert.ok(retried.includes(line), retried);
        // A turn that completes took it in, so the turn after is handed nothing of it.
        yield* brainTurn(host, session, "turn_3", CORRECTION);
        const after = (yield* host.standingContext(yield* admitted(host, session))).text;
        assert.equal(after.includes("[chat since the last planning call]"), false, after);
      }),
  );

  it.effect(
    "asked to read, the planning model reads a checkout of the plan's repository in the session's sandbox, and the token reaches no row of the record",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const host = yield* taskBrainHost();
        const started = yield* startTask(userId, { ...RELAY_TASK, repository: RELAY_FULL_NAME });
        yield* connectWorkspaceGitHub(started.workspaceId, RELAY_INSTALLATION);
        const conversationId = Option.getOrThrow(
          yield* openTaskConversation(userId, started.id),
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

        const first = yield* brainTurn(host, session, "turn_0", `${SCRIPTED_READ}ls`, github.layer);
        const again = yield* brainTurn(host, session, "turn_1", `${SCRIPTED_READ}ls`, github.layer);

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
});
