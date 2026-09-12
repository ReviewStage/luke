import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import type * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { HTTP_METHOD, text } from "@sidecar/wire";
import { Data, Duration, Effect, type Layer } from "effect";
import type { FeedbackResult, FeedbackSubmission } from "./submission.js";

const FEEDBACK_ENVIRONMENT = {
  /** Overrides the endpoint for local testing of the delivery path. */
  URL: "LUKE_FEEDBACK_URL",
} as const;

const FEEDBACK_DEFAULTS = {
  /**
   * The one place a submission goes: a small endpoint on Luke's own site that
   * forwards it as email to the founders. Fixed here rather than passed in, so
   * the renderer names an intent and never an address.
   */
  URL: "https://tryluke.dev/api/feedback",
  // Generous next to the evaluator's timeout, because a submission can carry
  // screenshots and a send that dies mid-upload costs the user a retry.
  REQUEST_TIMEOUT_MS: 30_000,
} as const;

/** What the send failed as, in words the composer can put under its field. */
const FEEDBACK_REFUSAL = {
  UNREACHABLE: "Could not reach the feedback service. Check the connection and try again.",
  REFUSED: "The feedback service could not take this right now. Try again in a moment.",
} as const;

/** The content type a serialized body names, the one type this call sends. */
const JSON_CONTENT_TYPE = "application/json";

/** The name a deadline ends a request under, kept beside the timeout error it names. */
const DEADLINE_ERROR_NAME = "TimeoutError";

/**
 * The range a `Response` calls `ok`, restated because what is read here is a
 * status rather than a `Response`.
 */
const OK_STATUS = {
  FIRST: 200,
  PAST: 300,
} as const;

function answeredOk(status: number): boolean {
  return status >= OK_STATUS.FIRST && status < OK_STATUS.PAST;
}

export interface FeedbackDeliveryOptions {
  url?: string;
  requestTimeoutMs?: number;
}

/**
 * What one send ended with before its status was read: a client that could
 * not carry it, or the deadline. The name is the error's kind and never its
 * words, which are never logged for a message that is the user's own.
 */
class FeedbackTransportError extends Data.TaggedError("FeedbackTransportError")<{
  readonly errorName: string | undefined;
}> {}

function errorName(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.name : undefined;
}

function report(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Carries one submission to the fixed endpoint over the ambient `HttpClient`,
 * bounded by the call's own deadline, and answers in the user's terms. A
 * refusal is an answer, never a failure: sending feedback is the user's own
 * action, and what became of it belongs beside the field it left. Nothing
 * about the submission is ever logged — a message to the founders is the
 * user's words, and status codes alone diagnose the path.
 */
export interface FeedbackDeliveryEffects {
  readonly url: string;
  readonly requestTimeoutMs: number;
  deliver(
    submission: FeedbackSubmission,
  ): Effect.Effect<FeedbackResult, never, HttpClient.HttpClient>;
}

/** The delivery as effects over `@effect/platform`'s `HttpClient` tag. */
export function feedbackDelivery(options: FeedbackDeliveryOptions = {}): FeedbackDeliveryEffects {
  const url = text(options.url) ?? FEEDBACK_DEFAULTS.URL;
  const requestTimeoutMs = options.requestTimeoutMs ?? FEEDBACK_DEFAULTS.REQUEST_TIMEOUT_MS;
  const deadline = Duration.millis(requestTimeoutMs);

  function requested(
    submission: FeedbackSubmission,
  ): Effect.Effect<
    HttpClientResponse.HttpClientResponse,
    FeedbackTransportError,
    HttpClient.HttpClient
  > {
    const request = HttpClientRequest.make(HTTP_METHOD.POST)(url, {
      body: HttpBody.raw(JSON.stringify(submission), { contentType: JSON_CONTENT_TYPE }),
    });
    return Effect.catchAll(HttpClient.execute(request), (error) =>
      Effect.fail(new FeedbackTransportError({ errorName: errorName(error.cause) })),
    );
  }

  return {
    url,
    requestTimeoutMs,
    deliver: (submission) =>
      requested(submission).pipe(
        Effect.timeoutFail({
          duration: deadline,
          onTimeout: () => new FeedbackTransportError({ errorName: DEADLINE_ERROR_NAME }),
        }),
        Effect.map((response): FeedbackResult => {
          if (answeredOk(response.status)) return { delivered: true };
          report(`Feedback delivery failed with status ${response.status}`);
          return { delivered: false, reason: FEEDBACK_REFUSAL.REFUSED };
        }),
        Effect.catchAll((failure) => {
          report(`Feedback delivery did not complete: ${failure.errorName ?? "unknown error"}`);
          return Effect.succeed<FeedbackResult>({
            delivered: false,
            reason: FEEDBACK_REFUSAL.UNREACHABLE,
          });
        }),
      ),
  };
}

export interface FeedbackDeliveryFetchOptions extends FeedbackDeliveryOptions {
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

/** The promise-answering face of {@link FeedbackDeliveryEffects}. */
export interface FeedbackDeliveryCourier {
  deliver(submission: FeedbackSubmission): Promise<FeedbackResult>;
}

/**
 * Builds the courier every run gets. There is no key to be missing — the
 * endpoint is public and the destination is fixed — so unlike the evaluator
 * this never answers with nothing; only the address can be overridden, for
 * testing the path against a local server.
 *
 * @deprecated Runs the effect over the caller's own `HttpClient`; superseded
 * by {@link feedbackDelivery}, which answers effects over the ambient
 * `HttpClient` directly.
 */
export function feedbackDeliveryFromEnvironment(
  options: FeedbackDeliveryFetchOptions = {},
): FeedbackDeliveryCourier {
  const url = text(options.url) ?? text(process.env[FEEDBACK_ENVIRONMENT.URL]);
  const delivery = feedbackDelivery({
    ...(url === undefined ? undefined : { url }),
    ...(options.requestTimeoutMs === undefined
      ? undefined
      : { requestTimeoutMs: options.requestTimeoutMs }),
  });
  const client = options.httpClient ?? FetchHttpClient.layer;
  return {
    deliver: (submission) =>
      Effect.runPromise(Effect.provide(delivery.deliver(submission), client)),
  };
}
