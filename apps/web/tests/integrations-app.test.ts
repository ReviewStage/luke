import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@sidecar/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  integrationLandingPath,
} from "@sidecar/features/integration-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { GitHubApp } from "../server/github/github-app";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  CONNECT_SIGN_IN_RESULT,
  type ConnectSignInResult,
} from "../server/hosted/integration-connect";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
  endIntegrationSignIn,
  expireIntegrationConnection,
  readIntegrationConnections,
  readIntegrationSignIn,
} from "../server/hosted/integration-store";
import {
  type IntegrationsAppSeams,
  integrationsApp,
  mintIntegrationState,
} from "../server/integrations-app";
import { GITHUB_APP_SETTINGS, openGithubUser, standingGithubRow } from "./support/github-app-fake";
import {
  GRANTING_SIGN_IN_URL,
  GRANTING_SIGN_IN_VERIFIER,
  integrationConnectOver,
} from "./support/integration-connect";
import { noNetwork } from "./support/no-network";

/**
 * The integrations an account is offered, as the integrations group answers
 * them: where every provider stands, a sign-in begun, and a sign-in the
 * browser returns from. A provider's allowlist variable names the accounts
 * it is offered to, and every other account is answered as though the
 * deployment never set the provider up. The store is the real one over the
 * migrations on PGlite; the connectors are the production read of the
 * test's variables, asking a Connect that grants everything, or one that
 * holds no grant, as a sign-in declined or never finished leaves it. GitHub has no
 * connector: it stands where the account's own GitHub sign-in does, read
 * through the real GitHub App over the account rows a sign-in leaves.
 */

const ORIGIN = "https://luke.test";
const GITHUB = INTEGRATION_PROVIDER.GITHUB;
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

/** GitHub's MCP server, offering at each ask the tools `listed` names then, and every bearer it was asked with. */
function githubServer(listed: () => readonly string[]) {
  const bearers: string[] = [];
  const layer = fakeHttpClientLayer(async (_url, init) => {
    bearers.push(new Headers(init.headers).get("authorization") ?? "");
    // The session's end, and a notification, answer nothing.
    if ((init.method ?? "GET") !== "POST") return new Response(null, { status: 200 });
    // SAFETY: the client sends one JSON-RPC message per request.
    const message = JSON.parse(await new Response(init.body).text()) as {
      id?: number;
      method: string;
    };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === "tools/list"
        ? { tools: listed().map((name) => ({ name, description: name })) }
        : { protocolVersion: "2025-06-18", capabilities: {} };
    return Response.json({ jsonrpc: "2.0", id: message.id, result });
  });
  return { layer, bearers };
}

/**
 * The group over the test's database and a deployment with these variables
 * and this GitHub App, none unless given, each bearer the account it names,
 * over a Connect that grants everything unless it `declines` and says the
 * sign-ins it began `ends` as given, and over the real store unless `seams`
 * stands in for part of it.
 */
const standing = (
  variables: Readonly<Record<string, string>>,
  githubApp: Layer.Layer<GitHubApp> = GitHubApp.layer(undefined),
  network: Layer.Layer<HttpClient.HttpClient> = noNetwork,
  connect: { readonly declines?: boolean; readonly ends?: ConnectSignInResult } = {},
  seams: Partial<IntegrationsAppSeams> = {},
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      integrationConnectOver(variables, connect),
      githubApp,
      network,
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
        endSignIn: endIntegrationSignIn,
        deleteConnection: deleteIntegrationConnection,
        mintState: mintIntegrationState,
        // The test's own clock, which also stamps a sign-in begun.
        now: () => clock.currentTimeMillisUnsafe(),
        ...seams,
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
      /** Where Slack stands for the account, and the sign-in failures the read found. */
      slackRead: (userId: string) =>
        Effect.map(ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }), ({ body }) => {
          // SAFETY: a statuses answer is a record of every provider's word, and the failures it found.
          const read = body as { integrations: Record<string, string>; signInFailures?: unknown };
          return {
            status: read.integrations[SLACK],
            failures: read.signInFailures,
            answer: JSON.stringify(body),
          };
        }),
      /** Where Slack stands for the account. */
      slackStatus: (userId: string) =>
        Effect.map(
          ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }),
          // SAFETY: a statuses answer is a record of every provider's word.
          ({ body }) => (body as { integrations: Record<string, string> }).integrations[SLACK],
        ),
      /** Where GitHub stands for the account. */
      githubStatus: (userId: string) =>
        Effect.map(
          ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }),
          // SAFETY: a statuses answer is a record of every provider's word.
          ({ body }) => (body as { integrations: Record<string, string> }).integrations[GITHUB],
        ),
      disconnectGithub: (userId: string) =>
        ask(`/api/account/integrations/disconnect?provider=${GITHUB}`, { method: "POST", userId }),
      /** The names of the tools GitHub's server offers the account. */
      githubTools: (userId: string) =>
        Effect.map(
          ask(`/api/account/integrations/tools?provider=${GITHUB}`, { userId }),
          // SAFETY: a tools answer is a list of named tools.
          ({ body }) => (body as { tools: { name: string }[] }).tools.map((tool) => tool.name),
        ),
      /** A Cancel of the account's Slack sign-in, answering where Slack then stands. */
      cancelSlack: (userId: string) =>
        Effect.map(
          ask(`/api/account/integrations/cancel?provider=${SLACK}`, { method: "POST", userId }),
          // SAFETY: a cancel answers the one provider's word.
          ({ body }) => (body as { status: string }).status,
        ),
      connectSlack: (userId: string) =>
        ask(`/api/account/integrations/connect?provider=${SLACK}`, { method: "POST", userId }),
      /** Where the browser returning from a Slack sign-in under way for the account lands. */
      slackLanding: (userId: string) =>
        Effect.gen(function* () {
          const state = mintIntegrationState();
          yield* beginIntegrationSignIn(
            userId,
            SLACK,
            state,
            Redacted.make(GRANTING_SIGN_IN_VERIFIER),
          );
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

  it.effect(
    "a browser back from a sign-in without a grant ends it: the provider stands disconnected rather than pending, and an expired one expired again",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SLACK_CONNECTOR, undefined, undefined, { declines: true });
        const first = yield* openAccount("alex@declined.example");
        const lapsed = yield* openAccount("jo@declined.example");
        yield* beginIntegrationSignIn(
          lapsed,
          SLACK,
          "state-before",
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(lapsed, SLACK, "state-before");
        yield* expireIntegrationConnection(lapsed, SLACK);

        assert.equal((yield* group.connectSlack(first)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(yield* group.slackStatus(first), INTEGRATION_STATUS.PENDING);
        assert.equal((yield* group.connectSlack(lapsed)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(yield* group.slackStatus(lapsed), INTEGRATION_STATUS.PENDING);
        for (const account of [first, lapsed]) {
          assert.equal(
            yield* group.slackLanding(account),
            integrationLandingPath(SLACK, INTEGRATION_LANDING_STATUS.NOT_COMPLETED),
          );
        }
        assert.equal(yield* group.slackStatus(first), INTEGRATION_STATUS.DISCONNECTED);
        assert.equal(yield* group.slackStatus(lapsed), INTEGRATION_STATUS.EXPIRED);
      }),
  );

  it.effect(
    "a Cancel ends only a sign-in under way: a first one leaves Slack disconnected, one over an expired row leaves it expired, and one that completed just before leaves it connected",
    () =>
      Effect.gen(function* () {
        const declining = yield* standing(SLACK_CONNECTOR, undefined, undefined, {
          declines: true,
        });
        const first = yield* openAccount("kai@cancelled.example");
        const lapsed = yield* openAccount("lee@cancelled.example");
        yield* beginIntegrationSignIn(
          lapsed,
          SLACK,
          "state-lapsed",
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(lapsed, SLACK, "state-lapsed");
        yield* expireIntegrationConnection(lapsed, SLACK);
        for (const account of [first, lapsed]) {
          assert.equal((yield* declining.connectSlack(account)).status, HOSTED_HTTP_STATUS.OK);
        }

        assert.equal(yield* declining.cancelSlack(first), INTEGRATION_STATUS.DISCONNECTED);
        assert.equal(yield* declining.slackStatus(first), INTEGRATION_STATUS.DISCONNECTED);
        assert.equal(yield* declining.cancelSlack(lapsed), INTEGRATION_STATUS.EXPIRED);
        assert.equal(yield* declining.slackStatus(lapsed), INTEGRATION_STATUS.EXPIRED);

        const granting = yield* standing(SLACK_CONNECTOR);
        const finished = yield* openAccount("max@cancelled.example");
        assert.equal((yield* granting.connectSlack(finished)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(
          yield* granting.slackLanding(finished),
          integrationLandingPath(SLACK, INTEGRATION_LANDING_STATUS.CONNECTED),
        );
        assert.equal(yield* granting.cancelSlack(finished), INTEGRATION_STATUS.CONNECTED);
        assert.equal(yield* granting.slackStatus(finished), INTEGRATION_STATUS.CONNECTED);
      }),
  );

  it.effect(
    "a Cancel that a sign-in begun again overtakes answers that sign-in pending, and leaves it to run",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(
          SLACK_CONNECTOR,
          undefined,
          undefined,
          { declines: true },
          {
            // A Reopen's Connect lands between the Cancel's read and its ending of the state it read.
            endSignIn: (userId, provider, state) =>
              Effect.andThen(
                beginIntegrationSignIn(
                  userId,
                  provider,
                  "state-reopened",
                  Redacted.make("connect-verifier"),
                ),
                endIntegrationSignIn(userId, provider, state),
              ),
          },
        );
        const account = yield* openAccount("sky@reopened.example");
        assert.equal((yield* group.connectSlack(account)).status, HOSTED_HTTP_STATUS.OK);

        assert.equal(yield* group.cancelSlack(account), INTEGRATION_STATUS.PENDING);
        assert.equal(yield* group.slackStatus(account), INTEGRATION_STATUS.PENDING);
      }),
  );

  it.effect(
    "a sign-in Connect says was cancelled on its own page is ended by the next read, which says so once, and Connect's handle never leaves the service",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SLACK_CONNECTOR, undefined, undefined, {
          declines: true,
          ends: { kind: CONNECT_SIGN_IN_RESULT.CANCELED },
        });
        const account = yield* openAccount("ana@cancelled-at-connect.example");
        const begun = yield* group.connectSlack(account);
        assert.deepEqual(begun.body, { url: GRANTING_SIGN_IN_URL });

        const ending = yield* group.slackRead(account);
        assert.equal(ending.status, INTEGRATION_STATUS.DISCONNECTED);
        assert.deepEqual(ending.failures, [
          { provider: SLACK, reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED },
        ]);
        assert.ok(!ending.answer.includes(GRANTING_SIGN_IN_VERIFIER));

        const after = yield* group.slackRead(account);
        assert.equal(after.status, INTEGRATION_STATUS.DISCONNECTED);
        assert.equal(after.failures, undefined);
      }),
  );

  it.effect(
    "a sign-in Connect says was refused answers Connect's own line as why, and an expired row stands expired again",
    () =>
      Effect.gen(function* () {
        const message = "The provider rejected the authorization-code exchange";
        const group = yield* standing(SLACK_CONNECTOR, undefined, undefined, {
          declines: true,
          ends: { kind: CONNECT_SIGN_IN_RESULT.FAILED, message },
        });
        const lapsed = yield* openAccount("bo@refused.example");
        yield* beginIntegrationSignIn(
          lapsed,
          SLACK,
          "state-before",
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(lapsed, SLACK, "state-before");
        yield* expireIntegrationConnection(lapsed, SLACK);
        assert.equal((yield* group.connectSlack(lapsed)).status, HOSTED_HTTP_STATUS.OK);

        const read = yield* group.slackRead(lapsed);
        assert.equal(read.status, INTEGRATION_STATUS.EXPIRED);
        assert.deepEqual(read.failures, [
          { provider: SLACK, reason: INTEGRATION_SIGN_IN_FAILURE.ERROR, message },
        ]);
        assert.equal(yield* group.slackStatus(lapsed), INTEGRATION_STATUS.EXPIRED);
      }),
  );

  it.effect(
    "a browser back without a grant from a sign-in Connect says was refused leaves it for the next read to say why",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SLACK_CONNECTOR, undefined, undefined, {
          declines: true,
          ends: { kind: CONNECT_SIGN_IN_RESULT.FAILED },
        });
        const account = yield* openAccount("dee@denied.example");
        assert.equal(
          yield* group.slackLanding(account),
          integrationLandingPath(SLACK, INTEGRATION_LANDING_STATUS.NOT_COMPLETED),
        );
        const read = yield* group.slackRead(account);
        assert.equal(read.status, INTEGRATION_STATUS.DISCONNECTED);
        assert.deepEqual(read.failures, [
          { provider: SLACK, reason: INTEGRATION_SIGN_IN_FAILURE.ERROR },
        ]);
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

  it.effect(
    "GitHub, which has no connector, stands connected while the account's own GitHub sign-in does and disconnected for an account that never signed in with GitHub, and a deployment without the GitHub App does not offer it",
    () =>
      Effect.gen(function* () {
        const group = yield* standing({}, GitHubApp.layer(GITHUB_APP_SETTINGS));
        const signedIn = yield* openGithubUser();
        const googleOnly = yield* openAccount("devon@google-only.example");

        assert.equal(yield* group.githubStatus(signedIn), INTEGRATION_STATUS.CONNECTED);
        assert.equal(yield* group.githubStatus(googleOnly), INTEGRATION_STATUS.DISCONNECTED);
        const withoutApp = yield* standing({});
        assert.equal(yield* withoutApp.githubStatus(signedIn), INTEGRATION_STATUS.UNAVAILABLE);
      }),
  );

  it.effect(
    "GitHub's tools are read from GitHub's server with the account's own GitHub sign-in token, afresh at every ask, and a Disconnect of GitHub is refused rather than answered as done",
    () =>
      Effect.gen(function* () {
        let offered: readonly string[] = ["get_me"];
        const server = githubServer(() => offered);
        const group = yield* standing({}, GitHubApp.layer(GITHUB_APP_SETTINGS), server.layer);
        const signedIn = yield* openGithubUser();

        assert.deepEqual(yield* group.githubTools(signedIn), ["get_me"]);
        offered = ["get_me", "list_issues"];
        assert.deepEqual(yield* group.githubTools(signedIn), ["get_me", "list_issues"]);
        assert.ok(server.bearers.length > 0);
        for (const bearer of server.bearers) {
          assert.equal(bearer, `Bearer ${standingGithubRow(0).accessToken}`);
        }
        assert.deepEqual(yield* group.disconnectGithub(signedIn), UNAVAILABLE_REFUSAL);
        assert.equal(yield* group.githubStatus(signedIn), INTEGRATION_STATUS.CONNECTED);
      }),
  );
});
