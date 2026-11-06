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

export interface HostedIntegrationsClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: IntegrationCallFailure };

const UNANSWERED: Failed = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

export interface IntegrationAccountTarget {
  readonly connection?: string | undefined;
  readonly add?: boolean | undefined;
}

function accountQuery(target: IntegrationAccountTarget = {}) {
  return {
    ...(target.connection !== undefined
      ? { [INTEGRATION_QUERY.CONNECTION]: target.connection }
      : undefined),
    ...(target.add === true ? { [INTEGRATION_QUERY.ADD]: INTEGRATION_ADD_ACCOUNT } : undefined),
  };
}

function accountInput(provider: IntegrationProvider, target?: IntegrationAccountTarget) {
  const query = accountQuery(target);
  return { params: { provider }, ...(Object.keys(query).length > 0 ? { query } : undefined) };
}

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

export class HostedIntegrationsClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedIntegrationsClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

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

  settle(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.asVoid(answerOf(askHosted(this.#hosted.integrations.settle, undefined)));
  }

  github(): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.github, undefined));
  }

  connect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationConnectAnswer | Failed, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.connect, accountInput(provider, target)));
  }

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

  cancel(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(askHosted(this.#hosted.integrations.cancel, accountInput(provider, target)));
  }

  disconnect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return answerOf(
      askHosted(this.#hosted.integrations.disconnect, accountInput(provider, target)),
    );
  }

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
