import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "@luke/database/testing";
import {
  workspaceMembersLiveRowsSchema,
  workspaceMembersOfLiveRows,
} from "@luke/features/workspace-live";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import {
  listFormerMembers,
  listMembers,
  workspaceMembersLiveStatements,
} from "./workspace-members.js";

/**
 * A workspace's people as the live statements deliver them: the members and
 * who the workspace's work names but left, exactly as the held reads answer
 * them, to a member, and nothing at all to an outsider or to a member once
 * they leave.
 *
 * Synthetic accounts throughout, over PGlite.
 */

/** A new account under the name and sign-in picture given. */
const openUser = (name: string, image: string | null = null) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* Database.use((db) =>
      db.insert(user).values({ id: userId, name, email: `${userId}@luke.test`, image }),
    );
    return userId;
  });

/** The workspace's people as the desktop builds them from the live rows, run as Realtime runs them, for `readerId`. */
const livePeopleOf = (readerId: string, organizationId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statements = Option.getOrThrow(workspaceMembersLiveStatements(readerId, organizationId));
    const rows = yield* Effect.all({
      members: sql.unsafe(statements.members.sql, [...statements.members.params]),
      former: sql.unsafe(statements.former.sql, [...statements.former.params]),
    });
    return workspaceMembersOfLiveRows(
      yield* Schema.decodeUnknownEffect(workspaceMembersLiveRowsSchema)(rows),
    );
  });

it.layer(getTestDB())("a workspace's people, live", (it) => {
  it.effect(
    "the live statements deliver the members and the former members the held reads answer to a member, and nothing to an outsider or to a member who left",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser("Owner", "https://avatars.githubusercontent.com/u/1");
        const admin = yield* openUser("Admin");
        const teammate = yield* openUser("Bea");
        const leaver = yield* openUser("Leaver", "https://example.test/not-drawn.png");
        const outsider = yield* openUser("Outsider");
        const workspaceId = yield* openWorkspace(owner);
        yield* openWorkspace(outsider);
        yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(workspaceId, teammate);
        yield* joinWorkspace(workspaceId, leaver);
        yield* createTask(leaver, { organizationId: workspaceId, name: "Left behind" });
        yield* leaveWorkspace(workspaceId, leaver);

        const members = yield* listMembers(workspaceId);
        const former = yield* listFormerMembers(workspaceId);
        assert.deepEqual(
          members.map((one) => one.role),
          [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER],
        );
        assert.deepEqual(
          former.map((one) => one.userId),
          [leaver],
        );
        for (const reader of [owner, admin, teammate]) {
          assert.deepEqual(yield* livePeopleOf(reader, workspaceId), { members, former });
        }
        const nobody = { members: [] };
        assert.deepEqual(yield* livePeopleOf(outsider, workspaceId), nobody);
        assert.deepEqual(yield* livePeopleOf(leaver, workspaceId), nobody);
      }),
  );
});
