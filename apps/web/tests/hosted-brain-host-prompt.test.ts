import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { pgSchema, text } from "drizzle-orm/pg-core";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { BRAIN_TURN_TRIGGER, WORKSPACE_FILE } from "../server/core";
import { CONVERSATION_KIND, conversations, toolSets, turns } from "../server/db/storage-schema";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState, type RelayStateStore } from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  type ConversationTarget,
  promptHashOf,
  storeWriter,
  toolSetHashOf,
} from "../server/hosted/store";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * What a turn ran under, on its row: the hash of the prompt the session
 * composed, which is all the record keeps of the prompt, and the tool set the
 * turn was offered, stored once by content and named by hash, through the
 * same host functions the eve project's authored files call, over the real
 * migrations on PGlite. The interesting case is the
 * second: a workspace file edited between two sessions yields a new hash on
 * the next session's first turn, which is what fails if the hash covers
 * something that should not vary or misses something that should. Synthetic
 * accounts and sessions throughout.
 */

const NOW = 1_800_000_000_000;
const TEST_VAULT_SECRET = "v".repeat(64);

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  db: () => database.db,
  run: database.run,
  store: () => database.store,
  writer: async () => writer,
  userInfo: async () => undefined,
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  scriptedModel: () => true,
  spend: unreached("spend"),
  vaultRows: async () => [],
  vaultSecret: () => TEST_VAULT_SECRET,
  providerKey: unreached("providerKey"),
  executeAction: unreached("executeAction"),
  now: () => NOW,
};

let minted = 0;

/** An eve session id unique to its call, sorting as eve's do: later mints sort later. */
function sessionId(): string {
  minted += 1;
  return `wrun_01M${String(minted).padStart(22, "0")}`;
}

function principal(id: string, attributes: Readonly<Record<string, string>>): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** One account's seat in one of its conversations, opening the given kind of turn. */
function seat(target: ConversationTarget, turn: BrainHostTurn): SessionAuth {
  const own = principal(target.userId, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
    [BRAIN_HOST_ATTRIBUTE.TURN]: turn,
  });
  return { current: own, initiator: own };
}

async function ownedConversation(
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

/** One session of one seat: claimed on the conversation as the store hook does at its start. */
interface Session {
  readonly id: string;
  readonly auth: SessionAuth;
  readonly state: RelayStateStore;
}

async function startSession(
  host: BrainHost,
  target: ConversationTarget,
  turn: BrainHostTurn,
): Promise<Session> {
  const id = sessionId();
  const auth = seat(target, turn);
  const starting = await host.admitStarting(auth, id);
  assert.equal(starting.ok, true);
  if (!starting.ok) throw new Error("not admitted");
  assert.equal(await host.sessionStarted(starting, id), true);
  return { id, auth, state: memoryRelayState() };
}

/** The prompt the instructions resolver composes at the session's start, as the host answers it. */
async function composePrompt(host: BrainHost, session: Session) {
  const admitted = await host.admit(session.auth, session.id);
  assert.equal(admitted.ok, true);
  if (!admitted.ok) throw new Error("not admitted");
  const kind = host.turnKindOf(session.auth);
  assert.ok(kind);
  return host.prompt(admitted, kind.trigger);
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** The fewest events of one turn that leave a settled turn row. */
function shortTurn(turnId: string, sequence: number): readonly MessageStreamEvent[] {
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "hello" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop", message: "Hi." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** One turn of one session as the store hook relays it, under the prompt record the session's state holds. */
async function relayTurn(
  host: BrainHost,
  session: Session,
  eveTurnId: string,
  sequence: number,
  prompt: { readonly hash?: string },
): Promise<string> {
  for (const event of shortTurn(eveTurnId, sequence)) {
    const admitted = await host.admit(session.auth, session.id);
    assert.equal(admitted.ok, true);
    if (!admitted.ok) throw new Error("not admitted");
    await host.relay(
      event,
      admitted,
      { id: session.id, auth: session.auth, turn: { id: eveTurnId, sequence } },
      session.state,
      prompt,
    );
  }
  return hostTurnId(session.id, eveTurnId);
}

/** The conversation's turn rows by id, since both turns of a test start on the one fixed clock. */
async function turnRows(target: ConversationTarget) {
  return database.db
    .select({ id: turns.id, promptHash: turns.promptHash, toolSetHash: turns.toolSetHash })
    .from(turns)
    .where(eq(turns.conversationId, target.conversationId))
    .orderBy(asc(turns.id));
}

const PROMPTS_TABLE = "prompts";

/** Postgres's own catalogue, read for the one table that must not stand. */
const informationSchemaTables = pgSchema("information_schema").table("tables", {
  tableSchema: text("table_schema").notNull(),
  tableName: text("table_name").notNull(),
});

async function tablesNamed(name: string): Promise<readonly string[]> {
  const rows = await database.db
    .select({ name: informationSchemaTables.tableName })
    .from(informationSchemaTables)
    .where(
      and(
        eq(informationSchemaTables.tableSchema, "public"),
        eq(informationSchemaTables.tableName, name),
      ),
    );
  return rows.map((row) => row.name);
}

async function toolSetRows(hash: string) {
  return database.db.select().from(toolSets).where(eq(toolSets.hash, hash));
}

test("two sessions composed over unchanged workspace rows carry one prompt hash, the hash of the prompt as sent, and the prompt is stored nowhere", async () => {
  const host = brainHost(seams);
  const target = await ownedConversation();
  const first = await startSession(host, target, BRAIN_HOST_TURN.TYPED);
  const firstPrompt = await composePrompt(host, first);
  const second = await startSession(host, target, BRAIN_HOST_TURN.TYPED);
  const secondPrompt = await composePrompt(host, second);

  assert.equal(secondPrompt.hash, firstPrompt.hash);
  assert.equal(secondPrompt.text, firstPrompt.text);
  assert.equal(firstPrompt.hash, promptHashOf(firstPrompt.text));
  assert.deepEqual(await tablesNamed(PROMPTS_TABLE), []);
});

test("a workspace file edited between two sessions yields a new hash", async () => {
  const host = brainHost(seams);
  const target = await ownedConversation();
  const before = await composePrompt(host, await startSession(host, target, BRAIN_HOST_TURN.TYPED));

  await database.store.workspace.write(
    target.userId,
    WORKSPACE_FILE.USER,
    "# User\n\n- Remembered: prefers short replies\n",
    NOW + 1,
  );
  const after = await composePrompt(host, await startSession(host, target, BRAIN_HOST_TURN.TYPED));

  assert.notEqual(after.hash, before.hash);
  assert.notEqual(after.text, before.text);
});

test("two accounts over the same seeded rows compose one prompt hash", async () => {
  const host = brainHost(seams);
  const one = await composePrompt(
    host,
    await startSession(host, await ownedConversation(), BRAIN_HOST_TURN.TYPED),
  );
  const other = await composePrompt(
    host,
    await startSession(host, await ownedConversation(), BRAIN_HOST_TURN.TYPED),
  );

  assert.equal(other.hash, one.hash);
});

test("two turns of one session record the session's prompt hash and one tool set, hashed from the declarations the tools resolver offers", async () => {
  const host = brainHost(seams);
  const target = await ownedConversation();
  const session = await startSession(host, target, BRAIN_HOST_TURN.TYPED);
  const prompt = await composePrompt(host, session);

  const firstTurn = await relayTurn(host, session, "turn_0", 0, { hash: prompt.hash });
  const secondTurn = await relayTurn(host, session, "turn_1", 1, { hash: prompt.hash });

  const rows = await turnRows(target);
  assert.deepEqual(
    rows.map((row) => row.id),
    [firstTurn, secondTurn].sort(),
  );
  assert.deepEqual(
    rows.map((row) => row.promptHash),
    [prompt.hash, prompt.hash],
  );
  const offered = host.toolDeclarations({
    kind: BRAIN_HOST_TURN.TYPED,
    trigger: BRAIN_TURN_TRIGGER.ASK,
    turnId: firstTurn,
  });
  const expected = toolSetHashOf(offered);
  assert.deepEqual(
    rows.map((row) => row.toolSetHash),
    [expected, expected],
  );
  const stored = await toolSetRows(expected);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]?.schemas, offered);
});

test("an observation turn is offered another tool set and records another hash, and a session that composed no prompt records none", async () => {
  const host = brainHost(seams);
  const typed = await startSession(host, await ownedConversation(), BRAIN_HOST_TURN.TYPED);
  const observed = await startSession(
    host,
    await ownedConversation(CONVERSATION_KIND.OBSERVED),
    BRAIN_HOST_TURN.OBSERVATION,
  );
  const typedPrompt = await composePrompt(host, typed);

  const typedTurn = await relayTurn(host, typed, "turn_0", 0, { hash: typedPrompt.hash });
  const observationTurn = await relayTurn(host, observed, "turn_0", 0, {});

  const [typedRow] = await database.db.select().from(turns).where(eq(turns.id, typedTurn));
  const [observationRow] = await database.db
    .select()
    .from(turns)
    .where(eq(turns.id, observationTurn));
  assert.ok(typedRow);
  assert.ok(observationRow?.toolSetHash);
  assert.notEqual(observationRow.toolSetHash, typedRow.toolSetHash);
  assert.equal(
    observationRow.toolSetHash,
    toolSetHashOf(
      host.toolDeclarations({
        kind: BRAIN_HOST_TURN.OBSERVATION,
        trigger: BRAIN_TURN_TRIGGER.ROSTER,
        turnId: observationTurn,
      }),
    ),
  );
  assert.equal(observationRow.promptHash, null);
  assert.equal(typedRow.promptHash, typedPrompt.hash);
  assert.equal((await toolSetRows(observationRow.toolSetHash)).length, 1);
});
