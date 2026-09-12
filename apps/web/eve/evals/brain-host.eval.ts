import assert from "node:assert/strict";
import * as SqlClient from "@effect/sql/SqlClient";
import { isTextUIPart, isToolUIPart } from "ai";
import { Effect, ManagedRuntime, Schema } from "effect";
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
import { sqlClientOverPool } from "../../server/db/sql-client";
import { CONVERSATION_KIND } from "../../server/db/storage-vocabulary";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../../server/hosted/brain-host/bounds";
import { hostTurnId } from "../../server/hosted/brain-host/ids";
import { hostedToolDeclarations } from "../../server/hosted/brain-host/tools";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption";
import { hostedStore, toolSetHashOf } from "../../server/hosted/store";
import {
  readMessagesByConversationTyped,
  readToolSetsByHash,
  readTurnById,
} from "../../tests/support/store-rows";
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

type Run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>;

async function ensureLocalDevUser(run: Run): Promise<void> {
  await run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        insert into "user" (id, name, email)
        values (${LOCAL_DEV_PRINCIPAL}, ${"Local developer"}, ${"local-dev@luke.test"})
        on conflict (id) do nothing
      `;
    }),
  );
}

/** The account's one standing main conversation, opened on the first run and reused on every later one. */
async function standingMainConversation(run: Run): Promise<{ id: string }> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const IdRowSchema = Schema.Struct({ id: Schema.String });
      const standing = yield* sql`
        select id from conversations
        where user_id = ${LOCAL_DEV_PRINCIPAL} and kind = ${CONVERSATION_KIND.MAIN}
          and deleted_at is null
      `;
      if (standing[0]) return Schema.decodeUnknownSync(IdRowSchema)(standing[0]);
      const opened = yield* sql`
        insert into conversations (user_id, kind)
        values (${LOCAL_DEV_PRINCIPAL}, ${CONVERSATION_KIND.MAIN})
        returning id
      `;
      const [row] = opened;
      assert.ok(row);
      return Schema.decodeUnknownSync(IdRowSchema)(row);
    }),
  );
}

function readConversationRuntimeSessionId(
  run: Run,
  conversationId: string,
): Promise<string | null> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        select runtime_session_id from conversations where id = ${conversationId}
      `;
      const RowSchema = Schema.Struct({
        runtime_session_id: Schema.NullOr(Schema.String),
      });
      const [row] = rows;
      return row === undefined ? null : Schema.decodeUnknownSync(RowSchema)(row).runtime_session_id;
    }),
  );
}

function readMessagesByTurn(run: Run, conversationId: string, turnId: string) {
  return readMessagesByConversationTyped(run, conversationId).then((rows) =>
    rows.filter((row) => row.turnId === turnId),
  );
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
    const runtime = ManagedRuntime.make(sqlClientOverPool(pool));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);
      const conversation = await standingMainConversation(run);

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
        const runtimeSessionId = await readConversationRuntimeSessionId(run, conversation.id);
        if (runtimeSessionId === accepted.sessionId) break;
        await t.sleep(250);
      }
      const session = await t.target.attachSession(accepted.sessionId);
      session.succeeded();
      session.calledTool(ACTION_TOOL.REMEMBER_FACT);

      const turnId = hostTurnId(accepted.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, conversation.id);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint, which names no
      // row because nothing of the prompt is kept, and the tool set's hash,
      // which names the row holding the schemas the model saw.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      assert.ok(turn.toolSetHash);
      assert.equal(turn.toolSetHash, toolSetHashOf(hostedToolDeclarations(BRAIN_TURN_TRIGGER.ASK)));
      const toolSetRows = await readToolSetsByHash(run, turn.toolSetHash);
      assert.equal(toolSetRows.length, 1);

      const messageRows = await readMessagesByTurn(run, conversation.id, turnId);
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

      const store = hostedStore({ keys: payloadKeyRing(secret), run });
      const facts = await store.facts.list(LOCAL_DEV_PRINCIPAL);
      assert.equal(facts.filter((fact) => fact.words === SCRIPTED_FACT).length, 1);
      const runtimeSessionId = await readConversationRuntimeSessionId(run, conversation.id);
      assert.equal(runtimeSessionId, accepted.sessionId);
    } finally {
      await runtime.dispose();
      await pool.end();
    }
  },
});
