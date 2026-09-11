import type * as HttpClient from "@effect/platform/HttpClient";
import type { CloudAgentProviderId } from "@sidecar/session";
import { type CloudFetch, HTTP_METHOD, unparsedWire, type WireRecord } from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Effect, type Layer } from "effect";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  CALL_FAULT,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type HostedActionAnswer, hostedActionAnswerSchema } from "./action-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedActionClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** The cloud session an action names, by the two identifiers the service admits against. */
export interface HostedActionTarget {
  providerId: CloudAgentProviderId;
  providerSessionId: string;
}

/**
 * How an action call ended short of an answer, told apart by the one thing
 * the caller has to know: whether the action may have landed. A call that
 * never left, or that the service turned away at its door, ran nothing; a
 * call that left and lost its answer, or came back unreadable, may have.
 */
export const HOSTED_ACTION_FAILURE = {
  /** No account stood to send it under, or the account changed under the call. */
  NOT_SENT: "not-sent",
  /** The call left and no answer came back. */
  LOST: "lost",
  /** The service refused the request before admitting anything. */
  REFUSED: "refused",
  /** The service answered in a shape this build cannot read. */
  UNREADABLE: "unreadable",
} as const;

export type HostedActionFailure =
  (typeof HOSTED_ACTION_FAILURE)[keyof typeof HOSTED_ACTION_FAILURE];

export type HostedActionOutcome = { answer: HostedActionAnswer } | { failure: HostedActionFailure };

/**
 * The desktop's side of the two session actions a row asks for: the message
 * typed into its composer and the press of a control its provider advertised.
 * Each is one call on the signed-in account; the service admits it against
 * the stored snapshot the same account's rows were drawn from, builds the
 * write from that snapshot's own advertisement, and answers what the provider
 * said. Nothing here decides whether the action may run, and nothing here
 * holds a roster: the target is two identifiers and the ask is the words.
 */
export class HostedActionClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedActionClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));
  }

  sendMessage(target: HostedActionTarget, text: string): Promise<HostedActionOutcome> {
    return this.#post(HOSTED_SERVICE_PATH.ACTION_MESSAGE, { ...targetRecord(target), text });
  }

  executeControl(target: HostedActionTarget, controlId: string): Promise<HostedActionOutcome> {
    return this.#post(HOSTED_SERVICE_PATH.ACTION_CONTROL, { ...targetRecord(target), controlId });
  }

  async #post(path: string, body: WireRecord): Promise<HostedActionOutcome> {
    const sent = await this.#run(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path,
        body: JSON.stringify(body),
      }),
    );
    if (!callAnswered(sent)) {
      // A client that could not carry the request may have failed after it
      // left, so a network fault is an answer lost rather than a call never made.
      return {
        failure:
          sent.fault === CALL_FAULT.NETWORK
            ? HOSTED_ACTION_FAILURE.LOST
            : HOSTED_ACTION_FAILURE.NOT_SENT,
      };
    }
    if (!sent.response.ok) return { failure: HOSTED_ACTION_FAILURE.REFUSED };
    const payload = await sent.response.json().catch(() => undefined);
    const answer =
      payload === undefined ? undefined : hostedActionAnswerSchema.parse(unparsedWire(payload));
    return answer ? { answer } : { failure: HOSTED_ACTION_FAILURE.UNREADABLE };
  }

  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}

function targetRecord(target: HostedActionTarget): WireRecord {
  return { providerId: target.providerId, providerSessionId: target.providerSessionId };
}
