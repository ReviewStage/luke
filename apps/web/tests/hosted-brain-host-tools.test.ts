import assert from "node:assert/strict";
import { Effect, Option, Result } from "effect";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_TURN_TRIGGER,
  isWireString,
  TURN_ORIGIN,
  type WireRecord,
} from "../server/core";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { childConversationId, hostTurnId } from "../server/hosted/brain-host/ids";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { createPlan, openPlanConversation } from "../server/hosted/plan-store";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { listJournals } from "../server/hosted/store/message-reads";
import { stampedEveEvent } from "./support/eve-events";
import { NO_GITHUB } from "./support/github-app-fake";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * The planning tools as eve runs them through the host's `runTool`, over the
 * real migrations on PGlite: a call is carried under the plan the admitted
 * conversation belongs to, and answers why it ran nothing, as a result the
 * model reads, for a name the turn was not offered, a conversation no plan
 * names, or an input that does not read. Synthetic accounts and plans
 * throughout.
 */

const NOW = 1_800_000_000_000;

const QUESTION = {
  question: "Should a withdrawn invite tell the invitee who withdrew it?",
  recommendation: "No: just say the invite is no longer valid.",
} as const;

/** A tool the brain was once offered and a planning turn is not. */
const UNOFFERED_TOOL = "write_workspace_file";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  eveOrigin: () => undefined,
  scriptedModel: () => true,
  spend: unreached("spend"),
  now: () => NOW,
};

let minted = 0;

function sessionId(): string {
  minted += 1;
  return `wrun_01T${String(minted).padStart(22, "0")}`;
}

function seat(target: ConversationTarget): SessionAuth {
  const own: SessionAuthContext = {
    principalId: target.userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  };
  return { current: own, initiator: own };
}

function toolContext(id: string, auth: SessionAuth, name: string): EveToolContext {
  return {
    session: { id, auth, turn: { id: "turn_0", sequence: 0 } },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: name,
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    getSandbox: unreached("getSandbox"),
  };
}

/** A tool caller over one session claimed on the conversation, as the store hook claims it at the session's start. */
async function callerOn(
  host: BrainHost,
  target: ConversationTarget,
): Promise<(name: string, input: WireRecord) => Promise<WireRecord>> {
  const id = sessionId();
  const auth = seat(target);
  const starting = await database.run(host.admitStarting(auth, id));
  if (Result.isFailure(starting)) return assert.fail(starting.failure);
  assert.equal(await database.run(host.sessionStarted(starting.success, id)), true);
  const binding = {
    target,
    turn: {
      kind: BRAIN_HOST_TURN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      turnId: hostTurnId(id, "turn_0"),
    },
  };
  return (name, input) =>
    database.run(
      host
        .runTool(name, binding, input, toolContext(id, auth, name))
        .pipe(Effect.provide(NO_GITHUB)),
    );
}

/** A plan's own conversation, opened as the Plans tab opens it. */
async function planConversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const plan = await database.run(createPlan(userId, { name: "Teammate invitations" }));
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(userId, plan.id)),
  );
  return { userId, conversationId };
}

test("a queued question on a plan's conversation is accepted, and one that does not read is refused", async () => {
  const call = await callerOn(brainHost(seams), await planConversation());

  assert.deepEqual(await call(QUEUE_QUESTION_TOOL.name, QUESTION), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
  });
  const unreadable = await call(QUEUE_QUESTION_TOOL.name, { question: "" });
  assert.equal(unreadable.status, ACTION_RESULT_STATUS.REJECTED);
});

test("a name no planning turn is offered runs nothing and answers why", async () => {
  const call = await callerOn(brainHost(seams), await planConversation());

  const answer = await call(UNOFFERED_TOOL, { name: "USER.md", content: "x" });

  assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(isWireString(answer.reason));
});

test("a conversation no plan names runs none of the planning tools, the question queue included", async () => {
  const userId = await database.createUser();
  const target = { userId, conversationId: await insertConversation(database.run, { userId }) };
  const call = await callerOn(brainHost(seams), target);

  const answer = await call(QUEUE_QUESTION_TOOL.name, QUESTION);

  assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(isWireString(answer.reason));
});

test("a worker's session is recorded in its child conversation as a child turn, and the planning session keeps the conversation's record", async () => {
  const target = await planConversation();
  const host = brainHost(seams);
  const rootId = sessionId();
  const auth = seat(target);
  const starting = await database.run(host.admitStarting(auth, rootId));
  if (Result.isFailure(starting)) return assert.fail(starting.failure);
  assert.equal(await database.run(host.sessionStarted(starting.success, rootId)), true);

  const turn = { id: "turn_0", sequence: 0 };
  const child = {
    id: `${rootId}-child`,
    auth,
    turn,
    parent: { callId: "call-worker-1", rootSessionId: rootId, sessionId: rootId, turn },
  };
  const state = memoryRelayState();
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, NOW);
  for (const event of [
    stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } }),
    stamped({
      type: "message.received",
      data: { turnId: "turn_0", sequence: 0, message: "Compare the queues." },
    }),
    stamped({
      type: "step.started",
      data: { turnId: "turn_0", sequence: 0, stepIndex: 0, modelId: "m" },
    }),
    stamped({
      type: "message.completed",
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 0,
        finishReason: "stop",
        message: "Queue A wins.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId: "turn_0", sequence: 0, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } }),
  ]) {
    await database.run(host.relayChild(event, child, state).pipe(Effect.provide(NO_GITHUB)));
  }

  const journals = await database.run(
    listJournals(
      target.userId,
      childConversationId(target.conversationId, "call-worker-1"),
      HOSTED_TOOL_SET,
      10,
    ),
  );
  assert.ok(journals.ok);
  assert.deepEqual(
    journals.value.flatMap((row) =>
      row.message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ),
    ["Queue A wins."],
  );
  const [childTurn] = await database.run(
    database.store.turns.named(target.userId, [hostTurnId(child.id, "turn_0")]),
  );
  assert.equal(childTurn?.origin, TURN_ORIGIN.CHILD);
  // The planning session still stands for its conversation, so its own calls still run.
  assert.ok(Result.isSuccess(await database.run(host.admit(auth, rootId))));
});
