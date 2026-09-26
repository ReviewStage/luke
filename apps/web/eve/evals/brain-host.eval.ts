import assert from "node:assert/strict";
import { EXCESS_KEYS } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { isTextUIPart, isToolUIPart } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, ManagedRuntime, Option, Redacted, Result, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { defineEval } from "eve/evals";
import {
  BRAIN_TOOL,
  BRAIN_TURN_TRIGGER,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  WORKSPACE_FILE,
} from "../../server/core";
import { user } from "../../server/db/auth-schema";
import { db } from "../../server/db/query";
import { sqlClientOverUrl } from "../../server/db/sql-client";
import { conversations } from "../../server/db/storage-schema";
import { CONVERSATION_KIND } from "../../server/db/storage-vocabulary";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../../server/hosted/brain-host/bounds";
import { hostTurnId } from "../../server/hosted/brain-host/ids";
import { hostedToolDeclarations } from "../../server/hosted/brain-host/tools";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption";
import {
  createPlan,
  openPlanConversation,
  readPlan,
  savePlanDocument,
} from "../../server/hosted/plan-store";
import { hostedStore } from "../../server/hosted/store";
import { toolSetHashOf } from "../../server/hosted/store/content-addressed";
import { UPDATE_PLAN_TOOL } from "../../server/hosted/update-plan-tool";
import { readMessagesByConversationTyped, readTurnById } from "../../tests/support/store-rows";
import { SCRIPTED_FACT, SCRIPTED_PLANNING_REPLY } from "../scripted-model";

/**
 * The whole host under eve, end to end: eve's runtime runs a typed ask under
 * the scripted fixture model, the tool adapters carry one USER.md write
 * recording a fact about the developer, and the relay writes the turn into
 * the store through the writer. A plan's conversation then runs the same way
 * under the planning model: the scripted model reads the saved document its
 * standing context hands it and saves an update through `update_plan`, and a
 * second session over the same conversation, a resume, is handed the document
 * as that first session left it. The eve server runs in this process with the database the
 * environment names, so the eval reads the rows back from the same Postgres.
 * Where no database is named the eval skips rather than pretending: the
 * relay and the writer meet PGlite in the store tests, and this is where
 * they meet eve.
 */

const SHA256_HEX_LENGTH = 64;

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/** The plan the planning scenario runs against, and the words its two sessions open with. */
const PLAN = {
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
} as const;
const PLAN_SAVED = {
  body: "# Teammate invitations\n\n## Open questions\n- Who may invite?\n",
  assumptions: [{ text: "Invites reuse `memberships` with a `pending` state.", confirmed: true }],
} as const;
const PLAN_WORDS = {
  FIRST: "Any member should be able to invite, not only admins.",
  RESUMED: "A withdrawn invite shows a generic invalid-invite page.",
} as const;

/** What eve answers a session's opening with, read for the one field the eval continues from. */
const ACCEPTED_SESSION = Schema.Struct({ sessionId: Schema.String });

type Run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>;

async function ensureLocalDevUser(run: Run): Promise<void> {
  await run(
    Effect.asVoid(
      db
        .insert(user)
        .values({
          id: LOCAL_DEV_PRINCIPAL,
          name: "Local developer",
          email: "local-dev@luke.test",
        })
        .onConflictDoNothing({ target: user.id }),
    ),
  );
}

/** The account's one standing main conversation, opened on the first run and reused on every later one. */
async function standingMainConversation(run: Run): Promise<{ id: string }> {
  return run(
    Effect.gen(function* () {
      const IdRowSchema = Schema.Struct({ id: Schema.String });
      const standing = yield* db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, LOCAL_DEV_PRINCIPAL),
            eq(conversations.kind, CONVERSATION_KIND.MAIN),
            isNull(conversations.deletedAt),
          ),
        );
      if (standing[0]) return Schema.decodeUnknownSync(IdRowSchema)(standing[0]);
      const opened = yield* db
        .insert(conversations)
        .values({ userId: LOCAL_DEV_PRINCIPAL, kind: CONVERSATION_KIND.MAIN })
        .returning({ id: conversations.id });
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
      const rows = yield* db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      const RowSchema = Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) });
      const [row] = rows;
      return row === undefined ? null : Schema.decodeUnknownSync(RowSchema)(row).runtimeSessionId;
    }),
  );
}

function readMessagesByTurn(run: Run, conversationId: string, turnId: string) {
  return readMessagesByConversationTyped(run, conversationId).then((rows) =>
    rows.filter((row) => row.turnId === turnId),
  );
}

/** The id of the plan's conversation, opened on its first call; the plan must stand. */
async function planConversation(run: Run, planId: string): Promise<string> {
  const opened = await run(openPlanConversation(LOCAL_DEV_PRINCIPAL, planId));
  assert.ok(Option.isSome(opened));
  return opened.value;
}

/** The document the plan holds now, failing the eval where it does not read. */
async function planDocument(run: Run, planId: string) {
  const stored = await run(readPlan(LOCAL_DEV_PRINCIPAL, planId));
  assert.ok(Option.isSome(stored));
  return stored.value.plan.document;
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
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);
      const conversation = await standingMainConversation(run);

      /** A typed ask opening a new session over the conversation, answered once the session is its record. */
      const openSession = async (conversationId: string, message: string) => {
        const opened = await t.target.fetch("/eve/v1/session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [BRAIN_HOST_HEADER.CONVERSATION]: conversationId,
            [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
          },
          body: JSON.stringify({ message }),
        });
        assert.equal(opened.status, 202);
        // eve names more of an accepted session than the one field read here,
        // so the read drops what it does not name.
        const accepted = Result.getOrUndefined(
          readEither(ACCEPTED_SESSION, { excess: EXCESS_KEYS.DROP })(
            unparsedWire(await opened.json()),
          ),
        );
        assert.ok(accepted);
        // The door admits a session once its first event has recorded it on the conversation row.
        for (let waited = 0; waited < 40; waited += 1) {
          const runtimeSessionId = await readConversationRuntimeSessionId(run, conversationId);
          if (runtimeSessionId === accepted.sessionId) break;
          await t.sleep(250);
        }
        return accepted;
      };

      const accepted = await openSession(conversation.id, "remember that I prefer short replies");
      const session = await t.target.attachSession(accepted.sessionId);
      session.succeeded();
      session.calledTool(BRAIN_TOOL.WRITE_WORKSPACE_FILE);

      const turnId = hostTurnId(accepted.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, conversation.id);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint and the tool
      // set's, neither naming a row, since nothing of either is kept.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      assert.ok(turn.toolSetHash);
      assert.equal(
        turn.toolSetHash,
        toolSetHashOf(hostedToolDeclarations(BRAIN_TURN_TRIGGER.ASK, { quiet: false })),
      );

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

      const store = hostedStore({ keys: payloadKeyRing(Redacted.make(secret)) });
      const user = await run(store.workspace.read(LOCAL_DEV_PRINCIPAL, WORKSPACE_FILE.USER));
      assert.ok(user);
      assert.equal(user.content.split(SCRIPTED_FACT).length - 1, 1);
      const runtimeSessionId = await readConversationRuntimeSessionId(run, conversation.id);
      assert.equal(runtimeSessionId, accepted.sessionId);

      // A plan's conversation: the planning model reads the saved document it
      // is handed and saves the developer's words through update_plan.
      const plan = await run(createPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      await run(savePlanDocument(LOCAL_DEV_PRINCIPAL, plan.id, PLAN_SAVED));
      const planConversationId = await planConversation(run, plan.id);
      const planning = await openSession(planConversationId, PLAN_WORDS.FIRST);
      const planningSession = await t.target.attachSession(planning.sessionId);
      planningSession.succeeded();
      planningSession.calledTool(UPDATE_PLAN_TOOL.name);
      planningSession.notCalledTool(BRAIN_TOOL.WRITE_WORKSPACE_FILE);
      const afterFirst = [...PLAN_SAVED.assumptions, { text: PLAN_WORDS.FIRST, confirmed: false }];
      assert.deepEqual(await planDocument(run, plan.id), {
        body: PLAN_SAVED.body,
        assumptions: afterFirst,
      });
      const planningRows = await readMessagesByTurn(
        run,
        planConversationId,
        hostTurnId(planning.sessionId, "turn_0"),
      );
      const planningAnswer = planningRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
      assert.ok(planningAnswer);
      const planningCall = planningAnswer.parts.find((part) => isToolUIPart(part));
      assert.equal(planningCall?.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.ok(
        planningAnswer.parts.some(
          (part) => isTextUIPart(part) && part.text === SCRIPTED_PLANNING_REPLY,
        ),
      );

      // Resumed in a new session, the model is handed the document the first left.
      const resumed = await openSession(planConversationId, PLAN_WORDS.RESUMED);
      (await t.target.attachSession(resumed.sessionId)).succeeded();
      assert.deepEqual(await planDocument(run, plan.id), {
        body: PLAN_SAVED.body,
        assumptions: [...afterFirst, { text: PLAN_WORDS.RESUMED, confirmed: false }],
      });
    } finally {
      await runtime.dispose();
    }
  },
});
