import type * as HttpClient from "@effect/platform/HttpClient";
import type { CloudAgentProviderId } from "@sidecar/session";
import { type CloudFetch, HTTP_METHOD } from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Effect, type Layer } from "effect";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type HostedConversationAnswer,
  hostedConversationAnswerSchema,
  SESSION_MESSAGES_QUERY,
} from "./conversation-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedSessionMessagesClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/**
 * One read of a session's conversation: the session by the two identifiers
 * the service admits against, and the message id an earlier answer handed
 * back as its `lastMessageId`, or none for the newest page. A read never
 * composes a position of its own: the cursor is the service's word, echoed.
 */
export interface SessionMessagesQuery {
  providerId: CloudAgentProviderId;
  providerSessionId: string;
  afterMessageId?: string | undefined;
}

/**
 * The desktop's side of the messages endpoint the phone's chat screen reads:
 * one observed cloud session's own conversation, read on the signed-in
 * account through the service, which re-observes the session under the
 * developer's synced key before it reads, and stores nothing of the answer.
 * The brain's transcript reads are the one caller: an ask to read a
 * session's words is a tool call in a developer-opened turn or an observed
 * conversation's look, never an observation pass. An answer the call could
 * not get resolves to nothing, and the caller reports the read refused.
 */
export class HostedSessionMessagesClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedSessionMessagesClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));
  }

  read(query: SessionMessagesQuery): Promise<HostedConversationAnswer | undefined> {
    const parameters = new URLSearchParams({
      [SESSION_MESSAGES_QUERY.PROVIDER_ID]: query.providerId,
      [SESSION_MESSAGES_QUERY.PROVIDER_SESSION_ID]: query.providerSessionId,
    });
    if (query.afterMessageId !== undefined) {
      parameters.set(SESSION_MESSAGES_QUERY.AFTER, query.afterMessageId);
    }
    return this.#run(
      this.#call.ask(
        {
          method: HTTP_METHOD.GET,
          path: `${HOSTED_SERVICE_PATH.SESSION_MESSAGES}?${parameters.toString()}`,
        },
        hostedConversationAnswerSchema,
      ),
    );
  }

  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}
