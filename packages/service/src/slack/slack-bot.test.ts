import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { member, organization, user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { DateTime, Effect, Option } from "effect";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
} from "../integrations/integration-store.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import { SlackBotFailure, type SlackWebApi, slackBotOver } from "./slack-bot.js";

const KNOWN_EMAIL = "known@app.test";
const POSTED = { channel: "D0001", ts: "1700000000.000100" };
const CONTENT = { text: "A thread needs you", blocks: [] };

const fakeSlack: SlackWebApi = (method, args, memberSubject) => {
  switch (method) {
    case "auth.test":
      return Effect.succeed(
        memberSubject === undefined
          ? { ok: true, team_id: "T0001", team: "Team" }
          : { ok: true, team_id: "T0001", user_id: `U-${memberSubject}` },
      );
    case "users.lookupByEmail":
      return args.email === KNOWN_EMAIL
        ? Effect.succeed({ ok: true, user: { id: "U0001" } })
        : Effect.fail(new SlackBotFailure({ method, code: "users_not_found" }));
    case "chat.postMessage":
      return Effect.succeed({ ok: true, ...POSTED });
    default:
      return Effect.succeed({ ok: true });
  }
};

const openAccount = (email: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name: "Test User", email });
    return id;
  });

const connectOwnSlack = (userId: string) =>
  Effect.gen(function* () {
    const state = `state-${randomUUID()}`;
    yield* beginIntegrationSignIn(
      userId,
      firstIntegrationAccount(userId, INTEGRATION_PROVIDER.SLACK),
      state,
    );
    yield* completeIntegrationSignIn(userId, INTEGRATION_PROVIDER.SLACK, state);
  });

const joinWorkspace = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    yield* (yield* Database).insert(member).values({
      id: randomUUID(),
      organizationId,
      userId,
      createdAt: yield* DateTime.nowAsDate,
    });
  });

const openConnectedWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(organization).values({
      id,
      name: "Test Workspace",
      slug: `workspace-${id}`,
      createdAt: yield* DateTime.nowAsDate,
    });
    yield* linkSlackInstallation({ organizationId: id, teamId: "T0001", teamName: "Team", userId });
    return id;
  });

it.layer(getTestDB())("the Slack bot", (it) => {
  it.effect("writes to a member Slack knows by their email, and nothing to one it does not", () =>
    Effect.gen(function* () {
      const known = yield* openAccount(KNOWN_EMAIL);
      const unknown = yield* openAccount(`${randomUUID()}@app.test`);
      const workspace = yield* openConnectedWorkspace(known);
      const bot = slackBotOver(fakeSlack);

      assert.deepEqual(yield* bot.dm(workspace, known, CONTENT), Option.some(POSTED));
      assert.deepEqual(yield* bot.dm(workspace, unknown, CONTENT), Option.none());
    }),
  );

  it.effect(
    "finds a member whose emails differ through their own Slack connection, writing to them and knowing them back",
    () =>
      Effect.gen(function* () {
        const writtenTo = yield* openAccount(`${randomUUID()}@app.test`);
        const writing = yield* openAccount(`${randomUUID()}@app.test`);
        const workspace = yield* openConnectedWorkspace(writtenTo);
        yield* joinWorkspace(workspace, writtenTo);
        yield* joinWorkspace(workspace, writing);
        yield* connectOwnSlack(writtenTo);
        yield* connectOwnSlack(writing);
        const bot = slackBotOver(fakeSlack);

        assert.deepEqual(yield* bot.dm(workspace, writtenTo, CONTENT), Option.some(POSTED));
        assert.deepEqual(
          yield* bot.memberOf(workspace, "T0001", `U-${writing}`),
          Option.some(writing),
        );
        assert.deepEqual(yield* bot.memberOf(workspace, "T0001", "U-stranger"), Option.none());
      }),
  );

  it.effect("answers nothing where Slack refuses, rather than failing", () =>
    Effect.gen(function* () {
      const known = yield* openAccount(`${randomUUID()}-${KNOWN_EMAIL}`);
      const workspace = yield* openConnectedWorkspace(known);
      const bot = slackBotOver((method) =>
        Effect.fail(new SlackBotFailure({ method, code: "invalid_auth" })),
      );

      assert.deepEqual(yield* bot.dm(workspace, known, CONTENT), Option.none());
    }),
  );
});
