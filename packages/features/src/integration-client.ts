import { Effect, Option, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type CallCredential, resolvedCredential } from "./account-call.js";
import type { integrationStatusesReadSchema } from "./contract/integrations.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationCallFailure,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
} from "./integration-view.js";
import {
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_QUERY,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationConnectAnswer,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  integrationAccountSchema,
  integrationProviderSchema,
  integrationSignInFailureSchema,
} from "./integration-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * integration-client.ts -- the window's side of the account's integrations, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract (`contract/integrations.ts`),
 * carried by the one account call (`hosted-link.ts`), so the bearer is read
 * fresh per attempt and a 401 is renewed and retried once. Each call answers what
 * the service said or why there is no answer, never a failure, because
 * every caller does the same with one: says why, and offers to try again.
 */

export interface HostedIntegrationsClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: IntegrationCallFailure };

const UNANSWERED: Failed = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

const STATUSES: ReadonlySet<string> = new Set(Object.values(INTEGRATION_STATUS));

/**
 * Every provider's status from an answer read leniently: a provider the
 * service left out, or named in a status this build does not know, stands
 * unavailable, which is what a service that offers no such connection means.
 * One provider's absence never hides the others.
 */
function integrationStatusesFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): Record<IntegrationProvider, IntegrationStatus> {
  const statusOf = (provider: IntegrationProvider): IntegrationStatus => {
    const word = read.integrations[provider];
    // SAFETY: membership in the set built from INTEGRATION_STATUS's values is what the union names.
    return word !== undefined && STATUSES.has(word)
      ? (word as IntegrationStatus)
      : INTEGRATION_STATUS.UNAVAILABLE;
  };
  // SAFETY: the entries are one per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, statusOf(provider)]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

/** The sign-in failures this build reads, each alone, so one it cannot read hides none of the others. */
function signInFailuresFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationSignInFailure[] {
  return (read.signInFailures ?? []).flatMap((failure) =>
    Option.toArray(Schema.decodeUnknownOption(integrationSignInFailureSchema)(failure)),
  );
}

/** The accounts this build reads, each alone, so one naming a provider or a status this build does not know hides none of the others. */
function accountsFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationAccount[] {
  return (read.accounts ?? []).flatMap((account) =>
    Option.toArray(Schema.decodeUnknownOption(integrationAccountSchema)(account)),
  );
}

/** The providers this build knows among those the read says the account may add another account at. */
function addableFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationProvider[] {
  return (read.addable ?? []).flatMap((provider) =>
    Option.toArray(Schema.decodeUnknownOption(integrationProviderSchema)(provider)),
  );
}

/** Where every provider stands, as the window hears it, with its accounts, where it may add one, and the sign-in failures the read found where it found any. */
function integrationStatusesViewOf(
  read: typeof integrationStatusesReadSchema.Type,
): IntegrationStatusesView {
  const accounts = accountsFromRead(read);
  const addable = addableFromRead(read);
  const signInFailures = signInFailuresFromRead(read);
  return {
    integrations: integrationStatusesFromRead(read),
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
    ...(signInFailures.length > 0 ? { signInFailures } : undefined),
  };
}

/** Whether a read holds a sign-in still under way, at a provider's first account or any other. */
function holdsPending(read: typeof integrationStatusesReadSchema.Type): boolean {
  return (
    Object.values(read.integrations).includes(INTEGRATION_STATUS.PENDING) ||
    accountsFromRead(read).some((account) => account.status === INTEGRATION_STATUS.PENDING)
  );
}

/** Which account a call is about, and on a Connect whether it signs in a new one: none named is the provider's first. */
export interface IntegrationAccountTarget {
  readonly connection?: string | undefined;
  readonly add?: boolean | undefined;
}

/** The query a provider's procedure names the account in; nothing for the provider's first account. */
function accountQuery(target: IntegrationAccountTarget = {}) {
  return {
    ...(target.connection !== undefined
      ? { [INTEGRATION_QUERY.CONNECTION]: target.connection }
      : undefined),
    ...(target.add === true ? { [INTEGRATION_QUERY.ADD]: INTEGRATION_ADD_ACCOUNT } : undefined),
  };
}

/** A provider's input in parts: the path's provider, and the query only where it names something. */
function accountInput(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
  const query = accountQuery(target);
  return { params: { provider }, ...(Object.keys(query).length > 0 ? { query } : undefined) };
}

/** A procedure's answer, the service's own unavailable as the window's, or unanswered for anything else. */
function answerOf<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) =>
    Effect.succeed(
      failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.UNAVAILABLE
        ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
        : UNANSWERED,
    ),
  );
}

/** The window's reads and changes of the account's integrations. */
export class HostedIntegrationsClient {
  readonly #hosted: HostedClient;
  readonly #credential: CallCredential;

  constructor(options: HostedIntegrationsClientOptions) {
    this.#credential = options.credential;
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * Where every provider's connection stands. Note that a caller with no
   * bearer, a browser tab on its cookie session, reads a sign-in under way
   * as stored, because the service settles none on a GET a cookie carries;
   * so where that read holds one pending, the settling POST is asked as
   * well and its answer stands. A bearer's GET has settled already.
   */
  statuses(): Effect.Effect<IntegrationStatusesView, never, HttpClient.HttpClient> {
    const integrations = this.#hosted.integrations;
    const credential = this.#credential;
    return Effect.gen(function* () {
      const stored = yield* answerOf(askHosted(integrations.statuses, undefined));
      if ("failure" in stored) return stored;
      if (!holdsPending(stored)) return integrationStatusesViewOf(stored);
      const { authorization } = yield* resolvedCredential(credential);
      if (authorization !== undefined) return integrationStatusesViewOf(stored);
      const settled = yield* answerOf(askHosted(integrations.settle, undefined));
      return integrationStatusesViewOf("failure" in settled ? stored : settled);
    });
  }

  /** A browser sign-in to one account at a provider begun, or to a new one: the address the browser opens, which the caller opens and never shows, and the account it signs in. */
  connect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationConnectAnswer | Failed, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.connect, accountInput(provider, target)));
  }

  /** The tools one account's server offers the account's agents. */
  tools(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationToolsView, never, HttpClient.HttpClient> {
    return answerOf(
      askHosted(this.#hosted.integrations.tools, {
        provider,
        ...(target?.connection !== undefined
          ? { [INTEGRATION_QUERY.CONNECTION]: target.connection }
          : undefined),
      }),
    );
  }

  /** One account's sign-in under way ended, answering where it then stands. */
  cancel(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.cancel, accountInput(provider, target)));
  }

  /** One account's connection ended, answering where it then stands. */
  disconnect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(
      askHosted(this.#hosted.integrations.disconnect, accountInput(provider, target)),
    );
  }

  /** One account named as the developer calls it, answering the account as it then stands. */
  rename(
    provider: IntegrationProvider,
    connection: string,
    label: string,
  ): Effect.Effect<IntegrationAccountView, never, HttpClient.HttpClient> {
    return answerOf(
      askHosted(this.#hosted.integrations.rename, {
        ...accountInput(provider, { connection }),
        body: { label },
      }),
    );
  }
}
