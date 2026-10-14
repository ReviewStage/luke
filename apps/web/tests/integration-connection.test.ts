import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { openPlanConversation } from "@luke/database/models/plan-store";
import { storeWriter } from "@luke/database/models/writer";
import { account } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { INTEGRATION_PROVIDER, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { ConnectError } from "@vercel/connect";
import { eq } from "drizzle-orm";
import { Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { test } from "vitest";
import { GitHubApp } from "../server/github/github-app";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnectFailure,
  vercelConnector,
} from "../server/hosted/integration-connect";
import {
  type IntegrationAdmission,
  integrationAccessToken,
  integrationConnection,
  integrationUnavailable,
} from "../server/hosted/integration-connection";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
} from "../server/hosted/integration-store";
import { GITHUB_APP_SETTINGS, openGithubUser, standingGithubRow } from "./support/github-app-fake";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "./support/integration-connect";
import { noNetwork } from "./support/no-network";
import { joinWorkspace, startPlan } from "./support/workspaces";

/**
 * The one connection per integration all four agents register, through the
 * token read their edges compose with each agent's own ownership check: the
 * planning model's and the coding agent's root admission, and each one's
 * worker's delegated admission. Linear stands for every provider. The store
 * and both hosts are the real ones over the migrations on PGlite; Vercel
 * Connect is the one double, a connector that holds a token per account.
 * Every token a test reads back names the account it was issued for, so a
 * read that reached another account's grant fails by its value. Every
 * provider's connection offers the agents every tool its server lists, the
 * ones that write among them, with no filter of Luke's.
 */

const NOW = 1_800_000_000_000;
const GITHUB = INTEGRATION_PROVIDER.GITHUB;
const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const LINEAR_UNAVAILABLE = integrationUnavailable(LINEAR);

/** A token Connect issues an account, which names it, so a read can tell whose it got. */
function tokenOf(userId: string): string {
  return `lin_oauth_${userId}`;
}

/** What the fake Connect does for one account: issue its token, refuse with a word, or run something first. */
interface FakeGrant {
  readonly refuse?: IntegrationConnectFailure;
  /** Runs while Connect answers, the way a Disconnect pressed meanwhile lands. */
  readonly meanwhile?: Effect.Effect<void, never, never>;
}

/** Vercel Connect, holding a grant for every account the test named and none for any other. */
function fakeConnect(grants: Map<string, FakeGrant>): ConnectorService {
  return {
    configured: true,
    authorize: () =>
      Effect.succeed({
        url: "https://vercel.com/connect/authorize/fixture",
        verifier: Redacted.make("connect-verifier"),
      }),
    signInResult: () => Effect.die(new Error("this suite never asks how a sign-in stands")),
    token: (userId) =>
      Effect.gen(function* () {
        const grant = grants.get(userId);
        if (grant === undefined) {
          return yield* new IntegrationConnectFailure({
            reason: INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED,
          });
        }
        if (grant.meanwhile !== undefined) yield* grant.meanwhile;
        if (grant.refuse !== undefined) return yield* grant.refuse;
        return { token: Redacted.make(tokenOf(userId)), expiresAt: NOW + 3_600_000 };
      }),
    revoke: () => Effect.void,
  };
}

/** Connect holding the grants for Linear, and none at any other provider. */
function connectLayer(grants: Map<string, FakeGrant>) {
  return integrationConnectOf((provider) => fakeConnect(provider === LINEAR ? grants : new Map()));
}

/** The planning host over the test's store; nothing a token read reaches is a seam of its. */
const planningHost = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
  return brainHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      reachesSession: () => Promise.resolve(false),
      reachesConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => undefined,
    eveOrigin: () => undefined,
    openAi: () => undefined,
    titleModel: () => undefined,
    scriptedModel: () => false,
    spend: () => {
      throw new Error("no token read spends");
    },
    now: () => NOW,
  });
});

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01L${String(minted).padStart(22, "0")}`;
}

function seatFor(principal: SessionAuthContext): SessionAuth {
  return { current: principal, initiator: principal };
}

/** The developer typing in their own conversation. */
function typedSeat(userId: string, conversationId: string): SessionAuth {
  return seatFor({
    principalId: userId,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  });
}

/** An account with a plan whose conversation a planning session was claimed for, under the seat given. */
const plannedSession = (
  host: BrainHost,
  seat: (userId: string, conversationId: string) => SessionAuth,
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* startPlan(userId, { name: "Teammate invitations" });
    const opened = yield* openPlanConversation(userId, plan.id);
    assert.ok(Option.isSome(opened));
    const conversationId = opened.value.conversationId;
    const auth = seat(userId, conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    return { userId, conversationId, auth, sessionId, workspaceId: plan.workspaceId };
  });

/** The account connected, as a completed sign-in leaves it. */
const connected = (userId: string) =>
  Effect.gen(function* () {
    yield* beginIntegrationSignIn(
      userId,
      LINEAR,
      `state-${userId}`,
      Redacted.make("connect-verifier"),
    );
    assert.equal(yield* completeIntegrationSignIn(userId, LINEAR, `state-${userId}`), true);
  });

/** The token the session reads under the admission given, with Connect holding the grants given. */
const tokenRead = (admission: IntegrationAdmission, grants: Map<string, FakeGrant>) =>
  integrationAccessToken(LINEAR, admission).pipe(Effect.provide(connectLayer(grants)));

/** The test's store, no network, and a deployment holding the GitHub App, which is what GitHub's token is read through. */
const SUITE = Layer.mergeAll(getTestDB(), noNetwork, GitHubApp.layer(GITHUB_APP_SETTINGS));

it.layer(SUITE)("an integration connection's token read", (it) => {
  it.effect(
    "the planning root reads the token of the account the session was admitted for, and never another connected account's",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const mine = yield* plannedSession(host, typedSeat);
        const theirs = yield* plannedSession(host, typedSeat);
        yield* connected(mine.userId);
        yield* connected(theirs.userId);
        const grants = new Map([
          [mine.userId, {}],
          [theirs.userId, {}],
        ]);

        const read = yield* tokenRead(host.admit(mine.auth, mine.sessionId), grants);
        assert.ok(Result.isSuccess(read));
        assert.equal(read.success.token, tokenOf(mine.userId));
        // A session over another account's conversation is admitted for no account at all.
        const crossed = typedSeat(mine.userId, theirs.conversationId);
        assert.deepEqual(
          yield* tokenRead(host.admit(crossed, theirs.sessionId), grants),
          Result.fail(LINEAR_UNAVAILABLE.NO_ACCOUNT),
        );
      }),
  );

  it.effect(
    "a member speaking in a plan conversation a teammate opened reads the member's own token, never the opener's",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const opened = yield* plannedSession(host, typedSeat);
        const member = yield* openGithubUser();
        yield* joinWorkspace(opened.workspaceId, member);
        yield* connected(opened.userId);
        yield* connected(member);
        const grants = new Map([
          [opened.userId, {}],
          [member, {}],
        ]);
        // The member speaks into the session the opener started, under the member's own principal.
        const auth = {
          current: typedSeat(member, opened.conversationId).current,
          initiator: opened.auth.initiator,
        };

        const read = yield* tokenRead(host.admit(auth, opened.sessionId), grants);
        assert.ok(Result.isSuccess(read));
        assert.equal(read.success.token, tokenOf(member));
      }),
  );

  it.effect(
    "Connect unreachable or unconfigured fails the read with a fixed sentence, and nothing it said reaches the log",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const session = yield* plannedSession(host, typedSeat);
        yield* connected(session.userId);
        const secret = "lin_oauth_leaked_bearer_1234567890abcdef";
        // Connect's own words carry a credential; the service keeps its code and status alone.
        const leaking = vercelConnector("oauth/linear", {
          startAuthorization: () => Promise.reject(new Error(secret)),
          getTokenResponse: () =>
            Promise.reject(new ConnectError(`upstream said Bearer ${secret}`, { status: 502 })),
          revokeToken: () => Promise.reject(new Error(secret)),
          readAuthorizationResult: () => Promise.reject(new Error(secret)),
        });
        const logged: string[] = [];
        const capture = Logger.make((options) => {
          logged.push(JSON.stringify(options.message), String(options.cause));
        });

        const unreachable = yield* integrationAccessToken(
          LINEAR,
          host.admit(session.auth, session.sessionId),
        ).pipe(
          Effect.provide(integrationConnectOf(() => leaking)),
          Effect.provide(Logger.layer([capture])),
        );
        assert.deepEqual(unreachable, Result.fail(LINEAR_UNAVAILABLE.UNREACHABLE));
        assert.ok(logged.length > 0);
        for (const line of logged) assert.ok(!line.includes(secret), line);

        const unconfigured = yield* tokenRead(
          host.admit(session.auth, session.sessionId),
          new Map([
            [
              session.userId,
              {
                refuse: new IntegrationConnectFailure({
                  reason: INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED,
                }),
              },
            ],
          ]),
        );
        assert.deepEqual(unconfigured, Result.fail(LINEAR_UNAVAILABLE.NOT_CONFIGURED));
      }),
  );

  it.effect(
    "GitHub's token is the account's own GitHub sign-in token, asked of no connector, and an account that never signed in with GitHub is told to sign in with GitHub",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const signedIn = yield* plannedSession(host, typedSeat);
        const googleOnly = yield* plannedSession(host, typedSeat);
        const db = yield* Database;
        yield* db.delete(account).where(eq(account.userId, googleOnly.userId));
        const read = (session: { auth: SessionAuth; sessionId: string }) =>
          integrationAccessToken(GITHUB, host.admit(session.auth, session.sessionId)).pipe(
            Effect.provide(integrationConnectOf(() => CONNECTOR_ASKED_NOTHING)),
          );

        const token = yield* read(signedIn);
        assert.ok(Result.isSuccess(token));
        assert.equal(token.success.token, standingGithubRow(NOW).accessToken);
        const refused = yield* read(googleOnly);
        assert.ok(Result.isFailure(refused));
        assert.match(refused.failure, /sign in with GitHub/u);
      }),
  );
});

test.for(INTEGRATION_PROVIDER_LIST)(
  "%s's connection offers every tool its server lists, the ones that write among them",
  (provider) => {
    const connection = integrationConnection(provider, () =>
      Promise.reject(new Error("no token is read to define a connection")),
    );
    assert.equal(connection.tools, undefined);
  },
);
