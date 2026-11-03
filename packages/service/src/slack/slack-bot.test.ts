import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { linkSlackInstallation } from "@luke/database/models/slack-installation-store";
import { organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { DateTime, Effect, Option } from "effect";
import { SlackBotFailure, type SlackWebApi, slackBotOver } from "./slack-bot.js";

/**
 * Our Slack bot writing to a member, over a real store and a fake
 * Slack: a member whose email Slack knows is written to, one it does not
 * know is written nothing, and a Slack that refuses answers nothing rather
 * than failing whoever asked.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

const KNOWN_EMAIL = "known@app.test";
const POSTED = { channel: "D0001", ts: "1700000000.000100" };
const CONTENT = { text: "A thread needs you", blocks: [] };

/** A Slack that knows one member, by `KNOWN_EMAIL`, and posts every message it is handed. */
const fakeSlack: SlackWebApi = (method, args) => {
  switch (method) {
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

/** A workspace whose bot is connected, by the member given. */
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
