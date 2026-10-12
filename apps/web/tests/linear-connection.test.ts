import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { createCodingAgent } from "@sidecar/database/models/coding-agent-store";
import { createPlan, openPlanConversation } from "@sidecar/database/models/plan-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { getTestDB } from "@sidecar/database/testing";
import { ConnectError, UserAuthorizationRequiredError } from "@vercel/connect";
import { Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SessionAuth, SessionAuthContext, SessionContext } from "eve/context";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import {
  LINEAR_CONNECT_FAILURE,
  LinearConnect,
  LinearConnectFailure,
  type LinearConnectService,
  vercelLinearConnect,
} from "../server/hosted/linear-connect";
import {
  LINEAR_MCP,
  LINEAR_UNAVAILABLE,
  type LinearAdmission,
  linearAccessToken,
  linearConnection,
} from "../server/hosted/linear-connection";
import {
  beginLinearSignIn,
  completeLinearSignIn,
  deleteLinearConnection,
  LINEAR_ROW_STATUS,
  readLinearConnection,
} from "../server/hosted/linear-store";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";

/**
 * The one Linear connection all four agents register, through the token
 * read their edges compose with each agent's own ownership check: the
 * planning model's and the coding agent's root admission, and each one's
 * worker's delegated admission. The store and both hosts are the real ones
 * over the migrations on PGlite; Vercel Connect is the one double, a
 * `LinearConnect` that holds a token per account. Every token a test reads
 * back names the account it was issued for, so a read that reached another
 * account's grant fails by its value.
 */

const NOW = 1_800_000_000_000;

/** A token Connect issues an account, which names it, so a read can tell whose it got. */
function tokenOf(userId: string): string {
  return `lin_oauth_${userId}`;
}

/** What the fake Connect does for one account: issue its token, refuse with a word, or run something first. */
interface FakeGrant {
  readonly refuse?: LinearConnectFailure;
  /** Runs while Connect answers, the way a Disconnect pressed meanwhile lands. */
  readonly meanwhile?: Effect.Effect<void, never, never>;
}

/** Vercel Connect, holding a grant for every account the test named and none for any other. */
function fakeConnect(grants: Map<string, FakeGrant>): LinearConnectService {
  return {
    configured: true,
    authorize: () => Effect.succeed("https://vercel.com/connect/authorize/fixture"),
    token: (userId) =>
      Effect.gen(function* () {
        const grant = grants.get(userId);
        if (grant === undefined) {
          return yield* new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED });
        }
        if (grant.meanwhile !== undefined) yield* grant.meanwhile;
        if (grant.refuse !== undefined) return yield* grant.refuse;
        return { token: Redacted.make(tokenOf(userId)), expiresAt: NOW + 3_600_000 };
      }),
    revoke: () => Effect.void,
  };
}

function connectLayer(grants: Map<string, FakeGrant>): Layer.Layer<LinearConnect> {
  return Layer.succeed(LinearConnect, fakeConnect(grants));
}

/** The planning host over the test's store; nothing a token read reaches is a seam of its. */
const planningHost = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
  return brainHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      sessionOwner: () => Promise.resolve(undefined),
      ownsConversation: () => Promise.resolve(false),
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

/** The coding-agent host over the test's store. */
const codingHost = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  return coderHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      sessionOwner: () => Promise.resolve(undefined),
      ownsConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => undefined,
    keys: () => Effect.succeed({ anthropic: undefined, openAi: undefined }),
    titleModel: () => undefined,
    scriptedModel: () => false,
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

/** The deployment carrying a spoken turn for the account it names: a service principal, never the account's own. */
function spokenSeat(account: string, conversationId: string): SessionAuth {
  return seatFor({
    principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: account,
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.SPOKEN,
    },
  });
}

/** A worker's session as eve opens it: the parent's auth, a session of its own, and the call that made it. */
function childSession(auth: SessionAuth, rootSessionId: string): SessionContext["session"] {
  const turn = { id: "turn_0", sequence: 0 };
  return {
    id: mintSession(),
    auth,
    turn,
    parent: { callId: "call-1", rootSessionId, sessionId: rootSessionId, turn },
  };
}

/** An account with a plan whose conversation a planning session was claimed for, under the seat given. */
const plannedSession = (
  host: BrainHost,
  seat: (userId: string, conversationId: string) => SessionAuth,
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, { name: "Teammate invitations" });
    const opened = yield* openPlanConversation(userId, plan.id);
    assert.ok(Option.isSome(opened));
    const conversationId = opened.value;
    const auth = seat(userId, conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    return { userId, conversationId, auth, sessionId };
  });

/** An account with a coding agent whose session was claimed as the coder's hook claims it. */
const codingSession = (host: CoderHost) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: `start-${mintSession()}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      task: null,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const auth = typedSeat(userId, started.value.agent.conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    return { userId, auth, sessionId };
  });

/** The account connected, as a completed sign-in leaves it. */
const connected = (userId: string) =>
  Effect.gen(function* () {
    yield* beginLinearSignIn(userId, `state-${userId}`);
    assert.equal(yield* completeLinearSignIn(userId), true);
  });

/** The token the session reads under the admission given, with Connect holding the grants given. */
const tokenRead = (admission: LinearAdmission, grants: Map<string, FakeGrant>) =>
  linearAccessToken(admission).pipe(Effect.provide(connectLayer(grants)));

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the Linear connection's token read", (it) => {
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
    "a spoken turn the deployment carries for an account reads that account's token, though its principal is the deployment's",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const spoken = yield* plannedSession(host, spokenSeat);
        const other = yield* plannedSession(host, typedSeat);
        yield* connected(spoken.userId);
        yield* connected(other.userId);
        const grants = new Map([
          [spoken.userId, {}],
          [other.userId, {}],
        ]);

        const read = yield* tokenRead(host.admit(spoken.auth, spoken.sessionId), grants);
        assert.ok(Result.isSuccess(read));
        assert.equal(read.success.token, tokenOf(spoken.userId));
        // The deployment naming another account on this conversation is admitted for none.
        const misnamed = spokenSeat(other.userId, spoken.conversationId);
        assert.deepEqual(
          yield* tokenRead(host.admit(misnamed, spoken.sessionId), grants),
          Result.fail(LINEAR_UNAVAILABLE.NO_ACCOUNT),
        );
      }),
  );

  it.effect("the planning worker reads its owner's token under its ownership check alone", () =>
    Effect.gen(function* () {
      const host = yield* planningHost;
      const root = yield* plannedSession(host, spokenSeat);
      yield* connected(root.userId);
      const child = childSession(root.auth, root.sessionId);

      const read = yield* tokenRead(
        host.admitDelegated(child.auth, child.id),
        new Map([[root.userId, {}]]),
      );
      assert.ok(Result.isSuccess(read));
      assert.equal(read.success.token, tokenOf(root.userId));
      // The root's own check refuses the worker's session, which is why the worker registers its own.
      assert.deepEqual(
        yield* tokenRead(host.admit(child.auth, child.id), new Map([[root.userId, {}]])),
        Result.fail(LINEAR_UNAVAILABLE.NO_ACCOUNT),
      );
    }),
  );

  it.effect("the coding agent and its worker each read their owner's token", () =>
    Effect.gen(function* () {
      const host = yield* codingHost;
      const agent = yield* codingSession(host);
      yield* connected(agent.userId);
      const grants = new Map([[agent.userId, {}]]);

      const rootRead = yield* tokenRead(host.admit(agent.auth, agent.sessionId), grants);
      assert.ok(Result.isSuccess(rootRead));
      assert.equal(rootRead.success.token, tokenOf(agent.userId));
      const child = childSession(agent.auth, agent.sessionId);
      const workerRead = yield* tokenRead(host.admitDelegated(child.auth, child.id), grants);
      assert.ok(Result.isSuccess(workerRead));
      assert.equal(workerRead.success.token, tokenOf(agent.userId));
    }),
  );

  it.effect(
    "an account never connected, one mid-sign-in, and one disconnected read why not, while Connect still holds a grant",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const session = yield* plannedSession(host, typedSeat);
        const grants = new Map([[session.userId, {}]]);
        const read = () => tokenRead(host.admit(session.auth, session.sessionId), grants);

        assert.deepEqual(yield* read(), Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED));
        yield* beginLinearSignIn(session.userId, "state-first");
        assert.deepEqual(yield* read(), Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED));
        yield* completeLinearSignIn(session.userId);
        assert.ok(Result.isSuccess(yield* read()));
        // Signing in again keeps the account connected while the new sign-in is under way.
        yield* beginLinearSignIn(session.userId, "state-again");
        assert.ok(Result.isSuccess(yield* read()));
        yield* deleteLinearConnection(session.userId);
        assert.deepEqual(yield* read(), Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED));
      }),
  );

  it.effect(
    "a grant Connect no longer holds reads as expired, and the account's row says so until it connects again",
    () =>
      Effect.gen(function* () {
        const host = yield* planningHost;
        const session = yield* plannedSession(host, typedSeat);
        yield* connected(session.userId);
        const read = (grants: Map<string, FakeGrant>) =>
          tokenRead(host.admit(session.auth, session.sessionId), grants);

        assert.deepEqual(yield* read(new Map()), Result.fail(LINEAR_UNAVAILABLE.EXPIRED));
        assert.equal(
          (yield* readLinearConnection(session.userId))?.status,
          LINEAR_ROW_STATUS.EXPIRED,
        );
        // Connect holding a grant again is not enough: the account connects again first.
        const grants = new Map([[session.userId, {}]]);
        assert.deepEqual(yield* read(grants), Result.fail(LINEAR_UNAVAILABLE.EXPIRED));
        yield* connected(session.userId);
        assert.ok(Result.isSuccess(yield* read(grants)));
      }),
  );

  it.effect("a Disconnect that lands while Connect answers wins over the token it answered", () =>
    Effect.gen(function* () {
      const host = yield* planningHost;
      const session = yield* plannedSession(host, typedSeat);
      yield* connected(session.userId);
      const client = yield* SqlClient.SqlClient;
      const disconnecting = deleteLinearConnection(session.userId).pipe(
        Effect.provideService(SqlClient.SqlClient, client),
        Effect.orDie,
      );

      assert.deepEqual(
        yield* tokenRead(
          host.admit(session.auth, session.sessionId),
          new Map([[session.userId, { meanwhile: disconnecting }]]),
        ),
        Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED),
      );
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
        const leaking = vercelLinearConnect("oauth/linear", {
          startAuthorization: () => Promise.reject(new Error(secret)),
          getTokenResponse: () =>
            Promise.reject(new ConnectError(`upstream said Bearer ${secret}`, { status: 502 })),
          revokeToken: () => Promise.reject(new Error(secret)),
        });
        const logged: string[] = [];
        const capture = Logger.make((options) => {
          logged.push(JSON.stringify(options.message), String(options.cause));
        });

        const unreachable = yield* linearAccessToken(
          host.admit(session.auth, session.sessionId),
        ).pipe(
          Effect.provide(Layer.succeed(LinearConnect, leaking)),
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
                refuse: new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.NOT_CONFIGURED }),
              },
            ],
          ]),
        );
        assert.deepEqual(unconfigured, Result.fail(LINEAR_UNAVAILABLE.NOT_CONFIGURED));
      }),
  );
});

it.effect(
  "Connect's own refusals are read as their words, keeping only Connect's code and status",
  () =>
    Effect.gen(function* () {
      const secret = "sk-connect-leaked-0123456789abcdef0123456789";
      const connect = vercelLinearConnect("oauth/linear", {
        startAuthorization: () =>
          Promise.resolve({
            request: "r",
            verifier: "v",
            url: "http://insecure.example/authorize",
          }),
        getTokenResponse: () =>
          Promise.reject(
            new UserAuthorizationRequiredError(secret, {
              code: "user_authorization_required",
              status: 401,
            }),
          ),
        revokeToken: () => Promise.reject(new ConnectError(secret, { code: `token=${secret}` })),
      });

      const token = yield* Effect.flip(connect.token("user-1", { fresh: true }));
      assert.equal(token.reason, LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED);
      assert.equal(
        token.message,
        "Vercel Connect answered not-authorized user_authorization_required 401",
      );
      const revoke = yield* Effect.flip(connect.revoke("user-1"));
      assert.equal(revoke.reason, LINEAR_CONNECT_FAILURE.UNAVAILABLE);
      assert.ok(!revoke.message.includes(secret));
      // A sign-in address a browser should not be sent to is no address at all.
      const authorize = yield* Effect.flip(
        connect.authorize("user-1", "https://luke.test/callback"),
      );
      assert.equal(authorize.reason, LINEAR_CONNECT_FAILURE.UNAVAILABLE);
    }),
);

/** The provider eve resolves for one session, as the definition's resolver hands it over. */
async function providerFor(read: Parameters<typeof linearConnection>[0]) {
  const definition = linearConnection(read);
  if (!(definition.auth instanceof Function)) throw new Error("the auth is no resolver");
  const session: SessionContext["session"] = {
    id: "wrun_01LINEARPROVIDER0000000000",
    auth: typedSeat("user-1", "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f"),
    turn: { id: "turn_0", sequence: 0 },
  };
  // SAFETY: the resolver reads the session alone; the rest of eve's context is not its to read.
  return { definition, provider: await definition.auth({ session } as SessionContext) };
}

it("the connection is Linear's hosted server, credentialed as the app with no sign-in of eve's, and fails only the call with a fixed sentence", async () => {
  const { definition, provider } = await providerFor(() =>
    Promise.resolve(Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED)),
  );
  assert.equal(definition.url, LINEAR_MCP.URL);
  assert.equal(definition.url, "https://mcp.linear.app/mcp");
  assert.equal(definition.tools, undefined);
  assert.equal(definition.approval, undefined);
  assert.equal("credentialOwner" in provider ? provider.credentialOwner : undefined, "app");
  assert.equal("startAuthorization" in provider, false);
  if (provider.getToken === undefined) throw new Error("the provider reads no token");
  await assert.rejects(
    provider.getToken({ principal: { type: "app" }, connection: { url: LINEAR_MCP.URL } }),
    new Error(LINEAR_UNAVAILABLE.NOT_CONNECTED),
  );

  const granted = await providerFor((auth, sessionId) => {
    assert.equal(sessionId, "wrun_01LINEARPROVIDER0000000000");
    assert.equal(auth.current?.principalId, "user-1");
    return Promise.resolve(Result.succeed({ token: "lin_oauth_user-1", expiresAt: NOW }));
  });
  if (granted.provider.getToken === undefined) throw new Error("the provider reads no token");
  assert.deepEqual(
    await granted.provider.getToken({
      principal: { type: "app" },
      connection: { url: LINEAR_MCP.URL },
    }),
    { token: "lin_oauth_user-1", expiresAt: NOW },
  );
});
