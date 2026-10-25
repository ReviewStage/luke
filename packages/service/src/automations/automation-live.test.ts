import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAutomation, recordAutomationRun } from "@luke/database/models/automation-store";
import { member, organization, user } from "@luke/database/schemas/auth";
import { getTestDB, mutableFunctionsOf } from "@luke/database/testing";
import {
  automationWorkspaceRunsLiveRowsSchema,
  automationWorkspaceRunsOfLiveRows,
} from "@luke/features/automation-live";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationScope,
} from "@luke/features/automation-wire";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
  automationWorkspaceRunsLiveStatements,
} from "./automation-live.js";

/**
 * A workspace's automations, an automation's runs, and a workspace's runs,
 * as their live endpoints seal them, call only functions Postgres marks
 * immutable, since Neon Realtime refuses any other ("scalar expression uses
 * a mutable function") where Postgres runs it without a word. A workspace's
 * runs hold only the runs of the automations the account may read.
 */

/** An account, as the auth plugin would leave its row. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A workspace the accounts named are plain members of. */
const openWorkspace = (...members: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(organization)
      .values({ id, name: "Test Workspace", slug: `workspace-${id}`, createdAt: now });
    for (const userId of members) {
      yield* db
        .insert(member)
        .values({ id: randomUUID(), organizationId: id, userId, role: "member", createdAt: now });
    }
    return id;
  });

/** An automation of `userId`'s in the workspace, under `scope`, that ran once at `firedAt`. */
const ranOnce = (
  userId: string,
  organizationId: string,
  name: string,
  scope: AutomationScope,
  firedAt: Date,
) =>
  Effect.gen(function* () {
    const made = Option.getOrThrow(
      yield* createAutomation(userId, {
        taskId: null,
        organizationId,
        repositories: ["acme/api"],
        name,
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Find and fix one flaky test." },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: null,
        webhookSecretHash: null,
        scope,
      }),
    );
    yield* recordAutomationRun(made, {
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: firedAt.getTime() },
      firedAt,
    });
  });

it.layer(getTestDB())("the automations' live statements", (it) => {
  it.effect("call only functions Postgres marks immutable, as Realtime requires", () =>
    Effect.gen(function* () {
      const { automations } = Option.getOrThrow(
        automationsLiveStatements("user-immutable", "workspace-immutable"),
      );
      const { runs } = Option.getOrThrow(
        automationRunsLiveStatements("user-immutable", randomUUID()),
      );
      const workspaceRuns = Option.getOrThrow(
        automationWorkspaceRunsLiveStatements("user-immutable", "workspace-immutable"),
      );
      assert.deepEqual(yield* mutableFunctionsOf(automations), []);
      assert.deepEqual(yield* mutableFunctionsOf(runs), []);
      assert.deepEqual(yield* mutableFunctionsOf(workspaceRuns.runs), []);
    }),
  );

  it.effect(
    "a workspace's runs hold its shared automations' and the account's own, newest first, and no teammate's personal one or another workspace's",
    () =>
      Effect.gen(function* () {
        const reader = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(reader, teammate);
        const elsewhere = yield* openWorkspace(reader);
        yield* ranOnce(reader, workspace, "Mine", AUTOMATION_SCOPE.PERSONAL, new Date(1_000));
        yield* ranOnce(teammate, workspace, "Shared", AUTOMATION_SCOPE.WORKSPACE, new Date(2_000));
        yield* ranOnce(
          teammate,
          workspace,
          "Teammate's own",
          AUTOMATION_SCOPE.PERSONAL,
          new Date(3_000),
        );
        yield* ranOnce(reader, elsewhere, "Elsewhere", AUTOMATION_SCOPE.PERSONAL, new Date(4_000));

        const sql = yield* SqlClient.SqlClient;
        const { runs } = Option.getOrThrow(
          automationWorkspaceRunsLiveStatements(reader, workspace),
        );
        const rows = yield* Schema.decodeUnknownEffect(automationWorkspaceRunsLiveRowsSchema)({
          runs: yield* sql.unsafe(runs.sql, [...runs.params]),
        });
        assert.deepEqual(
          automationWorkspaceRunsOfLiveRows(rows, 5_000).map((run) => run.automation.name),
          ["Shared", "Mine"],
        );
      }),
  );
});
