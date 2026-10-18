import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { openTaskConversation } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { account } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { INTEGRATION_PROVIDER, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { noNetwork } from "@luke/wire/testing";
import { ConnectError } from "@vercel/connect";
import { eq } from "drizzle-orm";
import { Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { test } from "vitest";
import { CONNECTION_POLICY } from "../agents/agent-runtime/role.js";
import { turnServers } from "../agents/agent-runtime/servers.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_TURN,
} from "../agents/brain-host/bounds.js";
import { type BrainHost, brainHost } from "../agents/brain-host/host.js";
import { GitHubApp } from "../github/github-app.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import {
  GITHUB_APP_SETTINGS,
  openGithubUser,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import {
  CONNECTOR_ASKED_NOTHING,
  firstIntegrationAccount,
  integrationConnectOf,
  integrationConnectOver,
} from "../testing/integration-connect.js";
import {
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
  IntegrationConnectFailure,
  type IntegrationConnectService,
  vercelConnector,
  WorkspaceLinearConnect,
} from "./integration-connect.js";
import {
  type IntegrationAdmission,
  integrationAccessToken,
  integrationConnection,
  integrationUnavailable,
} from "./integration-connection.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
} from "./integration-store.js";
import {
  beginWorkspaceIntegrationSignIn,
  completeWorkspaceIntegrationSignIn,
  deleteWorkspaceIntegration,
} from "./workspace-integration-store.js";

/**
 * The one connection per integration all four agents register, through the
 * token read their edges compose with each agent's own ownership check: the
 * brain's and the coding agent's root admission, and each one's
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
    multipleAccounts: false,
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

/** The brain's host over the test's store; nothing a token read reaches is a seam of its. */
const taskBrainHost = Effect.gen(function* () {
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

/** An account with a task whose conversation a brain session was claimed for, under the seat given. */
const plannedSession = (
  host: BrainHost,
  seat: (userId: string, conversationId: string) => SessionAuth,
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const opened = yield* openTaskConversation(userId, task.id);
    assert.ok(Option.isSome(opened));
    const conversationId = opened.value.conversationId;
    const auth = seat(userId, conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    return { userId, conversationId, auth, sessionId, workspaceId: task.workspaceId };
  });

/** The account connected, as a completed sign-in leaves it. */
const connected = (userId: string) =>
  Effect.gen(function* () {
    yield* beginIntegrationSignIn(
      userId,
      firstIntegrationAccount(userId, LINEAR),
      `state-${userId}`,
      Redacted.make("connect-verifier"),
    );
    assert.equal(yield* completeIntegrationSignIn(userId, LINEAR, `state-${userId}`), true);
  });

/** The token the session reads under the admission given, with Connect holding the grants given. */
const tokenRead = (admission: IntegrationAdmission, grants: Map<string, FakeGrant>) =>
  integrationAccessToken({ provider: LINEAR, connectionName: LINEAR }, admission).pipe(
    Effect.provide(connectLayer(grants)),
  );

/** The test's store, no network, and a deployment holding the GitHub App, which is what GitHub's token is read through. */
const SUITE = Layer.mergeAll(getTestDB(), noNetwork, GitHubApp.layer(GITHUB_APP_SETTINGS));

it.layer(SUITE)("an integration connection's token read", (it) => {
  it.effect(
    "the planning root reads the token of the account the session was admitted for, and never another connected account's",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
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
    "a second account at a provider reads its own grant, under its own subject, and the first reads the first's",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const session = yield* plannedSession(host, typedSeat);
        const subject = `subject-${session.userId}`;
        yield* connected(session.userId);
        yield* beginIntegrationSignIn(
          session.userId,
          { provider: LINEAR, connectionName: "linear-2", connectSubject: subject },
          `state-second-${session.userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(
          session.userId,
          "linear-2",
          `state-second-${session.userId}`,
        );
        const grants = new Map([
          [session.userId, {}],
          [subject, {}],
        ]);
        const read = (connectionName: string) =>
          integrationAccessToken(
            { provider: LINEAR, connectionName },
            host.admit(session.auth, session.sessionId),
          ).pipe(Effect.provide(connectLayer(grants)));

        assert.deepEqual(
          [yield* read(LINEAR), yield* read("linear-2")].map((answer) =>
            Result.isSuccess(answer) ? answer.success.token : answer.failure,
          ),
          [tokenOf(session.userId), tokenOf(subject)],
        );
      }),
  );

  it.effect(
    "a connection handed for one account never reaches another added later under the same name",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const session = yield* plannedSession(host, typedSeat);
        const second = (subject: string) =>
          Effect.gen(function* () {
            yield* beginIntegrationSignIn(
              session.userId,
              { provider: LINEAR, connectionName: "linear-2", connectSubject: subject },
              `state-${subject}`,
              Redacted.make("connect-verifier"),
            );
            yield* completeIntegrationSignIn(session.userId, "linear-2", `state-${subject}`);
          });
        yield* connected(session.userId);
        yield* second("subject-handed");
        const grants = new Map([
          ["subject-handed", {}],
          ["subject-replacing", {}],
        ]);
        const read = integrationAccessToken(
          { provider: LINEAR, connectionName: "linear-2", connectSubject: "subject-handed" },
          host.admit(session.auth, session.sessionId),
        ).pipe(Effect.provide(connectLayer(grants)));

        const before = yield* read;
        yield* deleteIntegrationConnection(session.userId, "linear-2");
        yield* second("subject-replacing");
        const after = yield* read;

        assert.ok(Result.isSuccess(before));
        assert.equal(before.success.token, tokenOf("subject-handed"));
        assert.ok(Result.isFailure(after));
      }),
  );

  it.effect(
    "a member speaking in a plan conversation a teammate opened reads the member's own token, never the opener's",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
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
    "in a plan of a workspace with Linear connected, the Linear token is the workspace's for every member, and the account's own once the workspace disconnects",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const session = yield* plannedSession(host, typedSeat);
        yield* connected(session.userId);
        const state = `workspace-state-${session.workspaceId}`;
        yield* beginWorkspaceIntegrationSignIn(
          session.workspaceId,
          LINEAR,
          session.userId,
          state,
          Redacted.make("connect-verifier"),
        );
        assert.equal(
          yield* completeWorkspaceIntegrationSignIn(session.workspaceId, LINEAR, state),
          true,
        );
        const grants = new Map([
          [session.userId, {}],
          [session.workspaceId, {}],
        ]);
        const admission = host.admit(session.auth, session.sessionId);

        const workspace = yield* tokenRead(admission, grants);
        yield* deleteWorkspaceIntegration(session.workspaceId, LINEAR);
        const own = yield* tokenRead(admission, grants);

        assert.ok(Result.isSuccess(workspace));
        assert.equal(workspace.success.token, tokenOf(session.workspaceId));
        assert.ok(Result.isSuccess(own));
        assert.equal(own.success.token, tokenOf(session.userId));
      }),
  );

  it.effect(
    "in a plan of a workspace with Linear connected, a turn is handed Linear once, on the workspace's grant, and a second account handed before keeps its own",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const session = yield* plannedSession(host, typedSeat);
        const subject = `subject-${session.userId}`;
        yield* connected(session.userId);
        yield* beginIntegrationSignIn(
          session.userId,
          { provider: LINEAR, connectionName: "linear-2", connectSubject: subject },
          `state-second-${session.userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(
          session.userId,
          "linear-2",
          `state-second-${session.userId}`,
        );
        const state = `workspace-state-${session.workspaceId}`;
        yield* beginWorkspaceIntegrationSignIn(
          session.workspaceId,
          LINEAR,
          session.userId,
          state,
          Redacted.make("connect-verifier"),
        );
        yield* completeWorkspaceIntegrationSignIn(session.workspaceId, LINEAR, state);
        const grants = new Map([
          [session.userId, {}],
          [subject, {}],
          [session.workspaceId, {}],
        ]);

        const admission = host.admit(session.auth, session.sessionId);
        const standing = yield* turnServers(admission, CONNECTION_POLICY.ALWAYS_ON).pipe(
          Effect.provide(integrationConnectOver({ LINEAR_CONNECTOR_UID: "oauth/linear" })),
        );
        const tokenOfAccount = (connectionName: string) =>
          Effect.map(
            integrationAccessToken({ provider: LINEAR, connectionName }, admission).pipe(
              Effect.provide(connectLayer(grants)),
            ),
            (answer) => (Result.isSuccess(answer) ? answer.success.token : answer.failure),
          );

        assert.ok(standing.on);
        assert.deepEqual(
          standing.connections
            .filter(({ provider }) => provider === LINEAR)
            .map(({ connectionName, accountNote }) => ({ connectionName, accountNote })),
          [{ connectionName: LINEAR, accountNote: undefined }],
        );
        assert.deepEqual(
          [yield* tokenOfAccount(LINEAR), yield* tokenOfAccount("linear-2")],
          [tokenOf(session.workspaceId), tokenOf(subject)],
        );
      }),
  );

  it.effect(
    "in a plan of a workspace with Linear connected on a deployment naming no workspace connector, the turn's Linear is unreachable, never the member's own grant",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const session = yield* plannedSession(host, typedSeat);
        yield* connected(session.userId);
        const state = `workspace-state-${session.workspaceId}`;
        yield* beginWorkspaceIntegrationSignIn(
          session.workspaceId,
          LINEAR,
          session.userId,
          state,
          Redacted.make("connect-verifier"),
        );
        yield* completeWorkspaceIntegrationSignIn(session.workspaceId, LINEAR, state);
        const grants = new Map([[session.userId, {}]]);
        // SAFETY: one entry per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
        const accounts = Object.fromEntries(
          INTEGRATION_PROVIDER_LIST.map((provider) => [
            provider,
            fakeConnect(provider === LINEAR ? grants : new Map()),
          ]),
        ) as IntegrationConnectService;
        const unconfigured: ConnectorService = {
          ...CONNECTOR_ASKED_NOTHING,
          configured: false,
          token: () =>
            Effect.fail(
              new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED }),
            ),
        };

        const read = yield* integrationAccessToken(
          { provider: LINEAR, connectionName: LINEAR },
          host.admit(session.auth, session.sessionId),
        ).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(IntegrationConnect, accounts),
              Layer.succeed(WorkspaceLinearConnect, unconfigured),
            ),
          ),
        );

        assert.deepEqual(read, Result.fail(LINEAR_UNAVAILABLE.UNREACHABLE));
      }),
  );

  it.effect(
    "a member speaking in a plan conversation a teammate opened is handed the providers offered to the member, by the member's own allowlist",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
        const opened = yield* plannedSession(host, typedSeat);
        const member = yield* openGithubUser();
        yield* joinWorkspace(opened.workspaceId, member);
        const auth = {
          current: typedSeat(member, opened.conversationId).current,
          initiator: opened.auth.initiator,
        };
        // Linear is offered to the member alone, never to the teammate who opened the conversation.
        const standing = yield* turnServers(
          host.admit(auth, opened.sessionId),
          CONNECTION_POLICY.ALWAYS_ON,
        ).pipe(
          Effect.provide(
            integrationConnectOver({
              LINEAR_CONNECTOR_UID: "oauth/linear",
              LINEAR_ALLOWED_ACCOUNTS: `${member}@luke.test`,
            }),
          ),
        );
        assert.ok(standing.on);
        assert.ok(standing.connections.some(({ provider }) => provider === LINEAR));
      }),
  );

  it.effect(
    "Connect unreachable or unconfigured fails the read with a fixed sentence, and nothing it said reaches the log",
    () =>
      Effect.gen(function* () {
        const host = yield* taskBrainHost;
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
          { provider: LINEAR, connectionName: LINEAR },
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
        const host = yield* taskBrainHost;
        const signedIn = yield* plannedSession(host, typedSeat);
        const googleOnly = yield* plannedSession(host, typedSeat);
        const db = yield* Database;
        yield* db.delete(account).where(eq(account.userId, googleOnly.userId));
        const read = (session: { auth: SessionAuth; sessionId: string }) =>
          integrationAccessToken(
            { provider: GITHUB, connectionName: GITHUB },
            host.admit(session.auth, session.sessionId),
          ).pipe(Effect.provide(integrationConnectOf(() => CONNECTOR_ASKED_NOTHING)));

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
    const connection = integrationConnection({ provider }, () =>
      Promise.reject(new Error("no token is read to define a connection")),
    );
    assert.equal(connection.tools, undefined);
  },
);
