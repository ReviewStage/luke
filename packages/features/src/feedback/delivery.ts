import { HTTP_METHOD, text } from "@repo/wire";
import { Data, Duration, Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { LINK_ORIGIN } from "../link-home.js";
import type { FeedbackResult, FeedbackSubmission } from "./submission.js";

const FEEDBACK_ENVIRONMENT = {
  URL: "APP_FEEDBACK_URL",
} as const;

const FEEDBACK_DEFAULTS = {
  URL: `${LINK_ORIGIN}/api/feedback`,
  REQUEST_TIMEOUT_MS: 30_000,
} as const;

const FEEDBACK_REFUSAL = {
  UNREACHABLE: "Could not reach the feedback service. Check the connection and try again.",
  REFUSED: "The feedback service did not take that. Try again.",
} as const;

const JSON_CONTENT_TYPE = "application/json";

const DEADLINE_ERROR_NAME = "TimeoutError";

const OK_STATUS = {
  FIRST: 200,
  PAST: 300,
} as const;

function answeredOk(status: number): boolean {
  return status >= OK_STATUS.FIRST && status < OK_STATUS.PAST;
}

interface FeedbackDeliveryOptions {
  url?: string;
  requestTimeoutMs?: number;
}

class FeedbackTransportError extends Data.TaggedError("FeedbackTransportError")<{
  readonly errorName: string | undefined;
}> {}

function errorName(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.name : undefined;
}

function report(message: string): void {
  console.error(message);
}

interface FeedbackDeliveryEffects {
  readonly url: string;
  readonly requestTimeoutMs: number;
  deliver(
    submission: FeedbackSubmission,
  ): Effect.Effect<FeedbackResult, never, HttpClient.HttpClient>;
}

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
    return Effect.catch(HttpClient.execute(request), (error) =>
      Effect.fail(new FeedbackTransportError({ errorName: errorName(error.cause) })),
    );
  }

  return {
    url,
    requestTimeoutMs,
    deliver: (submission) =>
      requested(submission).pipe(
        Effect.timeoutOrElse({
          duration: deadline,
          orElse: () => Effect.fail(new FeedbackTransportError({ errorName: DEADLINE_ERROR_NAME })),
        }),
        Effect.map((response): FeedbackResult => {
          if (answeredOk(response.status)) return { delivered: true };
          report(`Feedback delivery failed with status ${response.status}`);
          return { delivered: false, reason: FEEDBACK_REFUSAL.REFUSED };
        }),
        Effect.catch((failure) => {
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
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

export interface AmbientFeedbackDelivery {
  deliver(submission: FeedbackSubmission): Effect.Effect<FeedbackResult>;
}

export function feedbackDeliveryFromEnvironment(
  options: FeedbackDeliveryFetchOptions = {},
): AmbientFeedbackDelivery {
  const url = text(options.url) ?? text(process.env[FEEDBACK_ENVIRONMENT.URL]);
  const delivery = feedbackDelivery({
    ...(url === undefined ? undefined : { url }),
    ...(options.requestTimeoutMs === undefined
      ? undefined
      : { requestTimeoutMs: options.requestTimeoutMs }),
  });
  const client = options.httpClient ?? FetchHttpClient.layer;
  return {
    deliver: (submission) => Effect.provide(delivery.deliver(submission), client),
  };
}
