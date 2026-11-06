import { HTTP_METHOD, positiveInteger, withoutTrailingSlash } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Data, Effect, type Layer, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, EXCESS_KEYS, fixedBearer, NO_CREDENTIAL } from "../core.js";

export const POSTHOG_ENVIRONMENT = {
  PROJECT_API_KEY: "POSTHOG_PROJECT_API_KEY",
  HOST: "POSTHOG_HOST",
  API_HOST: "POSTHOG_API_HOST",
  PERSONAL_API_KEY: "POSTHOG_PERSONAL_API_KEY",
  PROJECT_ID: "POSTHOG_PROJECT_ID",
} as const;

const POSTHOG_DEFAULTS = {
  HOST: "https://us.i.posthog.com",
  API_HOST: "https://us.posthog.com",
  BATCH_PATH: "/batch/",
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

export function posthogProjectConsoleUrl(projectId: string, host?: string): string {
  return `${resolvePosthogApiHost(host)}/project/${encodeURIComponent(projectId)}`;
}

export function posthogPersonConsoleUrl(projectConsoleUrl: string, distinctId: string): string {
  return `${projectConsoleUrl}/person/${encodeURIComponent(distinctId)}`;
}

export interface PosthogPerson {
  name?: string;
  email?: string;
}

export type PosthogGroupFields = Readonly<Record<string, string>>;

type PosthogPropertyValue = string | number | boolean | PosthogPerson | PosthogGroupFields;

export interface PosthogBatchItem {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Readonly<Record<string, PosthogPropertyValue>>;
}

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

function resolvePosthogApiHost(host: string | undefined): string {
  return withoutTrailingSlash(host?.trim() || POSTHOG_DEFAULTS.API_HOST);
}

export function postBatchEffect(
  body: PosthogBatch,
  options: PosthogUpstreamOptions = {},
): Effect.Effect<Response | undefined, never, HttpClient.HttpClient> {
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

export class PosthogForgetError extends Data.TaggedError("PosthogForgetError")<{
  readonly message: string;
}> {}

const bulkDeleteAnswerSchema = Schema.Struct({
  deletion_errors: Schema.Array(Schema.Unknown),
});

const readBulkDeleteAnswer = readEither(bulkDeleteAnswerSchema, { excess: EXCESS_KEYS.DROP });

export function forgetPosthogPersonEffect(
  distinctId: string,
  options: PosthogForgetOptions,
): Effect.Effect<void, PosthogForgetError, HttpClient.HttpClient> {
  const requestTimeoutMs = positiveInteger(options.timeoutMs, POSTHOG_DEFAULTS.REQUEST_TIMEOUT_MS);
  const call = accountCall({
    baseUrl: resolvePosthogApiHost(options.host),
    credential: fixedBearer(options.personalApiKey),
    requestTimeoutMs,
  });
  return Effect.gen(function* () {
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
    const errors = read.success.deletion_errors.length;
    if (errors > 0) {
      return yield* new PosthogForgetError({
        message: `answered status ${status} with ${errors} deletion error(s)`,
      });
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: requestTimeoutMs,
      orElse: () =>
        Effect.fail(new PosthogForgetError({ message: `no answer within ${requestTimeoutMs}ms` })),
    }),
  );
}
