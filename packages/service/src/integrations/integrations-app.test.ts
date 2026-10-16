import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  integrationLandingPath,
  integrationStatusesAnswerSchema,
} from "@luke/features/integration-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, Effect, Layer, Option, Redacted, Schema } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  GITHUB_APP_SETTINGS,
  openGithubUser,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import {
  firstIntegrationAccount,
  GRANTING_SIGN_IN_URL,
  GRANTING_SIGN_IN_VERIFIER,
  integrationConnectOver,
} from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import { CONNECT_SIGN_IN_RESULT, type ConnectSignInResult } from "./integration-connect.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationAccount,
  deleteIntegrationConnection,
  endIntegrationSignIn,
  expireIntegrationConnection,
  fillIntegrationLabel,
  readIntegrationConnections,
  readIntegrationSignIn,
  renameIntegrationConnection,
} from "./integration-store.js";
import {
  type IntegrationsAppSeams,
  integrationsApp,
  mintIntegrationState,
} from "./integrations-app.js";

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
const NOTION = INTEGRATION_PROVIDER.NOTION;
const NOTION_CONNECTOR = { NOTION_CONNECTOR_UID: "oauth/notion" } as const;

/** The accounts a statuses answer names, as the wire spells them. */
function accountsIn(body: WireBoundaryInput): readonly IntegrationAccount[] {
  return Schema.decodeUnknownSync(integrationStatusesAnswerSchema)(body).accounts ?? [];
}

/** The providers a statuses answer says the account may add another account at. */
function addableIn(body: WireBoundaryInput): readonly string[] {
  return Schema.decodeUnknownSync(integrationStatusesAnswerSchema)(body).addable ?? [];
}

/** One provider's word in a statuses answer. */
function statusIn(body: WireBoundaryInput, provider: IntegrationProvider): string {
  return Schema.decodeUnknownSync(integrationStatusesAnswerSchema)(body).integrations[provider];
}

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
  connect: {
    readonly declines?: boolean;
    readonly ends?: ConnectSignInResult;
    readonly names?: (subject: string) => string | undefined;
    readonly grantsOnce?: boolean;
  } = {},
  seams: Partial<IntegrationsAppSeams> = {},
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    // Each account added is handed the next of these as its subject at Connect, unique to this group, since the suite's tests share one database.
    const minted = randomUUID();
    let subjects = 0;
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
        deleteAccount: deleteIntegrationAccount,
        fillLabel: fillIntegrationLabel,
        renameConnection: renameIntegrationConnection,
        mintState: mintIntegrationState,
        mintSubject: () => {
          subjects += 1;
          return `subject-${minted}-${subjects}`;
        },
        // The test's own clock, which also stamps a sign-in begun.
        now: () => clock.currentTimeMillisUnsafe(),
        ...seams,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    const fetch = (path: string, init: { method?: string; userId?: string; body?: string } = {}) =>
      Effect.promise(() =>
        app.handler(
          new Request(new URL(path, ORIGIN), {
            method: init.method ?? "GET",
            headers: init.userId === undefined ? {} : { authorization: `Bearer ${init.userId}` },
            ...(init.body !== undefined ? { body: init.body } : undefined),
          }),
        ),
      );
    const ask = (path: string, init: { method?: string; userId?: string; body?: string }) =>
      Effect.gen(function* () {
        const response = yield* fetch(path, init);
        // SAFETY: the group answers JSON; the test compares it as the wire value it is.
        const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
        return { status: response.status, body };
      });
    return {
      /** Any of the group's paths, answered as status and body. */
      ask,
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
            firstIntegrationAccount(userId, SLACK),
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
        body: { url: GRANTING_SIGN_IN_URL, connection: SLACK },
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
          firstIntegrationAccount(lapsed, SLACK),
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
          firstIntegrationAccount(lapsed, SLACK),
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
            endSignIn: (userId, connectionName, state) =>
              Effect.andThen(
                beginIntegrationSignIn(
                  userId,
                  firstIntegrationAccount(userId, SLACK),
                  "state-reopened",
                  Redacted.make("connect-verifier"),
                ),
                endIntegrationSignIn(userId, connectionName, state),
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
        assert.deepEqual(begun.body, { url: GRANTING_SIGN_IN_URL, connection: SLACK });

        const ending = yield* group.slackRead(account);
        assert.equal(ending.status, INTEGRATION_STATUS.DISCONNECTED);
        assert.deepEqual(ending.failures, [
          { provider: SLACK, connection: SLACK, reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED },
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
          firstIntegrationAccount(lapsed, SLACK),
          "state-before",
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(lapsed, SLACK, "state-before");
        yield* expireIntegrationConnection(lapsed, SLACK);
        assert.equal((yield* group.connectSlack(lapsed)).status, HOSTED_HTTP_STATUS.OK);

        const read = yield* group.slackRead(lapsed);
        assert.equal(read.status, INTEGRATION_STATUS.EXPIRED);
        assert.deepEqual(read.failures, [
          {
            provider: SLACK,
            connection: SLACK,
            reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
            message,
          },
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
          { provider: SLACK, connection: SLACK, reason: INTEGRATION_SIGN_IN_FAILURE.ERROR },
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
  it.effect(
    "a second account at a provider signs in beside the first, and is named and disconnected on its own",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(NOTION_CONNECTOR);
        const userId = yield* openAccount("pat@two-notions.example");
        const notion = (suffix: string) => `/api/account/integrations/${suffix}`;
        const first = yield* group.ask(notion(`connect?provider=${NOTION}`), {
          method: "POST",
          userId,
        });
        assert.deepEqual(first.body, { url: GRANTING_SIGN_IN_URL, connection: NOTION });
        const second = yield* group.ask(notion(`connect?provider=${NOTION}&add=true`), {
          method: "POST",
          userId,
        });
        assert.deepEqual(second.body, { url: GRANTING_SIGN_IN_URL, connection: "notion-2" });

        // The read settles both sign-ins: a Connect that grants every subject holds a grant for each.
        const settled = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        assert.deepEqual(accountsIn(settled.body), [
          { provider: NOTION, connection: NOTION, status: INTEGRATION_STATUS.CONNECTED },
          { provider: NOTION, connection: "notion-2", status: INTEGRATION_STATUS.CONNECTED },
        ]);
        assert.ok(addableIn(settled.body).includes(NOTION));
        assert.equal(statusIn(settled.body, NOTION), INTEGRATION_STATUS.CONNECTED);

        const renamed = yield* group.ask(notion(`rename?provider=${NOTION}&connection=notion-2`), {
          method: "POST",
          userId,
          body: JSON.stringify({ label: "  Personal " }),
        });
        assert.deepEqual(renamed.body, {
          account: {
            provider: NOTION,
            connection: "notion-2",
            label: "Personal",
            status: INTEGRATION_STATUS.CONNECTED,
          },
        });
        yield* group.ask(notion(`disconnect?provider=${NOTION}&connection=notion-2`), {
          method: "POST",
          userId,
        });
        const after = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        // The first account stands alone.
        assert.deepEqual(
          accountsIn(after.body).map((account) => account.connection),
          [NOTION],
        );
      }),
  );

  it.effect(
    "a provider held to one account, or offering only one, refuses a second, and a connection of another provider is not found",
    () =>
      Effect.gen(function* () {
        const held = yield* standing({ ...NOTION_CONNECTOR, NOTION_MULTIPLE_ACCOUNTS: "off" });
        const userId = yield* openAccount("sam@held.example");
        const adding = yield* held.ask(
          `/api/account/integrations/connect?provider=${NOTION}&add=true`,
          { method: "POST", userId },
        );
        assert.deepEqual(adding.body, UNAVAILABLE_REFUSAL.body);
        const read = yield* held.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        assert.ok(!addableIn(read.body).includes(NOTION));

        const single = yield* standing({ GRANOLA_CONNECTOR_UID: "oauth/granola" });
        const granola = yield* single.ask(
          `/api/account/integrations/connect?provider=${INTEGRATION_PROVIDER.GRANOLA}&add=true`,
          { method: "POST", userId },
        );
        assert.deepEqual(granola.body, UNAVAILABLE_REFUSAL.body);

        const crossed = yield* held.ask(
          `/api/account/integrations/connect?provider=${NOTION}&connection=linear-2`,
          { method: "POST", userId },
        );
        assert.equal(crossed.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }),
  );

  it.effect("a provider holding the most accounts is no longer addable, and refuses one more", () =>
    Effect.gen(function* () {
      const group = yield* standing(NOTION_CONNECTOR);
      const userId = yield* openAccount("max@five-notions.example");
      const add = (query: string) =>
        group.ask(`/api/account/integrations/connect?provider=${NOTION}${query}`, {
          method: "POST",
          userId,
        });
      yield* add("");
      for (let added = 1; added < INTEGRATION_ACCOUNTS_MAX; added += 1) yield* add("&add=true");
      const full = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });

      assert.equal(accountsIn(full.body).length, INTEGRATION_ACCOUNTS_MAX);
      assert.ok(!addableIn(full.body).includes(NOTION));
      assert.deepEqual((yield* add("&add=true")).body, UNAVAILABLE_REFUSAL.body);
    }),
  );

  it.effect(
    "sign-ins left past their window hold no account place and are let go when another account is added, which takes the provider's own name",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(NOTION_CONNECTOR, undefined, undefined, { declines: true });
        const userId = yield* openAccount("left@five-notions.example");
        const add = (query: string) =>
          group.ask(`/api/account/integrations/connect?provider=${NOTION}${query}`, {
            method: "POST",
            userId,
          });
        yield* add("");
        for (let added = 1; added < INTEGRATION_ACCOUNTS_MAX; added += 1) yield* add("&add=true");
        yield* TestClock.adjust("16 minutes");
        const read = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });

        assert.equal(accountsIn(read.body).length, 0);
        assert.ok(addableIn(read.body).includes(NOTION));
        // The sign-ins left behind are let go, so the account added takes the provider's own name and stands first.
        assert.deepEqual((yield* add("&add=true")).body, {
          url: GRANTING_SIGN_IN_URL,
          connection: NOTION,
        });
      }),
  );

  it.effect(
    "a sign-in restarted while an added account lets go of the ones left behind keeps its name and its state",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("restarted@notion.example");
        // Note that the first account's sign-in is restarted where the add would end it, as a reconnect landing between the two would.
        const group = yield* standing(
          NOTION_CONNECTOR,
          undefined,
          undefined,
          { declines: true },
          {
            endSignIn: (owner, connectionName, state) =>
              connectionName === NOTION
                ? Effect.asVoid(
                    beginIntegrationSignIn(
                      owner,
                      firstIntegrationAccount(owner, NOTION),
                      "restarted-state",
                      Redacted.make("connect-verifier"),
                    ),
                  )
                : endIntegrationSignIn(owner, connectionName, state),
          },
        );
        const add = (query: string) =>
          group.ask(`/api/account/integrations/connect?provider=${NOTION}${query}`, {
            method: "POST",
            userId,
          });
        yield* add("");
        yield* TestClock.adjust("16 minutes");

        assert.deepEqual((yield* add("&add=true")).body, {
          url: GRANTING_SIGN_IN_URL,
          connection: "notion-2",
        });
        assert.equal((yield* readIntegrationSignIn("restarted-state"))?.connectionName, NOTION);
      }),
  );

  it.effect(
    "an account added while another add lets go of a sign-in left behind holds the last place, and the other is refused",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("raced@five-notions.example");
        // Note that the fifth place is taken where this add would let its old sign-in go, as another add landing between the two would.
        const group = yield* standing(
          NOTION_CONNECTOR,
          undefined,
          undefined,
          { declines: true },
          {
            endSignIn: (owner, connectionName, state) =>
              Effect.andThen(endIntegrationSignIn(owner, connectionName, state), () =>
                Effect.asVoid(
                  beginIntegrationSignIn(
                    owner,
                    { provider: NOTION, connectionName, connectSubject: `${connectionName}-raced` },
                    `${connectionName}-raced-state`,
                    Redacted.make("connect-verifier"),
                  ),
                ),
              ),
          },
        );
        const connect = (query: string) =>
          group.ask(`/api/account/integrations/connect?provider=${NOTION}${query}`, {
            method: "POST",
            userId,
          });
        yield* connect("");
        for (let added = 1; added < INTEGRATION_ACCOUNTS_MAX; added += 1) {
          yield* connect("&add=true");
        }
        yield* TestClock.adjust("16 minutes");
        // Every account but the fifth signs in again, so only the fifth's sign-in is left behind.
        for (let place = 1; place < INTEGRATION_ACCOUNTS_MAX; place += 1) {
          yield* connect(place === 1 ? "" : `&connection=${NOTION}-${place}`);
        }

        assert.deepEqual((yield* connect("&add=true")).body, UNAVAILABLE_REFUSAL.body);
      }),
  );

  it.effect(
    "a disconnect that read an account replaced since under the same name, even the first under the same subject, leaves the replacement standing and says so",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("dee@replaced.example");
        const first = (state: string) =>
          Effect.andThen(
            beginIntegrationSignIn(
              userId,
              firstIntegrationAccount(userId, NOTION),
              state,
              Redacted.make("connect-verifier"),
            ),
            completeIntegrationSignIn(userId, NOTION, state),
          );
        yield* first(`state-read-${userId}`);
        const read = yield* readIntegrationConnections(userId);
        // Another window disconnects it and connects Notion again, under the same name and subject, after this disconnect read it.
        yield* deleteIntegrationConnection(userId, NOTION);
        yield* first(`state-replacing-${userId}`);
        const replacing = yield* readIntegrationConnections(userId);
        let reads = 0;
        const group = yield* standing(NOTION_CONNECTOR, undefined, undefined, undefined, {
          readConnections: () => {
            reads += 1;
            return Effect.succeed(reads === 1 ? read : replacing);
          },
        });

        const answer = yield* group.ask(`/api/account/integrations/disconnect?provider=${NOTION}`, {
          method: "POST",
          userId,
        });
        assert.deepEqual(answer.body, { status: INTEGRATION_STATUS.CONNECTED });
        assert.deepEqual(
          (yield* readIntegrationConnections(userId)).map((row) => row.id),
          replacing.map((row) => row.id),
        );
      }),
  );

  it.effect(
    "a read that ends the sign-ins holding a provider's places offers the provider again in that same read",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(NOTION_CONNECTOR, undefined, undefined, {
          declines: true,
          ends: { kind: CONNECT_SIGN_IN_RESULT.CANCELED },
        });
        const userId = yield* openAccount("ended@five-notions.example");
        const add = (query: string) =>
          group.ask(`/api/account/integrations/connect?provider=${NOTION}${query}`, {
            method: "POST",
            userId,
          });
        yield* add("");
        for (let added = 1; added < INTEGRATION_ACCOUNTS_MAX; added += 1) yield* add("&add=true");
        const read = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });

        assert.equal(accountsIn(read.body).length, 0);
        assert.ok(addableIn(read.body).includes(NOTION));
      }),
  );

  it.effect(
    "an account connected before labels were kept takes its name at the provider from its grant at the next read, once",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("dean@before-labels.example");
        // The account's one Notion, connected as the upgrade's migration left it: under its user id, with no label.
        yield* beginIntegrationSignIn(
          userId,
          firstIntegrationAccount(userId, NOTION),
          `state-before-labels-${userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(userId, NOTION, `state-before-labels-${userId}`);
        const labelsOf = (group: { ask: typeof upgraded.ask }) =>
          Effect.map(group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }), ({ body }) =>
            accountsIn(body).map((account) => account.label),
          );
        const upgraded = yield* standing(NOTION_CONNECTOR, undefined, undefined, {
          names: (subject) => (subject === userId ? "Acme" : undefined),
        });

        assert.deepEqual(yield* labelsOf(upgraded), ["Acme"]);
        // The name is kept: a Connect that no longer names the workspace still answers it.
        const silent = yield* standing(NOTION_CONNECTOR);
        assert.deepEqual(yield* labelsOf(silent), ["Acme"]);
      }),
  );

  it.effect(
    "a read while an unlabelled account reconnects leaves its name to the grant the reconnect ends with",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("rei@reconnects.example");
        yield* beginIntegrationSignIn(
          userId,
          firstIntegrationAccount(userId, NOTION),
          `state-reconnect-${userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(userId, NOTION, `state-reconnect-${userId}`);
        let named = "Acme";
        const group = yield* standing(NOTION_CONNECTOR, undefined, undefined, {
          names: () => named,
        });
        const labels = Effect.map(
          group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId }),
          ({ body }) => accountsIn(body).map((account) => account.label),
        );
        yield* group.ask(`/api/account/integrations/connect?provider=${NOTION}`, {
          method: "POST",
          userId,
        });

        // The read lands while the browser is still at the provider, choosing another workspace.
        assert.deepEqual(yield* labels, [undefined]);
        const [reconnecting] = yield* readIntegrationConnections(userId);
        named = "Personal";
        yield* completeIntegrationSignIn(userId, NOTION, reconnecting?.state ?? "", named);
        assert.deepEqual(yield* labels, ["Personal"]);
      }),
  );

  it.effect(
    "an account whose grant names nothing is read for a name once, and is called by its place after",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount("pat@unnamed.example");
        yield* beginIntegrationSignIn(
          userId,
          firstIntegrationAccount(userId, NOTION),
          `state-unnamed-${userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(userId, NOTION, `state-unnamed-${userId}`);
        const unnamed = yield* standing(NOTION_CONNECTOR);
        const read = yield* unnamed.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        assert.deepEqual(
          accountsIn(read.body).map((account) => account.label),
          [undefined],
        );
        // Asked once: a grant that names the workspace later is not asked again for it.
        const naming = yield* standing(NOTION_CONNECTOR, undefined, undefined, {
          names: () => "Acme",
        });
        const after = yield* naming.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        assert.deepEqual(
          accountsIn(after.body).map((account) => account.label),
          [undefined],
        );
      }),
  );

  it.effect(
    "a sign-in a read settles answers its grant's name at once, though Connect refuses every read after",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(NOTION_CONNECTOR, undefined, undefined, {
          names: () => "Acme",
          grantsOnce: true,
        });
        const userId = yield* openAccount("ana@settles-once.example");
        yield* group.ask(`/api/account/integrations/connect?provider=${NOTION}`, {
          method: "POST",
          userId,
        });
        const read = yield* group.ask(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS, { userId });
        assert.deepEqual(
          accountsIn(read.body).map((account) => [account.status, account.label]),
          [[INTEGRATION_STATUS.CONNECTED, "Acme"]],
        );
      }),
  );
});
