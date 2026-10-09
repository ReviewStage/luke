import assert from "node:assert/strict";
import { EXCESS_KEYS } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { isTextUIPart } from "ai";
import { eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Option, Result, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { defineEval } from "eve/evals";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
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
import { CODER_MODEL_FIXTURE } from "../../server/hosted/coder-host/bounds";
import { createCodingAgent } from "../../server/hosted/coding-agent-store";
import { createPlan } from "../../server/hosted/plan-store";
import { readMessagesByConversationTyped, readTurnById } from "../../tests/support/store-rows";
import { SCRIPTED_CODER_REPLY } from "../scripted-model";

/**
 * The whole coding-agent host under eve, end to end: eve's runtime runs a
 * coding agent's first turn under the scripted fixture model, which is
 * handed the plan as the session's first message and answers in words
 * without calling a tool, so no sandbox opens, no repository is checked
 * out, and no GitHub is reached; and the relay writes the turn into the
 * store through the writer, as the real providers' turns are written. The
 * eve server runs in this process with the database the environment names,
 * so the eval reads the rows back from the same Postgres. Where no database
 * is named the eval skips rather than pretending.
 */

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

const PLAN = { name: "Teammate invitations" } as const;
const PLAN_SNAPSHOT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";
const REPOSITORY = "acme/relay";

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

export default defineEval({
  description:
    "A coding agent's first turn runs through eve, the relay, and the writer into the store, under the scripted model.",
  async test(t) {
    const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
    if (!connectionString) {
      return t.skip("no database is named; the fixture writes nowhere");
    }
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);
      const plan = await run(createPlan(LOCAL_DEV_PRINCIPAL, { ...PLAN, repository: REPOSITORY }));
      const started = await run(
        createCodingAgent(LOCAL_DEV_PRINCIPAL, {
          planId: plan.id,
          idempotencyKey: `eval-${Date.now()}`,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: PLAN_SNAPSHOT,
          repository: REPOSITORY,
        }),
      );
      assert.ok(Option.isSome(started));
      const { agent } = started.value;

      // The Start as the route makes it: the plan as the first message of a typed turn on the agent's conversation.
      const opened = await t.target.fetch("/eve/v1/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BRAIN_HOST_HEADER.CONVERSATION]: agent.conversationId,
          [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
        },
        body: JSON.stringify({ message: agent.planSnapshot }),
      });
      assert.equal(opened.status, 202);
      const accepted = Result.getOrUndefined(
        readEither(ACCEPTED_SESSION, { excess: EXCESS_KEYS.DROP })(
          unparsedWire(await opened.json()),
        ),
      );
      assert.ok(accepted);
      const session = await t.target.attachSession(accepted.sessionId);
      session.succeeded();

      const turnId = hostTurnId(accepted.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, agent.conversationId);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      assert.equal(turn.model, CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID);
      assert.equal(turn.reasoningEffort, "high");
      assert.ok(turn.promptHash);

      const rows = await readMessagesByConversationTyped(run, agent.conversationId);
      assert.deepEqual(
        rows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(rows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      assert.ok(rows[0]?.parts.some((part) => isTextUIPart(part) && part.text === PLAN_SNAPSHOT));
      assert.ok(
        rows[1]?.parts.some(
          (part) => isTextUIPart(part) && part.text.startsWith(SCRIPTED_CODER_REPLY),
        ),
      );
      assert.equal(
        await readConversationRuntimeSessionId(run, agent.conversationId),
        accepted.sessionId,
      );
    } finally {
      await runtime.dispose();
    }
  },
});
