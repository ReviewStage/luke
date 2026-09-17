import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { ACTION_KIND, type WireRecord, type WorkspaceAgentSelection } from "../server/core";
import { user } from "../server/db/auth-schema";
import { accountWorkspacePreference } from "../server/db/preferences-schema";
import { db } from "../server/db/query";
import { writeAccountPreferences } from "../server/hosted/account-store";
import type { ActionRoster } from "../server/hosted/action-execute";
import { handleSessionAction, type SessionActionOptions } from "../server/hosted/action-session";
import { encryptProviderKey } from "../server/hosted/encryption";
import { testSqlClient } from "./support/sql-client";

/**
 * The hosted action route over the account's real synced rows: the
 * `workspaceAgentDefaults` a Mac's settings store wrote through
 * `/api/account/preferences` is what a creation or a spawn asked through
 * `/api/actions/workspace` or `/api/actions/agent` starts on when the ask
 * itself named no model. Pinned against the migrated schema rather than an
 * injected read, because the regression this guards against was a route that
 * never reached those rows at all, so Conductor's own default decided (GPT-5.4
 * at high effort) over the Fable 5.1 at high the developer had chosen.
 *
 * Synthetic accounts and keys throughout.
 */

const SECRET = Redacted.make("a".repeat(64));

const EMPTY_ROSTER: ActionRoster = {
  observations: [],
  projects: [],
  unauthorized: false,
  unreachable: false,
};

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** What one execution was handed: the ask's fields, and the pairing beside them when one rode. */
interface HandedToExecution {
  fields: WireRecord;
  agentSelection?: WorkspaceAgentSelection;
}

function actionRequest(path: string, fields: Record<string, string>): Request {
  return new Request(`https://luke.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

/** The route's options for one signed-in account, with no `agentDefault` injected: production reads the rows. */
function routeOptions(
  userId: string,
  kind: SessionActionOptions["kind"],
  request: Request,
  handed: HandedToExecution[],
): SessionActionOptions {
  return {
    request,
    kind,
    encryptionSecret: SECRET,
    resolveUserId: () => Effect.succeedSome(userId),
    readKey: () => Effect.succeed({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    roster: () => Effect.succeed(EMPTY_ROSTER),
    unsupportedReason: () => undefined,
    execute: (options) =>
      Effect.sync(() => {
        handed.push({
          fields: options.fields,
          ...(options.agentSelection === undefined
            ? undefined
            : { agentSelection: options.agentSelection }),
        });
        return { result: "accepted" };
      }),
  };
}

const creationOptions = (userId: string, handed: HandedToExecution[]) =>
  routeOptions(
    userId,
    ACTION_KIND.CREATE_WORKSPACE,
    actionRequest("/api/actions/workspace", {
      providerId: "conductor",
      providerProjectId: "project-1",
      task: "build the thing",
    }),
    handed,
  );

const additionOptions = (userId: string, handed: HandedToExecution[]) =>
  routeOptions(
    userId,
    ACTION_KIND.ADD_AGENT,
    actionRequest("/api/actions/agent", {
      providerId: "conductor",
      providerSessionId: "session-1",
      agent: "claude",
    }),
    handed,
  );

const CHOSEN: WorkspaceAgentSelection = { agent: "claude", model: "fable-5-1", effort: "high" };

it.layer(testSqlClient)("the hosted action route over the account's synced agent pairing", (it) => {
  it.effect(
    "a creation that named no model starts on the pairing the Mac synced, effort included",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        yield* writeAccountPreferences(userId, {
          workspaceAgentDefaults: { conductor: CHOSEN },
        });

        const handed: HandedToExecution[] = [];
        const response = yield* handleSessionAction(creationOptions(userId, handed));

        assert.equal(response.status, 200);
        assert.equal((yield* Effect.promise(() => response.json())).result, "accepted");
        assert.deepEqual(handed, [
          {
            fields: { provider_id: "conductor", project_id: "project-1", task: "build the thing" },
            agentSelection: CHOSEN,
          },
        ]);
      }),
  );

  it.effect("an agent addition that named no model is handed the same pairing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, {
        workspaceAgentDefaults: { conductor: CHOSEN },
      });

      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(additionOptions(userId, handed));

      assert.equal(handed.length, 1);
      assert.deepEqual(handed[0]?.agentSelection, CHOSEN);
    }),
  );

  it.effect("an account that synced nothing hands the execution no pairing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;

      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(creationOptions(userId, handed));

      assert.equal(handed.length, 1);
      assert.equal("agentSelection" in (handed[0] ?? {}), false);
    }),
  );

  it.effect("a pairing chosen for another provider does not ride a Conductor creation", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, {
        workspaceAgentDefaults: { codex: CHOSEN },
      });

      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(creationOptions(userId, handed));

      assert.equal(handed.length, 1);
      assert.equal("agentSelection" in (handed[0] ?? {}), false);
    }),
  );

  it.effect("a synced pairing this build no longer lists is nothing rather than a request", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      // Written past the wire's guard on purpose: a row an older build stored
      // for a model Conductor has since retired, or a corrupted one.
      yield* db.insert(accountWorkspacePreference).values({
        userId,
        providerId: "conductor",
        defaultProjectId: null,
        agent: "claude",
        model: "retired-model",
        effort: "high",
        updatedAt: new Date(),
      });

      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(creationOptions(userId, handed));

      assert.equal(handed.length, 1);
      assert.equal("agentSelection" in (handed[0] ?? {}), false);
    }),
  );
});
