/**
 * How the recording endpoint reaches the analytics processor. The project key
 * comes from the deployment's environment and never appears in a response, a
 * log line, or an error; without one the endpoint answers 503 and product
 * analytics is simply off, the same kill switch the voice endpoint uses for
 * its OpenAI key.
 *
 * `fetch` rather than the vendor SDK on purpose. The SDK's value is queueing,
 * retry, and a background flush, all built for a long-lived process; a
 * serverless instance may freeze the moment it returns, so a background flush
 * can be lost silently, and shutting the SDK down per request produces the
 * same single POST minus a dependency to track. What is given up is automatic
 * retry, which this pipeline does not want — the desktop never retries either.
 */

import { HTTP_METHOD, withoutTrailingSlash } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Data, Effect, type Layer, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, EXCESS_KEYS, fixedBearer, NO_CREDENTIAL } from "../core.js";

export const POSTHOG_ENVIRONMENT = {
  PROJECT_API_KEY: "POSTHOG_PROJECT_API_KEY",
  /** The ingestion host a batch is posted to. */
  HOST: "POSTHOG_HOST",
  /** The private API host deletion is asked of, which is not the ingestion host. */
  API_HOST: "POSTHOG_API_HOST",
  /** Deletion is a private endpoint, so it takes a personal key rather than the project token. */
  PERSONAL_API_KEY: "POSTHOG_PERSONAL_API_KEY",
  PROJECT_ID: "POSTHOG_PROJECT_ID",
} as const;

const POSTHOG_DEFAULTS = {
  HOST: "https://us.i.posthog.com",
  /** The private API lives on the app host, not the ingestion host. */
  API_HOST: "https://us.posthog.com",
  BATCH_PATH: "/batch/",
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

/**
 * One project's console page, on the app host the private API lives on —
 * never the ingestion host, which serves no pages. This is an address for a
 * maintainer's browser, not an endpoint Luke calls, and it honors the same
 * host override the erasure call does, so an EU project links to its own
 * console.
 */
export function posthogProjectConsoleUrl(projectId: string, host?: string): string {
  return `${resolvePosthogApiHost(host)}/project/${encodeURIComponent(projectId)}`;
}

/**
 * Who the account behind a batch is, as the person record should read. The
 * service reads this from its own user row rather than taking it from the
 * request, so the desktop still names nobody: these are the same fields the
 * account itself already holds.
 */
export interface PosthogPerson {
  name?: string;
  email?: string;
}

/** Every kind of value one of this build's event properties may hold. */
type PosthogPropertyValue = string | number | boolean | PosthogPerson;

/** One item of the documented batch document, as this build builds it. */
export interface PosthogBatchItem {
  event: string;
  timestamp: string;
  properties: Readonly<Record<string, PosthogPropertyValue>>;
}

/** The whole batch document, exactly as the capture endpoint documents it. */
export interface PosthogBatch {
  api_key: string;
  historical_migration: boolean;
  batch: readonly PosthogBatchItem[];
}

export interface PosthogUpstreamOptions {
  host?: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  timeoutMs?: number;
}

/** The deployment's private-API host override when it holds one, the default otherwise. */
function resolvePosthogApiHost(host: string | undefined): string {
  return withoutTrailingSlash(host?.trim() || POSTHOG_DEFAULTS.API_HOST);
}

/**
 * Posts one batch document over the ambient `HttpClient`, answering nothing on
 * a network fault so the caller answers 502 without ever holding an error that
 * could name the key.
 */
export function postBatchEffect(
  body: PosthogBatch,
  options: PosthogUpstreamOptions = {},
): Effect.Effect<Response | undefined, never, HttpClient.HttpClient> {
  // The project token travels in the batch document itself, so ingestion takes
  // no identity of its own.
  const call = accountCall({
    baseUrl: options.host?.trim() || POSTHOG_DEFAULTS.HOST,
    credential: NO_CREDENTIAL,
    requestTimeoutMs: options.timeoutMs ?? POSTHOG_DEFAULTS.REQUEST_TIMEOUT_MS,
  });
  return Effect.map(
    call.send({
      method: HTTP_METHOD.POST,
      path: POSTHOG_DEFAULTS.BATCH_PATH,
      body: JSON.stringify(body),
    }),
    (answer) => (callAnswered(answer) ? answer.response : undefined),
  );
}

export interface PosthogForgetOptions {
  host?: string;
  timeoutMs?: number;
  personalApiKey: string;
  projectId: string;
}

/** Why an erasure did not go through: the upstream never answered, or answered with a status that names no key. */
export class PosthogForgetError extends Data.TaggedError("PosthogForgetError")<{
  readonly message: string;
}> {}

/**
 * The part of the bulk-delete answer erasure reads. PostHog reports a person
 * it could not delete in `deletion_errors` under a 202 rather than as an
 * error status, so a 2xx alone does not mean the erasure was taken.
 */
const bulkDeleteAnswerSchema = Schema.Struct({
  deletion_errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const readBulkDeleteAnswer = readEither(bulkDeleteAnswerSchema, { excess: EXCESS_KEYS.DROP });

/**
 * Asks the processor to erase the person behind one distinct id, with the
 * events and the recordings recorded against them. The documented bulk-delete
 * endpoint (https://posthog.com/docs/api/persons) reads the distinct ids and
 * both `delete_events` and `delete_recordings` from its body alone, and queues
 * the work rather than performing it — so a settled effect means the erasure
 * was accepted, never that it has already happened. An answer that queued no
 * person settles too: PostHog holds no person for an account it was never told
 * of, and it still hands the distinct id's recordings to the same deletion. An
 * answer naming any deletion error, or one that cannot be read, fails, and no
 * failure quotes the body. The request runs over the ambient `HttpClient`.
 */
export const forgetPosthogPersonEffect = /* @__PURE__ */ Effect.fnUntraced(function* (
  distinctId: string,
  options: PosthogForgetOptions,
): Effect.fn.Return<void, PosthogForgetError, HttpClient.HttpClient> {
  const call = accountCall({
    baseUrl: resolvePosthogApiHost(options.host),
    credential: fixedBearer(options.personalApiKey),
    requestTimeoutMs: options.timeoutMs ?? POSTHOG_DEFAULTS.REQUEST_TIMEOUT_MS,
  });
  const answer = yield* call.send({
    method: HTTP_METHOD.POST,
    path: `/api/projects/${encodeURIComponent(options.projectId)}/persons/bulk_delete/`,
    body: JSON.stringify({
      distinct_ids: [distinctId],
      delete_events: true,
      delete_recordings: true,
    }),
  });
  if (!callAnswered(answer)) {
    return yield* new PosthogForgetError({
      message: `network fault: ${answer.errorName ?? "unknown"}`,
    });
  }
  const status = answer.response.status;
  // The status alone diagnoses the refusal; the body could name the key.
  if (!answer.response.ok) {
    return yield* new PosthogForgetError({ message: `refused with status ${status}` });
  }
  const payload = yield* Effect.orElseSucceed(
    Effect.tryPromise(() => answer.response.json()),
    () => undefined,
  );
  const read = readBulkDeleteAnswer(payload);
  if (Result.isFailure(read)) {
    return yield* new PosthogForgetError({ message: `unreadable answer with status ${status}` });
  }
  const errors = read.success.deletion_errors?.length ?? 0;
  if (errors > 0) {
    return yield* new PosthogForgetError({
      message: `answered status ${status} with ${errors} deletion error(s)`,
    });
  }
});
