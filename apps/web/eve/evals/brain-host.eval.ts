import assert from "node:assert/strict";
import { EXCESS_KEYS } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { isTextUIPart, isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Option, Result, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { defineEval } from "eve/evals";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "../../server/core";
import { user } from "../../server/db/auth-schema";
import { db } from "../../server/db/query";
import { sqlClientOverUrl } from "../../server/db/sql-client";
import { conversations } from "../../server/db/storage-schema";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../../server/hosted/brain-host/bounds";
import { hostTurnId } from "../../server/hosted/brain-host/ids";
import {
  EVE_DELEGATION_TOOL,
  planningToolDeclarations,
} from "../../server/hosted/brain-host/planning";
import {
  createPlan,
  openPlanConversation,
  readPlan,
  savePlanDocument,
} from "../../server/hosted/plan-store";
import { toolSetHashOf } from "../../server/hosted/store/content-addressed";
import { readMessagesByConversationTyped, readTurnById } from "../../tests/support/store-rows";
import { SCRIPTED_DELEGATE, SCRIPTED_PLANNING_REPLY } from "../scripted-model";

/**
 * The whole host under eve, end to end: eve's runtime runs a typed ask in a
 * plan's conversation under the scripted fixture model, which is handed the
 * saved document in its standing context and answers in words, leaving the
 * document as the notetaker saved it, and the relay writes the turn into the
 * store through the writer. The eve server runs in this process with the database the
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
} as const;
const PLAN_SAVED = {
  body: "# Teammate invitations\n\n## Open questions\n- Who may invite?\n",
  assumptions: [{ text: "Invites reuse `memberships` with a `pending` state." }],
} as const;
const PLAN_WORDS = {
  FIRST: "Any member should be able to invite, not only admins.",
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

export default defineEval({
  description:
    "A typed ask in a plan's conversation runs through eve, the relay, and the writer into the store.",
  async test(t) {
    const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
    if (!connectionString) {
      return t.skip("no database is named; the fixture writes nowhere");
    }
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);

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

      // The planning model is handed the saved document and answers in words;
      // the notetaker beside the call writes the plan, so the turn leaves the
      // document as it stood.
      const plan = await run(createPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      await run(savePlanDocument(LOCAL_DEV_PRINCIPAL, plan.id, PLAN_SAVED));
      const planConversationId = await planConversation(run, plan.id);
      const planning = await openSession(planConversationId, PLAN_WORDS.FIRST);
      const planningSession = await t.target.attachSession(planning.sessionId);
      planningSession.succeeded();
      assert.deepEqual(await planDocument(run, plan.id), PLAN_SAVED);

      const turnId = hostTurnId(planning.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, planConversationId);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint and the tool
      // set's, neither naming a row, since nothing of either is kept.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      assert.equal(turn.toolSetHash, toolSetHashOf(planningToolDeclarations()));

      const planningRows = await readMessagesByTurn(run, planConversationId, turnId);
      assert.deepEqual(
        planningRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(planningRows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      const planningAnswer = planningRows[1];
      assert.ok(planningAnswer);
      assert.ok(
        planningAnswer.parts.some(
          (part) => isTextUIPart(part) && part.text === SCRIPTED_PLANNING_REPLY,
        ),
      );
      const runtimeSessionId = await readConversationRuntimeSessionId(run, planConversationId);
      assert.equal(runtimeSessionId, planning.sessionId);

      // Research handed to the worker subagent returns a receipt at once, and
      // the planning turn stays open until the worker's result reaches the
      // model inside it: one turn on record, settled, holding the call, the
      // words before the wait, and the words after it.
      const researchPlan = await run(createPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      const researchConversationId = await planConversation(run, researchPlan.id);
      const research = await openSession(
        researchConversationId,
        `${SCRIPTED_DELEGATE}invite links`,
      );
      const researchSession = await t.target.attachSession(research.sessionId);
      researchSession.succeeded();
      const researchTurnId = hostTurnId(research.sessionId, "turn_0");
      let held: Awaited<ReturnType<typeof readTurnById>> | undefined;
      for (let waited = 0; waited < 120 && held?.status !== TURN_STATUS.SETTLED; waited += 1) {
        held = await readTurnById(run, researchTurnId);
        await t.sleep(500);
      }
      assert.ok(held);
      assert.equal(held.origin, TURN_ORIGIN.TYPED);
      assert.equal(held.status, TURN_STATUS.SETTLED);
      assert.equal(await readTurnById(run, hostTurnId(research.sessionId, "turn_1")), undefined);
      // The worker ran to its end on its own model and tools, rather than failing for want of them.
      const settled = researchSession.events.find((event) => event.type === "task.settled");
      assert.ok(settled && settled.type === "task.settled");
      assert.equal(settled.data.name, EVE_DELEGATION_TOOL.WORKER);
      assert.equal(settled.data.status, "completed");
      const researchRows = await readMessagesByTurn(run, researchConversationId, held.id);
      assert.deepEqual(
        researchRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      const researchAnswer = researchRows[1];
      assert.ok(researchAnswer);
      const delegation = researchAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(delegation);
      assert.equal(delegation.type, `tool-${EVE_DELEGATION_TOOL.WORKER}`);
      assert.equal(delegation.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      // The words before the wait and the words after it, in one answer.
      assert.ok(researchAnswer.parts.filter((part) => isTextUIPart(part)).length >= 2);
    } finally {
      await runtime.dispose();
    }
  },
});
