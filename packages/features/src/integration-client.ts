import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askLiveRead, type HostedPoll, hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import { INTEGRATION_CALL_FAILURE, INTEGRATION_RENAMES } from "./integration-view.js";
import {
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_QUERY,
  type IntegrationProvider,
} from "./integration-wire.js";
import type { AnyLiveRead, LiveReadAsked } from "./live-read.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * integration-client.ts -- the window's side of the account's integrations, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract (`contract/integrations.ts`),
 * carried by the one account call (`hosted-link.ts`), so the bearer is read
 * fresh per attempt and a 401 is renewed and retried once. Each call answers what
 * the service said or why there is no answer (`hostedCall`), never a failure, because
 * every caller does the same with one: says why, and offers to try again.
 */

export interface HostedIntegrationsClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

/** The refusal a live read of the account's integrations reads as its own: the service unavailable. */
const LIVE_RENAMES = {
  [HOSTED_API_ERROR.UNAVAILABLE]: INTEGRATION_CALL_FAILURE.UNAVAILABLE,
} as const;

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

/** How every call reads its failure: the service's own unavailable as the window's. */
const READING = { as: INTEGRATION_RENAMES } as const;

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
   * A declared live read sealed for following, or polled where `poll` asks
   * (`askLiveRead`); the service unavailable read as this domain's own
   * failure, as its reads always read it.
   */
  liveRead<Read extends AnyLiveRead>(read: Read, params: LiveReadAsked<Read>, poll?: HostedPoll) {
    return askLiveRead(this.#hosted.live, read, params, poll, LIVE_RENAMES);
  }

  /**
   * Every sign-in under way settled with Connect, for any caller, a
   * cookie's among them. Note that what it answers is not read, since what
   * it settles is written to the rows a live read follows.
   */
  settle(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.asVoid(hostedCall(this.#hosted.integrations.settle, undefined, READING));
  }

  /** Where GitHub stands for the account, from its GitHub sign-in. */
  github() {
    return hostedCall(this.#hosted.integrations.github, undefined, READING);
  }

  /** A browser sign-in to one account at a provider begun, or to a new one: the address the browser opens, which the caller opens and never shows, and the account it signs in. */
  connect(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
    return hostedCall(this.#hosted.integrations.connect, accountInput(provider, target), READING);
  }

  /** The tools one account's server offers the account's agents. */
  tools(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
    return hostedCall(
      this.#hosted.integrations.tools,
      {
        provider,
        ...(target?.connection !== undefined
          ? { [INTEGRATION_QUERY.CONNECTION]: target.connection }
          : undefined),
      },
      READING,
    );
  }

  /** One account's sign-in under way ended, answering where it then stands. */
  cancel(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
    return hostedCall(this.#hosted.integrations.cancel, accountInput(provider, target), READING);
  }

  /** One account's connection ended, answering where it then stands. */
  disconnect(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
    return hostedCall(
      this.#hosted.integrations.disconnect,
      accountInput(provider, target),
      READING,
    );
  }

  /** One account named as the developer calls it, answering the account as it then stands. */
  rename(provider: IntegrationProvider, connection: string, label: string) {
    return hostedCall(
      this.#hosted.integrations.rename,
      { ...accountInput(provider, { connection }), body: { label } },
      READING,
    );
  }
}
