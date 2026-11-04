import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  askHosted,
  askLive,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import type { IntegrationStatusesLiveAnswer } from "./integration-live.js";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationCallFailure,
  type IntegrationStatusView,
  type IntegrationToolsView,
} from "./integration-view.js";
import {
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_QUERY,
  type IntegrationConnectAnswer,
  type IntegrationProvider,
} from "./integration-wire.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
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

  constructor(options: HostedIntegrationsClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * Every integration row the account holds, sealed for following over Neon
   * Realtime, with the providers it is offered and those that take several
   * accounts, or with `poll` its rows inline, held past `after`; signed out
   * where the session is not the account `userId` names.
   */
  statusesLive(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    IntegrationStatusesLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return Effect.catch(
      askLive(this.#hosted.live.integrationStatuses, { [LIVE_USER_QUERY]: userId }, poll, after),
      (failed) =>
        Effect.succeed(
          failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN
            ? LIVE_SIGNED_OUT
            : failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.UNAVAILABLE
              ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
              : UNANSWERED,
        ),
    );
  }

  /**
   * Every sign-in under way settled with Connect, for any caller, a
   * cookie's among them. Note that what it answers is not read, since what
   * it settles is written to the rows a live read follows.
   */
  settle(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.asVoid(answerOf(askHosted(this.#hosted.integrations.settle, undefined)));
  }

  /** Where GitHub stands for the account, from its GitHub sign-in. */
  github(): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.github, undefined));
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
