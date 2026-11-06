import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_NAME,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { causeKind } from "@repo/runtime/effect";
import { Effect, Redacted, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { ConversationAdmission } from "../agents/eve-host/conversation.js";
import type { GitHubApp } from "../github/github-app.js";
import { GITHUB_GRANT_REFUSAL, githubSignInGrant } from "./github-integration.js";
import {
  accountIntegrationConnect,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
} from "./integration-connect.js";
import { expireIntegrationConnection, readIntegrationConnection } from "./integration-store.js";

interface UnavailableSentences {
  readonly NOT_CONNECTED: string;
  readonly EXPIRED: string;
  readonly NOT_CONFIGURED: string;
  readonly UNREACHABLE: string;
  readonly NO_ACCOUNT: string;
}

export function integrationUnavailable(provider: IntegrationProvider): UnavailableSentences {
  const name = INTEGRATION_NAME[provider];
  const signedIn = INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
  return {
    NOT_CONNECTED: signedIn
      ? `${name} is not connected for this account. The developer can sign in with GitHub in ${PRODUCT_NAME}'s Settings › Integrations; carry on without it.`
      : `${name} is not connected for this account. The developer can connect it in ${PRODUCT_NAME}'s Settings › Integrations; carry on without it.`,
    EXPIRED: `${name}'s sign-in for this account has expired. The developer can connect it again in ${PRODUCT_NAME}'s Settings › Integrations; carry on without it.`,
    NOT_CONFIGURED: `${name} is not set up on this deployment of ${PRODUCT_NAME}; carry on without it.`,
    UNREACHABLE: `${name}'s sign-in service could not be reached just now. Try once more later, or carry on without it.`,
    NO_ACCOUNT: `This session stands for no account that can use ${name}.`,
  };
}

interface IntegrationTokenResult {
  readonly token: string;
  readonly expiresAt: number;
}

export type IntegrationAdmission = Effect.Effect<
  ConversationAdmission,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

export type IntegrationTokenAnswer = Result.Result<IntegrationTokenResult, string>;

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

export interface IntegrationAccountRef {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly connectSubject?: string;
}

export const INTEGRATION_GRANT_HOLDER = {
  ACCOUNT: "account",
  SIGN_IN: "sign-in",
} as const;

export type IntegrationGrantRef =
  | {
      readonly holder: typeof INTEGRATION_GRANT_HOLDER.ACCOUNT;
      readonly provider: IntegrationProvider;
      readonly userId: string;
      readonly connectionName: string;
      readonly connectSubject: string;
    }
  | {
      readonly holder: typeof INTEGRATION_GRANT_HOLDER.SIGN_IN;
      readonly provider: IntegrationProvider;
      readonly userId: string;
    };

export type IntegrationGrantAnswer = Result.Result<IntegrationGrantRef, string>;

type IntegrationTokenServices =
  | DatabaseServices
  | IntegrationConnect
  | GitHubApp
  | HttpClient.HttpClient;

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

function orUnreachable<A>(
  provider: IntegrationProvider,
  read: Effect.Effect<A, unknown, IntegrationTokenServices>,
): Effect.Effect<A | Result.Result<never, string>, never, IntegrationTokenServices> {
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
      return yield* accountGrant(account, admitted.success.caller);
    }),
  );
}

export function grantAccessToken(
  grant: IntegrationGrantRef,
): Effect.Effect<IntegrationTokenAnswer, never, IntegrationTokenServices> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return orUnreachable(grant.provider, accountToken(grant));
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return orUnreachable(grant.provider, signedInToken(grant.provider, grant.userId));
  }
}

export function evictGrantToken(
  grant: IntegrationGrantRef,
): Effect.Effect<void, never, IntegrationConnect> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return Effect.gen(function* () {
        yield* (yield* IntegrationConnect)[grant.provider].evict(grant.connectSubject);
      });
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.void;
  }
}

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
