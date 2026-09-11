import assert from "node:assert/strict";
import { isTextUIPart, isToolUIPart } from "ai";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { ManagedRuntime } from "effect";
import { defineEval } from "eve/evals";
import { Pool } from "pg";
import {
  ACTION_TOOL,
  BRAIN_TURN_TRIGGER,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  RECORD_EXTRA_KEYS,
  s,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "../../server/core";
import * as schema from "../../server/db/schema";
import { sqlClientOverPool } from "../../server/db/sql-client";
import {
  CONVERSATION_KIND,
  conversations,
  messages,
  toolSets,
  turns,
} from "../../server/db/storage-schema";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../../server/hosted/brain-host/bounds";
import { hostTurnId } from "../../server/hosted/brain-host/ids";
import { hostedToolDeclarations } from "../../server/hosted/brain-host/tools";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption";
import { hostedStore, toolSetHashOf } from "../../server/hosted/store";
import { SCRIPTED_FACT } from "../scripted-model";

/**
 * The whole host under eve, end to end: eve's runtime runs a typed ask under
 * the scripted fixture model, the tool adapters admit and carry one
 * remembered fact, and the relay writes the turn into the store through the
 * writer. The eve server runs in this process with the database the
 * environment names, so the eval reads the rows back from the same Postgres.
 * Where no database is named the eval skips rather than pretending: the
 * relay and the writer meet PGlite in the store tests, and this is where
 * they meet eve.
 */

const SHA256_HEX_LENGTH = 64;

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/** What eve answers a session's opening with, read for the one field the eval continues from. */
const ACCEPTED_SESSION = s.record({ sessionId: s.text() }, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });

type FixtureDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** The account's one standing main conversation, opened on the first run and reused on every later one. */
async function standingMainConversation(db: FixtureDatabase): Promise<{ id: string }> {
  const [standing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, LOCAL_DEV_PRINCIPAL),
        eq(conversations.kind, CONVERSATION_KIND.MAIN),
        isNull(conversations.deletedAt),
      ),
    );
  if (standing) return standing;
  const [opened] = await db
    .insert(conversations)
    .values({ userId: LOCAL_DEV_PRINCIPAL, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(opened);
  return opened;
}

/** The database and vault secret the fixture runs against, or nothing where the environment names neither. */
function fixtureEnvironment(): { connectionString: string; secret: string } | undefined {
  const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
  const secret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];
  return connectionString && secret ? { connectionString, secret } : undefined;
}

export default defineEval({
  description: "A typed ask runs through eve, the tools, the relay, and the writer into the store.",
  async test(t) {
    const named = fixtureEnvironment();
    if (named === undefined) {
      return t.skip("no database and vault secret are named; the fixture writes nowhere");
    }
    const { connectionString, secret } = named;
    const pool = new Pool({ connectionString, max: 1 });
    const db = drizzle(pool, { schema });
    const runtime = ManagedRuntime.make(sqlClientOverPool(pool));
    try {
      await db
        .insert(schema.user)
        .values({ id: LOCAL_DEV_PRINCIPAL, name: "Local developer", email: "local-dev@luke.test" })
        .onConflictDoNothing();
      const conversation = await standingMainConversation(db);

      const opened = await t.target.fetch("/eve/v1/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BRAIN_HOST_HEADER.CONVERSATION]: conversation.id,
          [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
        },
        body: JSON.stringify({ message: "remember that I prefer short replies" }),
      });
      assert.equal(opened.status, 202);
      const accepted = ACCEPTED_SESSION.parse(unparsedWire(await opened.json()));
      assert.ok(accepted);
      // The door admits a session once its first event has recorded it on the conversation row.
      for (let waited = 0; waited < 40; waited += 1) {
        const [recorded] = await db
          .select({ runtimeSessionId: conversations.runtimeSessionId })
          .from(conversations)
          .where(eq(conversations.id, conversation.id));
        if (recorded?.runtimeSessionId === accepted.sessionId) break;
        await t.sleep(250);
      }
      const session = await t.target.attachSession(accepted.sessionId);
      session.succeeded();
      session.calledTool(ACTION_TOOL.REMEMBER_FACT);

      const turnId = hostTurnId(accepted.sessionId, "turn_0");
      const turnRows = await db
        .select()
        .from(turns)
        .where(and(eq(turns.conversationId, conversation.id), eq(turns.id, turnId)));
      assert.equal(turnRows.length, 1);
      const [turn] = turnRows;
      assert.ok(turn);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint, which names no
      // row because nothing of the prompt is kept, and the tool set's hash,
      // which names the row holding the schemas the model saw.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      assert.ok(turn.toolSetHash);
      assert.equal(turn.toolSetHash, toolSetHashOf(hostedToolDeclarations(BRAIN_TURN_TRIGGER.ASK)));
      const [toolSet] = await db.select().from(toolSets).where(eq(toolSets.hash, turn.toolSetHash));
      assert.ok(toolSet);

      const messageRows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), eq(messages.turnId, turnId)))
        .orderBy(asc(messages.seq));
      assert.deepEqual(
        messageRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(messageRows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      const answer = messageRows[1];
      assert.ok(answer);
      const toolPart = answer.parts.find((part) => isToolUIPart(part));
      assert.ok(toolPart);
      assert.equal(toolPart.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.equal(answer.parts.filter((part) => isTextUIPart(part)).length, 1);

      const store = hostedStore({
        db,
        keys: payloadKeyRing(secret),
        run: (effect) => runtime.runPromise(effect),
      });
      const facts = await store.facts.list(LOCAL_DEV_PRINCIPAL);
      assert.equal(facts.filter((fact) => fact.words === SCRIPTED_FACT).length, 1);
      const [row] = await db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversation.id));
      assert.equal(row?.runtimeSessionId, accepted.sessionId);
    } finally {
      await runtime.dispose();
      await pool.end();
    }
  },
});
