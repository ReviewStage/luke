/**
 * integration-token.ts -- one account's token at an integration, read for the member acting in a conversation, and the fixed sentences that say why there is none.
 *
 * Every runtime reads an integration's credential here: eve's connection
 * (`integration-connection.ts`) and the door a native harness reaches over
 * Luke's MCP server (`connection-door.ts`) alike, so nothing here imports
 * eve. The credential is the account's, read from Vercel Connect under the
 * user id the admission names as the caller, never a session's principal.
 *
 * A connection that cannot be used fails only the call that tried it: the
 * read answers one of the fixed sentences below. No sentence carries a
 * token, a Connect message, or an HTTP status, because eve reads a status
 * in an error's words as a sign-in to start.
 *
 * A read is two steps: the grant the token would be read on, from the store
 * alone (`integrationGrant`), and the token on it, asked of Connect only
 * then (`grantAccessToken`), so a caller that needs only to know a
 * connection stands, such as a native agent's listing of its tools, asks
 * Connect nothing.
 *
 * Linear is the one provider a workspace may connect for every member
 * (`linear-issues.ts`): where the conversation's plan or coding agent
 * belongs to a workspace whose Linear stands connected, every member's
 * Linear tools run on that grant, and an account's own is read only where
 * the workspace has none. An account past the first a turn was handed
 * before the workspace connected keeps its own grant, so a call that names
 * it never lands in the workspace's Linear.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import { Effect, Redacted, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { ConversationAdmission } from "../agents/brain-host/conversation.js";
import type { GitHubApp } from "../github/github-app.js";
import { GITHUB_GRANT_REFUSAL, githubSignInGrant } from "./github-integration.js";
import {
  accountIntegrationConnect,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "./integration-connect.js";
import { expireIntegrationConnection, readIntegrationConnection } from "./integration-store.js";
import { LINEAR_READ_FAILURE, workspaceLinearToken } from "./linear-issues.js";
import {
  readConversationWorkspace,
  readWorkspaceIntegration,
} from "./workspace-integration-store.js";

/** Why a provider's call ran nothing, in words the model can act on and say. */
interface UnavailableSentences {
  readonly NOT_CONNECTED: string;
  readonly EXPIRED: string;
  readonly NOT_CONFIGURED: string;
  readonly UNREACHABLE: string;
  readonly NO_ACCOUNT: string;
  readonly WORKSPACE_EXPIRED: string;
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
    WORKSPACE_EXPIRED: `The workspace's ${name} connection has expired. An owner or admin can connect it again in Luke's Settings › Workspace › Workspace connections; carry on without it.`,
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

/** One account at a provider a connection reads the token of: the provider, and the name the account goes by. */
export interface IntegrationAccountRef {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  /** The subject the account's grant stood under when the connection was handed, where it was; a row under another is an account the connection never meant. */
  readonly connectSubject?: string;
}

/** Whose grant a connection's token is read on. */
export const INTEGRATION_GRANT_HOLDER = {
  /** The member's own account at the provider, held by Connect under the row's subject. */
  ACCOUNT: "account",
  /** The workspace's own grant, held by Connect under the workspace's id. */
  WORKSPACE: "workspace",
  /** The member's GitHub sign-in, which Connect holds nothing of. */
  SIGN_IN: "sign-in",
} as const;

/** The grant a connection's token is read on, as the store names it: reading it asks Connect nothing. */
export type IntegrationGrantRef =
  | {
      readonly holder: typeof INTEGRATION_GRANT_HOLDER.ACCOUNT;
      readonly provider: IntegrationProvider;
      readonly userId: string;
      readonly connectionName: string;
      readonly connectSubject: string;
    }
  | {
      readonly holder: typeof INTEGRATION_GRANT_HOLDER.WORKSPACE;
      readonly provider: IntegrationProvider;
      readonly organizationId: string;
    }
  | {
      readonly holder: typeof INTEGRATION_GRANT_HOLDER.SIGN_IN;
      readonly provider: IntegrationProvider;
      readonly userId: string;
    };

/** What the grant read answers: the grant a token would be read on, or the sentence saying why there is none. */
export type IntegrationGrantAnswer = Result.Result<IntegrationGrantRef, string>;

/** What the reads here run against. */
type IntegrationTokenServices =
  | DatabaseServices
  | IntegrationConnect
  | WorkspaceLinearConnect
  | GitHubApp
  | HttpClient.HttpClient;

/**
 * The workspace's Linear grant for the conversation, where its plan or
 * coding agent belongs to a workspace whose Linear stands connected, or the
 * sentence saying it expired; nothing where the workspace has no Linear of
 * its own, so the account's own is read.
 */
const workspaceGrant = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  conversationId: string,
) {
  if (provider !== INTEGRATION_PROVIDER.LINEAR) return undefined;
  const organizationId = yield* readConversationWorkspace(conversationId);
  if (organizationId === undefined) return undefined;
  const row = yield* readWorkspaceIntegration(organizationId, provider);
  if (row?.status === INTEGRATION_ROW_STATUS.EXPIRED) {
    return Result.fail(integrationUnavailable(provider).WORKSPACE_EXPIRED);
  }
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) return undefined;
  return Result.succeed<IntegrationGrantRef>({
    holder: INTEGRATION_GRANT_HOLDER.WORKSPACE,
    provider,
    organizationId,
  });
});

/**
 * The grant the account's token is read on, from the store alone: the
 * account's while its row stands connected under the subject the
 * connection was handed for, and offered to the account; any other row, or
 * none, is why not. Note that a name a disconnected account went by can be
 * taken by one added after it, so a turn handed the first never reaches the
 * second through the name. A provider the account's own GitHub sign-in
 * grants has no row, and its grant is that sign-in.
 */
const accountGrant = /* @__PURE__ */ Effect.fnUntraced(function* (
  { provider, connectionName, connectSubject }: IntegrationAccountRef,
  userId: string,
) {
  if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
    return Result.succeed<IntegrationGrantRef>({
      holder: INTEGRATION_GRANT_HOLDER.SIGN_IN,
      provider,
      userId,
    });
  }
  const sentences = integrationUnavailable(provider);
  const read = yield* readIntegrationConnection(userId, connectionName);
  const row =
    connectSubject === undefined || read?.connectSubject === connectSubject ? read : undefined;
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return Result.fail(
      row?.status === INTEGRATION_ROW_STATUS.EXPIRED ? sentences.EXPIRED : sentences.NOT_CONNECTED,
    );
  }
  // A provider not offered to the account answers it as one this deployment never set up.
  if (!(yield* accountIntegrationConnect(userId))[provider].configured) {
    return Result.fail(sentences.NOT_CONFIGURED);
  }
  return Result.succeed<IntegrationGrantRef>({
    holder: INTEGRATION_GRANT_HOLDER.ACCOUNT,
    provider,
    userId,
    connectionName,
    connectSubject: row.connectSubject,
  });
});

/**
 * The account's token on its own grant, asked of Connect now, or why there
 * is none. Note that a Disconnect that landed while Connect answered wins
 * over the token it answered.
 */
const accountToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  grant: Extract<IntegrationGrantRef, { holder: typeof INTEGRATION_GRANT_HOLDER.ACCOUNT }>,
) {
  const { provider, userId, connectionName, connectSubject } = grant;
  const sentences = integrationUnavailable(provider);
  const connector = (yield* accountIntegrationConnect(userId))[provider];
  const issued = yield* Effect.result(connector.token(connectSubject, { fresh: false }));
  if (Result.isFailure(issued)) {
    switch (issued.failure.reason) {
      case INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED:
        // Connect holds no grant to use, so the account is told so in settings too.
        yield* expireIntegrationConnection(userId, connectionName);
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
  const standing = yield* readIntegrationConnection(userId, connectionName);
  if (
    standing?.status !== INTEGRATION_ROW_STATUS.CONNECTED ||
    standing.connectSubject !== connectSubject
  ) {
    return Result.fail(sentences.NOT_CONNECTED);
  }
  return Result.succeed({
    token: Redacted.value(issued.success.token),
    expiresAt: issued.success.expiresAt,
  });
});

/** The workspace's Linear token on its grant, or the sentence saying why that grant could not be used. */
const workspaceToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  organizationId: string,
) {
  const read = yield* workspaceLinearToken(organizationId);
  if (Result.isSuccess(read)) {
    return Result.succeed({
      token: Redacted.value(read.success.token),
      expiresAt: read.success.expiresAt,
    });
  }
  const sentences = integrationUnavailable(provider);
  switch (read.failure) {
    case LINEAR_READ_FAILURE.EXPIRED:
      return Result.fail(sentences.WORKSPACE_EXPIRED);
    case LINEAR_READ_FAILURE.NOT_CONNECTED:
      return Result.fail(sentences.NOT_CONNECTED);
    default:
      return Result.fail(sentences.UNREACHABLE);
  }
});

/** Any read here failed with its sentence for unreachable, and one log line naming the failure's kind. */
function orUnreachable<A>(
  provider: IntegrationProvider,
  read: Effect.Effect<Result.Result<A, string>, unknown, IntegrationTokenServices>,
): Effect.Effect<Result.Result<A, string>, never, IntegrationTokenServices> {
  return read.pipe(
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

/**
 * The grant one account's token would be read on for the Luke account the
 * session was admitted for, or the sentence saying why there is none, read
 * from the store alone so it asks Connect nothing. The Luke account is the
 * admitted caller, the member acting in the conversation, whoever opened
 * it, so a teammate's call runs on the teammate's own grant under the same
 * connection name, never the opener's. Linear is the one provider a
 * workspace may connect for every member: where the conversation belongs to
 * a workspace whose Linear stands connected, the provider's own name runs on
 * that grant.
 */
export function integrationGrant(
  account: IntegrationAccountRef,
  admission: IntegrationAdmission,
): Effect.Effect<IntegrationGrantAnswer, never, IntegrationTokenServices> {
  const { provider } = account;
  return orUnreachable(
    provider,
    Effect.gen(function* () {
      const admitted = yield* admission;
      if (Result.isFailure(admitted)) {
        return Result.fail(integrationUnavailable(provider).NO_ACCOUNT);
      }
      // Note that the workspace's grant answers the provider's own name alone, so an account past the first a turn was handed keeps its own.
      const workspace =
        account.connectionName === provider
          ? yield* workspaceGrant(provider, admitted.success.target.conversationId)
          : undefined;
      if (workspace !== undefined) return workspace;
      return yield* accountGrant(account, admitted.success.caller);
    }),
  );
}

/** The token on one grant, asked for now, or the sentence saying why there is none; a store the read cannot reach fails it like Connect being unreachable. */
export function grantAccessToken(
  grant: IntegrationGrantRef,
): Effect.Effect<IntegrationTokenAnswer, never, IntegrationTokenServices> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return orUnreachable(grant.provider, accountToken(grant));
    case INTEGRATION_GRANT_HOLDER.WORKSPACE:
      return orUnreachable(grant.provider, workspaceToken(grant.provider, grant.organizationId));
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return orUnreachable(grant.provider, signedInToken(grant.provider, grant.userId));
  }
}

/**
 * Drops the grant's token from Connect's in-process cache, where Connect
 * holds the grant, so the next read asks Connect again: what a caller does
 * once the provider refused the token, as Connect's docs say, rather than
 * forcing a refresh on every read. A GitHub sign-in's token is not Connect's,
 * so nothing is dropped for it.
 */
export function evictGrantToken(
  grant: IntegrationGrantRef,
): Effect.Effect<void, never, IntegrationConnect | WorkspaceLinearConnect> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return Effect.gen(function* () {
        yield* (yield* IntegrationConnect)[grant.provider].evict(grant.connectSubject);
      });
    case INTEGRATION_GRANT_HOLDER.WORKSPACE:
      return Effect.gen(function* () {
        yield* (yield* WorkspaceLinearConnect).evict(grant.organizationId);
      });
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.void;
  }
}

/**
 * One account's token for the Luke account the session was admitted for,
 * or the sentence saying why there is none: its grant
 * (`integrationGrant`), then the token on it.
 */
export function integrationAccessToken(
  account: IntegrationAccountRef,
  admission: IntegrationAdmission,
): Effect.Effect<IntegrationTokenAnswer, never, IntegrationTokenServices> {
  return Effect.flatMap(
    integrationGrant(account, admission),
    (grant): Effect.Effect<IntegrationTokenAnswer, never, IntegrationTokenServices> =>
      Result.isSuccess(grant)
        ? grantAccessToken(grant.success)
        : Effect.succeed(Result.fail(grant.failure)),
  );
}
