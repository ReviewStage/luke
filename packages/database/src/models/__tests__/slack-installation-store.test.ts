import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  deleteSlackInstallation,
  linkSlackInstallation,
  recordSlackMemberLookup,
  slackMemberLookup,
  workspaceSlackInstallation,
} from "../slack-installation-store.js";

/**
 * The Slack team a workspace's bot is connected to, over a real dialect:
 * each workspace reads only its own installation and its own members' Slack
 * ids, and a Disconnect forgets the ids it kept.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const openWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const id = randomUUID();
  yield* db.insert(organization).values({
    id,
    name: "Test Workspace",
    slug: `workspace-${id}`,
    createdAt: yield* DateTime.nowAsDate,
  });
  return id;
});

it.layer(getTestDB())("the Slack installation store", (it) => {
  it.effect("a workspace reads only its own installation and its own members' Slack ids", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const ours = yield* openWorkspace;
      const theirs = yield* openWorkspace;

      yield* linkSlackInstallation({
        organizationId: ours,
        teamId: "T0001",
        teamName: "Ours",
        userId: member,
      });
      yield* recordSlackMemberLookup(ours, member, "U0001");

      assert.deepEqual(
        yield* workspaceSlackInstallation(ours),
        Option.some({ teamId: "T0001", teamName: "Ours" }),
      );
      assert.equal(Option.isNone(yield* workspaceSlackInstallation(theirs)), true);
      assert.deepEqual(
        Option.map(yield* slackMemberLookup(ours, member), (found) => found.slackUserId),
        Option.some("U0001"),
      );
      assert.equal(Option.isNone(yield* slackMemberLookup(theirs, member)), true);
      assert.equal(yield* deleteSlackInstallation(theirs), false);
      assert.equal(Option.isSome(yield* workspaceSlackInstallation(ours)), true);
    }),
  );

  it.effect("a disconnect, or a link to another team, forgets every member's Slack id", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const workspace = yield* openWorkspace;
      const link = { organizationId: workspace, teamName: "Team", userId: member };

      yield* linkSlackInstallation({ ...link, teamId: "T0001" });
      yield* recordSlackMemberLookup(workspace, member, null);
      yield* linkSlackInstallation({ ...link, teamId: "T0002" });
      const afterMove = yield* slackMemberLookup(workspace, member);
      yield* recordSlackMemberLookup(workspace, member, "U0002");
      const disconnected = yield* deleteSlackInstallation(workspace);

      assert.equal(Option.isNone(afterMove), true);
      assert.equal(disconnected, true);
      assert.equal(Option.isNone(yield* slackMemberLookup(workspace, member)), true);
    }),
  );
});
