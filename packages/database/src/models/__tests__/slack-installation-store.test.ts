import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { INTEGRATION_ROW_STATUS } from "../../integration-vocabulary.js";
import { member as memberTable, organization, user } from "../../schemas/auth.js";
import { integrationConnection } from "../../schemas/integration.js";
import { getTestDB } from "../../testing/index.js";
import {
  deleteSlackInstallation,
  linkSlackInstallation,
  recordSlackMemberLookup,
  slackMemberByEmail,
  slackMemberLookup,
  slackMemberOf,
  slackUnresolvedConnections,
  workspaceSlackInstallation,
} from "../slack-installation-store.js";

/**
 * The Slack team a workspace's bot is connected to, over a real dialect:
 * each workspace reads only its own installation and its own members' Slack
 * ids, emails, and own Slack accounts, and a Disconnect forgets the ids it
 * kept.
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
      yield* (yield* Database).insert(memberTable).values({
        id: randomUUID(),
        organizationId: ours,
        userId: member,
        createdAt: yield* DateTime.nowAsDate,
      });

      yield* linkSlackInstallation({
        organizationId: ours,
        teamId: "T0001",
        teamName: "Ours",
        userId: member,
      });
      yield* (yield* Database).insert(integrationConnection).values({
        id: randomUUID(),
        userId: member,
        provider: INTEGRATION_PROVIDER.SLACK,
        connectSubject: member,
        connectionName: INTEGRATION_PROVIDER.SLACK,
        status: INTEGRATION_ROW_STATUS.CONNECTED,
      });
      const unresolved = yield* slackUnresolvedConnections(ours);
      const theirsUnresolved = yield* slackUnresolvedConnections(theirs);
      yield* recordSlackMemberLookup(ours, member, "U0001");

      assert.deepEqual(
        yield* workspaceSlackInstallation(ours),
        Option.some({ teamId: "T0001", teamName: "Ours" }),
      );
      assert.equal(Option.isNone(yield* workspaceSlackInstallation(theirs)), true);
      assert.deepEqual(unresolved, [{ userId: member, connectSubject: member }]);
      assert.deepEqual(theirsUnresolved, []);
      assert.deepEqual(yield* slackUnresolvedConnections(ours), []);
      assert.deepEqual(
        Option.map(yield* slackMemberLookup(ours, member), (found) => found.slackUserId),
        Option.some("U0001"),
      );
      assert.equal(Option.isNone(yield* slackMemberLookup(theirs, member)), true);
      assert.deepEqual(yield* slackMemberOf(ours, "T0001", "U0001"), Option.some(member));
      assert.equal(Option.isNone(yield* slackMemberOf(theirs, "T0001", "U0001")), true);
      assert.equal(Option.isNone(yield* slackMemberOf(ours, "T0002", "U0001")), true);
      const email = `${member}@APP.test`;
      assert.deepEqual(yield* slackMemberByEmail(ours, email), Option.some(member));
      assert.equal(Option.isNone(yield* slackMemberByEmail(theirs, email)), true);
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
