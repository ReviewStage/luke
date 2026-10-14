import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  integrationLandingPath,
} from "@sidecar/hosted/integration-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
  readIntegrationConnections,
  readIntegrationSignIn,
} from "../server/hosted/integration-store";
import { integrationsApp, mintIntegrationState } from "../server/integrations-app";
import { GRANTING_SIGN_IN_URL, integrationConnectOver } from "./support/integration-connect";
import { noNetwork } from "./support/no-network";

/**
 * The integrations an account is offered, as the integrations group answers
 * them: where every provider stands, a sign-in begun, and a sign-in the
 * browser returns from. A provider's allowlist variable names the accounts
 * it is offered to, and every other account is answered as though the
 * deployment never set the provider up. The store is the real one over the
 * migrations on PGlite; the connectors are the production read of the
 * test's variables, asking a Connect that grants everything.
 */

const ORIGIN = "https://luke.test";
const SLACK = INTEGRATION_PROVIDER.SLACK;
const SLACK_CONNECTOR = { SLACK_CONNECTOR_UID: "oauth/slack" } as const;

/** An account whose user row holds this email; its id. */
const openAccount = (email: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email });
    return userId;
  });

/** The group over the test's database and a deployment with these variables, each bearer the account it names. */
const standing = (variables: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      integrationConnectOver(variables),
      noNetwork,
    );
    const app = HttpRouter.toWebHandler(
      integrationsApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
        readConnections: readIntegrationConnections,
        readSignIn: readIntegrationSignIn,
        beginSignIn: beginIntegrationSignIn,
        completeSignIn: completeIntegrationSignIn,
        deleteConnection: deleteIntegrationConnection,
        mintState: mintIntegrationState,
        // The test's own clock, which also stamps a sign-in begun.
        now: () => clock.currentTimeMillisUnsafe(),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    const fetch = (path: string, init: { method?: string; userId?: string } = {}) =>
      Effect.promise(() =>
        app.handler(
          new Request(new URL(path, ORIGIN), {
            method: init.method ?? "GET",
            headers: init.userId === undefined ? {} : { authorization: `Bearer ${init.userId}` },
          }),
        ),
      );
    const ask = (path: string, init: { method?: string; userId?: string }) =>
      Effect.gen(function* () {
        const response = yield* fetch(path, init);
        // SAFETY: the group answers JSON; the test compares it as the wire value it is.
        const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
        return { status: response.status, body };
      });
    return {
      /** Where Slack stands for the account. */
      slackStatus: (userId: string) =>
        Effect.map(
          ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }),
          // SAFETY: a statuses answer is a record of every provider's word.
          ({ body }) => (body as { integrations: Record<string, string> }).integrations[SLACK],
        ),
      connectSlack: (userId: string) =>
        ask(`/api/account/integrations/connect?provider=${SLACK}`, { method: "POST", userId }),
      /** Where the browser returning from a Slack sign-in under way for the account lands. */
      slackLanding: (userId: string) =>
        Effect.gen(function* () {
          const state = mintIntegrationState();
          yield* beginIntegrationSignIn(userId, SLACK, state);
          const response = yield* fetch(
            `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED}?state=${state}`,
          );
          return response.headers.get("location");
        }),
    };
  });

const UNAVAILABLE_REFUSAL = {
  status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  body: { error: HOSTED_API_ERROR.UNAVAILABLE },
};

it.layer(getTestDB())("the integrations an account is offered", (it) => {
  it.effect("with no allowlist set, a connector is offered to every account", () =>
    Effect.gen(function* () {
      const group = yield* standing(SLACK_CONNECTOR);
      const anyone = yield* openAccount("riley@elsewhere.example");

      assert.equal(yield* group.slackStatus(anyone), INTEGRATION_STATUS.DISCONNECTED);
      assert.deepEqual(yield* group.connectSlack(anyone), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { url: GRANTING_SIGN_IN_URL },
      });
    }),
  );

  it.effect(
    "a domain entry offers the integration to every email at that domain, whatever its case, and to no other account, which can neither begin nor finish a sign-in",
    () =>
      Effect.gen(function* () {
        const group = yield* standing({
          ...SLACK_CONNECTOR,
          SLACK_ALLOWED_ACCOUNTS: " @StageReview.example ",
        });
        const member = yield* openAccount("Dean@stagereview.EXAMPLE");
        const lookalike = yield* openAccount("dean@notstagereview.example");
        const outsider = yield* openAccount("sam@elsewhere.example");

        assert.equal(yield* group.slackStatus(member), INTEGRATION_STATUS.DISCONNECTED);
        assert.equal((yield* group.connectSlack(member)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(
          yield* group.slackLanding(member),
          integrationLandingPath(SLACK, INTEGRATION_LANDING_STATUS.CONNECTED),
        );
        for (const withheld of [lookalike, outsider]) {
          assert.equal(yield* group.slackStatus(withheld), INTEGRATION_STATUS.UNAVAILABLE);
          assert.deepEqual(yield* group.connectSlack(withheld), UNAVAILABLE_REFUSAL);
        }
        assert.equal(
          yield* group.slackLanding(outsider),
          integrationLandingPath(SLACK, INTEGRATION_LANDING_STATUS.UNAVAILABLE),
        );
        assert.equal(yield* group.slackStatus(outsider), INTEGRATION_STATUS.UNAVAILABLE);
      }),
  );

  it.effect("an exact email entry offers the integration to that account alone", () =>
    Effect.gen(function* () {
      const group = yield* standing({
        ...SLACK_CONNECTOR,
        SLACK_ALLOWED_ACCOUNTS: "@other.example,pat@luke.example",
      });
      const pat = yield* openAccount("pat@luke.example");
      const colleague = yield* openAccount("sam@luke.example");

      assert.equal(yield* group.slackStatus(pat), INTEGRATION_STATUS.DISCONNECTED);
      assert.equal(yield* group.slackStatus(colleague), INTEGRATION_STATUS.UNAVAILABLE);
    }),
  );

  it.effect(
    "an allowlist set to blanks, or to entries of neither shape, offers the integration to no account rather than every one",
    () =>
      Effect.gen(function* () {
        const anyone = yield* openAccount("quinn@elsewhere.example");
        for (const listed of ["   ", "@", " @ , luke.example, @@elsewhere.example, quinn@"]) {
          const group = yield* standing({ ...SLACK_CONNECTOR, SLACK_ALLOWED_ACCOUNTS: listed });
          assert.equal(yield* group.slackStatus(anyone), INTEGRATION_STATUS.UNAVAILABLE, listed);
        }
      }),
  );
});
