/**
 * integration-connection.ts -- the one connection per integration every agent of Luke's is handed.
 *
 * The planning assistant, the coding agent, and each one's declared worker
 * are four eve agents, and each is handed this definition for every
 * integration a turn has on (`agent-runtime/connections.ts`), over its
 * provider and that agent's own ownership check, the root's or the
 * delegated one, and nothing else.
 *
 * A connection is the provider's own hosted MCP server, every tool it lists,
 * and no approval: a write runs the moment the model calls it, as the plan
 * decided. Its credential is the account's, read from Vercel Connect under
 * the user id the ownership check admitted, never the session's principal:
 * a spoken planning turn runs as the deployment acting for the account, and
 * eve's own user-scoped auth would refuse it before reading any token. So
 * the auth here is eve's plain `getToken` form, credentialed as the app, and
 * the account is chosen inside it. That form has no interactive half, so
 * eve never parks a turn on a sign-in: sign-in happens in Luke's account
 * settings, before any run.
 *
 * A connection that cannot be used fails only the call that tried it: the
 * token read throws one of the fixed sentences below, which eve reports as
 * that call's error, and every other tool, and the run, carries on. No
 * sentence carries a token, a Connect message, or an HTTP status, because
 * eve reads a status in an error's words as a sign-in to start.
 *
 * eve opens a connection's client once a model step and reuses it for the
 * rest of that step, so the account's row is read at each opening: a
 * Disconnect takes effect from the next step, whatever the SDK cached.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_NAME,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import type { ConversationAdmission } from "@luke/service/agents/brain-host/conversation";
import type { GitHubApp } from "@luke/service/github/github-app";
import {
  accountIntegrationConnect,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
} from "@luke/service/integrations/integration-connect";
import {
  expireIntegrationConnection,
  INTEGRATION_ROW_STATUS,
  readIntegrationConnection,
} from "@luke/service/integrations/integration-store";
import { INTEGRATION, type IntegrationDefinition } from "@luke/service/integrations/integrations";
import { Effect, Redacted, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { defineMcpClientConnection, type McpClientConnectionDefinition } from "eve/connections";
import type { SessionAuth } from "eve/context";
import { GITHUB_GRANT_REFUSAL, githubSignInGrant } from "./github-integration.js";

/** Why a provider's call ran nothing, in words the model can act on and say. */
interface UnavailableSentences {
  readonly NOT_CONNECTED: string;
  readonly EXPIRED: string;
  readonly NOT_CONFIGURED: string;
  readonly UNREACHABLE: string;
  readonly NO_ACCOUNT: string;
}

/** One provider's fixed sentences, which are the whole of what a refused call says. */
export function integrationUnavailable(provider: IntegrationProvider): UnavailableSentences {
  const name = INTEGRATION_NAME[provider];
  const signedIn = INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
  return {
    NOT_CONNECTED: signedIn
      ? `${name} is not connected for this account. The developer can sign in with GitHub in Luke's Settings › Integrations; carry on without it.`
      : `${name} is not connected for this account. The developer can connect it in Luke's Settings › Integrations; carry on without it.`,
    EXPIRED: `${name}'s sign-in for this account has expired. The developer can connect it again in Luke's Settings › Integrations; carry on without it.`,
    NOT_CONFIGURED: `${name} is not set up on this deployment of Luke; carry on without it.`,
    UNREACHABLE: `Luke could not reach ${name}'s sign-in service just now. Try once more later, or carry on without it.`,
    NO_ACCOUNT: `This session stands for no account that can use ${name}.`,
  };
}

/** The credential eve sends the provider: the token in the clear, which is the one place it is. */
interface IntegrationTokenResult {
  readonly token: string;
  readonly expiresAt: number;
}

/** How a host admits the session a connection is opened under: the root's own standing, or a worker's ownership alone. */
export type IntegrationAdmission = Effect.Effect<
  ConversationAdmission,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** What the token read answers: the credential, or the sentence saying why there is none. */
export type IntegrationTokenAnswer = Result.Result<IntegrationTokenResult, string>;

/** The account's GitHub sign-in token for a provider it grants, or the sentence saying why there is none. */
const signedInToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  userId: string,
) {
  const sentences = integrationUnavailable(provider);
  const grant = yield* githubSignInGrant(userId);
  if (Result.isSuccess(grant)) {
    return Result.succeed({
      token: Redacted.value(grant.success.token),
      expiresAt: grant.success.expiresAt,
    });
  }
  switch (grant.failure) {
    case GITHUB_GRANT_REFUSAL.NOT_CONFIGURED:
      return Result.fail(sentences.NOT_CONFIGURED);
    case GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED:
      return Result.fail(sentences.NOT_CONNECTED);
    case GITHUB_GRANT_REFUSAL.UNREACHABLE:
      return Result.fail(sentences.UNREACHABLE);
  }
});

/**
 * The account's token while its row at the provider stands connected; any
 * other row, or none, is why not. A provider the account's own GitHub
 * sign-in grants has no row, and its token is that sign-in's.
 */
const connectedToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  userId: string,
) {
  if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
    return yield* signedInToken(provider, userId);
  }
  const sentences = integrationUnavailable(provider);
  const row = yield* readIntegrationConnection(userId, provider);
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return Result.fail(
      row?.status === INTEGRATION_ROW_STATUS.EXPIRED ? sentences.EXPIRED : sentences.NOT_CONNECTED,
    );
  }
  // A provider not offered to the account answers it as one this deployment never set up.
  const connector = (yield* accountIntegrationConnect(userId))[provider];
  const issued = yield* Effect.result(connector.token(userId, { fresh: false }));
  if (Result.isFailure(issued)) {
    switch (issued.failure.reason) {
      case INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED:
        // Connect holds no grant to use, so the account is told so in settings too.
        yield* expireIntegrationConnection(userId, provider);
        return Result.fail(sentences.EXPIRED);
      case INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED:
        return Result.fail(sentences.NOT_CONFIGURED);
      case INTEGRATION_CONNECT_FAILURE.UNAVAILABLE:
        yield* Effect.logWarning(
          `Vercel Connect gave no ${INTEGRATION_NAME[provider]} token`,
          issued.failure.message,
        );
        return Result.fail(sentences.UNREACHABLE);
    }
  }
  // A Disconnect that landed while Connect answered wins over the token it answered.
  const standing = yield* readIntegrationConnection(userId, provider);
  if (standing?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return Result.fail(sentences.NOT_CONNECTED);
  }
  return Result.succeed({
    token: Redacted.value(issued.success.token),
    expiresAt: issued.success.expiresAt,
  });
});

/**
 * The provider's token for the account the session was admitted for, or
 * the sentence saying why there is none. The account is the admitted
 * caller, the member acting in the conversation, whoever opened it, so a
 * teammate's call runs on the teammate's own grant and never the opener's;
 * a store the read cannot reach fails the call like Connect being
 * unreachable.
 */
export function integrationAccessToken(
  provider: IntegrationProvider,
  admission: IntegrationAdmission,
): Effect.Effect<
  IntegrationTokenAnswer,
  never,
  DatabaseServices | IntegrationConnect | GitHubApp | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) {
      return Result.fail(integrationUnavailable(provider).NO_ACCOUNT);
    }
    return yield* connectedToken(provider, admitted.success.caller);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the ${INTEGRATION_NAME[provider]} connection could not be read: ${causeKind(cause)}`,
        ),
        Result.fail(integrationUnavailable(provider).UNREACHABLE),
      ),
    ),
  );
}

/** How an agent's edge reads one provider's token for one session: its own admission, run where the edge runs effects. */
export type IntegrationTokenRead = (
  auth: SessionAuth,
  sessionId: string,
) => Promise<IntegrationTokenAnswer>;

/**
 * The connection one agent registers for one provider, over the token read
 * its edge composed with that agent's ownership check. The read runs inside
 * eve's turn, given the session the connection is opened under; a refusal is
 * thrown as its sentence, which is the call's error and nothing more.
 */
export function integrationConnection(
  provider: IntegrationProvider,
  read: IntegrationTokenRead,
): McpClientConnectionDefinition {
  const definition: IntegrationDefinition = INTEGRATION[provider];
  return defineMcpClientConnection({
    url: definition.MCP_URL,
    description: definition.DESCRIPTION,
    auth: (ctx) => ({
      credentialOwner: "app",
      getToken: async () => {
        const answer = await read(ctx.session.auth, ctx.session.id);
        if (Result.isFailure(answer)) throw new Error(answer.failure);
        return answer.success;
      },
    }),
  });
}
