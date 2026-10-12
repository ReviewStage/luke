import { EXCESS_KEYS, HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallAnswer,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  LINEAR_CALL_FAILURE,
  type LinearCallFailure,
  type LinearStatusView,
} from "./linear-view.js";
import {
  type LinearConnectAnswer,
  linearConnectAnswerSchema,
  linearStatusAnswerSchema,
} from "./linear-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";

/**
 * linear-client.ts -- the window's side of the account's Linear connection, as the host asks the service for it.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers what
 * the service said or why there is no answer, never a failure, because
 * every caller does the same with one: says why, and offers to try again.
 */

export interface HostedLinearClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: LinearCallFailure };

const UNANSWERED: Failed = { failure: LINEAR_CALL_FAILURE.UNANSWERED };

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** An answer read whole: the body the schema admits, the service's own unavailable, or unanswered for anything else. */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) {
      const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
      return refusal === HOSTED_API_ERROR.UNAVAILABLE
        ? { failure: LINEAR_CALL_FAILURE.UNAVAILABLE }
        : UNANSWERED;
    }
    const read = Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(payload));
    return read === undefined ? UNANSWERED : read;
  });
}

/** The window's reads and changes of the account's Linear connection. */
export class HostedLinearClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedLinearClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Where the connection stands. */
  status(): Effect.Effect<LinearStatusView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_LINEAR }),
      (answer) => readAnswer(answer, linearStatusAnswerSchema),
    );
  }

  /** A browser sign-in begun: the address the browser opens, which the caller opens and never shows. */
  connect(): Effect.Effect<LinearConnectAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_CONNECT,
      }),
      (answer) => readAnswer(answer, linearConnectAnswerSchema),
    );
  }

  /** The connection ended, answering where it then stands. */
  disconnect(): Effect.Effect<LinearStatusView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_LINEAR_DISCONNECT,
      }),
      (answer) => readAnswer(answer, linearStatusAnswerSchema),
    );
  }
}
