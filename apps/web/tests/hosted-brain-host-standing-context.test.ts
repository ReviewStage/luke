import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { brainHost } from "../server/hosted/brain-host/host";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { GITHUB_ACCESS_WITHOUT_CONNECTIONS } from "../server/hosted/github-source";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertEvent, insertMessage, insertTurn } from "./support/store-rows";

/**
 * The standing context as the host answers it to the eve project's prompt
 * resolver on each turn, over the real migrations on PGlite: a turn of the
 * account's main recalls the briefings its observed conversations gave, and a
 * turn of an observed conversation is handed the roster and the projects
 * alone, since its own history is the conversation it runs in. Synthetic
 * accounts, sessions, and briefings throughout.
 */

const NOW = 1_800_000_000_000;
const TEST_VAULT_SECRET = Redacted.make("v".repeat(64));
const BRIEFING = "Checkout's agent is stuck on a failing test in auth.spec.";
const SESSION = { providerId: "conductor", providerSessionId: "fixture-session-checkout" } as const;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: CATALOG_TOOL_SET }));

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  eveOrigin: () => undefined,
  store: () => Effect.succeed(database.store),
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  embedder: () => undefined,
  deploymentSecret: () => undefined,
  scriptedModel: () => true,
  spend: unreached("spend"),
  vaultRows: () => Effect.succeed([]),
  vaultSecret: () => Effect.succeed(TEST_VAULT_SECRET),
  providerKey: unreached("providerKey"),
  executeAction: unreached("executeAction"),
  githubAccess: GITHUB_ACCESS_WITHOUT_CONNECTIONS,
  now: () => NOW,
};

let minted = 0;

function sessionId(): string {
  minted += 1;
  return `wrun_01M${String(minted).padStart(22, "0")}`;
}

function principal(id: string, attributes: Readonly<Record<string, string>>): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

function seat(target: ConversationTarget, turn: BrainHostTurn): SessionAuth {
  const own = principal(target.userId, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
    [BRAIN_HOST_ATTRIBUTE.TURN]: turn,
  });
  return { current: own, initiator: own };
}

type MessageParts = StoredUIMessage["parts"];

function announcePart(input: WireRecord): MessageParts[number] {
  // SAFETY: a stored tool part in the SDK's own shape; the read under the catalog registry is the validation.
  return {
    type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
    toolCallId: `call_${randomUUID()}`,
    state: "output-available",
    input,
    output: { status: "accepted" },
  } as unknown as MessageParts[number];
}

/** One briefing announced and offered from the observed conversation, as an observation turn leaves it. */
async function briefed(target: ConversationTarget, at: number): Promise<void> {
  const turnId = await insertTurn(database.run, {
    userId: target.userId,
    conversationId: target.conversationId,
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
    status: TURN_STATUS.SETTLED,
    queuedAt: new Date(at),
    settledAt: new Date(at),
  });
  const messageId = await insertMessage(database.run, {
    userId: target.userId,
    conversationId: target.conversationId,
    seq: 1,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [announcePart({ briefing: BRIEFING })],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: new Date(at),
    finishedAt: new Date(at),
  });
  // The offered event as the announce's settlement writes it, stamped with the briefing's own instant.
  await insertEvent(database.run, {
    userId: target.userId,
    conversationId: target.conversationId,
    seq: 1,
    messageId,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    payload: { expiresAt: at + 15 * 60_000 },
    createdAt: new Date(at),
  });
}

/** The standing context the host hands a turn of the conversation, through the same admission the resolver runs. */
async function standingContextOf(target: ConversationTarget, turn: BrainHostTurn): Promise<string> {
  const host = await database.run(brainHost(seams));
  const id = sessionId();
  const auth = seat(target, turn);
  const starting = await database.run(host.admitStarting(auth, id));
  assert.ok(Result.isSuccess(starting));
  if (!Result.isSuccess(starting)) throw new Error("not admitted");
  assert.equal(await database.run(host.sessionStarted(starting.success, id)), true);
  const admitted = await database.run(host.admit(auth, id));
  assert.ok(Result.isSuccess(admitted));
  if (!Result.isSuccess(admitted)) throw new Error("not admitted");
  return database.run(host.standingContext(admitted.success));
}

test("a turn of main recalls the briefing an observed conversation gave, naming its session; a turn of that observed conversation is handed no briefings", async () => {
  const userId = await database.createUser();
  const main: ConversationTarget = {
    userId,
    conversationId: await insertConversation(database.run, {
      userId,
      kind: CONVERSATION_KIND.MAIN,
      createdAt: new Date(NOW - 60 * 60_000),
    }),
  };
  const observed: ConversationTarget = {
    userId,
    conversationId: await insertConversation(database.run, {
      userId,
      kind: CONVERSATION_KIND.OBSERVED,
      providerId: SESSION.providerId,
      providerSessionId: SESSION.providerSessionId,
      title: "Fix the checkout tests",
      createdAt: new Date(NOW - 50 * 60_000),
    }),
  };
  await briefed(observed, NOW - 10 * 60_000);

  const ofMain = await standingContextOf(main, BRAIN_HOST_TURN.TYPED);
  assert.ok(ofMain.includes("Briefings you gave the developer in the last day"));
  assert.ok(
    ofMain.includes(
      `- minutes ago — Fix the checkout tests [provider_id=${SESSION.providerId} provider_session_id=${SESSION.providerSessionId}] — "${BRIEFING}"`,
    ),
  );

  const ofObserved = await standingContextOf(observed, BRAIN_HOST_TURN.OBSERVATION);
  assert.equal(ofObserved.includes("Briefings you gave"), false);
  assert.equal(ofObserved.includes(BRIEFING), false);
});
