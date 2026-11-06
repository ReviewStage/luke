import { Duration, Effect, type Redacted, Schedule, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TRANSPORT_RETRY } from "./preview-probe.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "preview-probe",
} as const;
const VERCEL_PREVIEW_ENVIRONMENT = "Preview";
const DEPLOYMENT_PAGE = "10";
const VERCEL_SKIPPED_DESCRIPTION = "Skipped - Not affected";

const DEPLOYMENT_STATE = {
  ERROR: "error",
  FAILURE: "failure",
  INACTIVE: "inactive",
  IN_PROGRESS: "in_progress",
  QUEUED: "queued",
  PENDING: "pending",
  SUCCESS: "success",
} as const;
type DeploymentState = (typeof DEPLOYMENT_STATE)[keyof typeof DEPLOYMENT_STATE];

const DeploymentRecord = Schema.Struct({
  id: Schema.Number,
  sha: Schema.String,
  environment: Schema.String,
  created_at: Schema.String,
});
type DeploymentRecord = typeof DeploymentRecord.Type;
const DeploymentRecords = Schema.Array(DeploymentRecord);

const DeploymentStatus = Schema.Struct({
  state: Schema.Literals(Object.values(DEPLOYMENT_STATE)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  environment_url: Schema.optional(Schema.NullOr(Schema.String)),
  target_url: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
});
type DeploymentStatus = typeof DeploymentStatus.Type;
const DeploymentStatuses = Schema.Array(DeploymentStatus);

export const PREVIEW_STATE = {
  WAITING: "waiting",
  READY: "ready",
  NOT_AFFECTED: "not-affected",
  NOT_BUILT: "not-built",
} as const;

export type PreviewReading =
  | { readonly kind: typeof PREVIEW_STATE.WAITING }
  | { readonly kind: typeof PREVIEW_STATE.READY; readonly id: number; readonly address: string }
  | { readonly kind: typeof PREVIEW_STATE.NOT_AFFECTED; readonly id: number }
  | {
      readonly kind: typeof PREVIEW_STATE.NOT_BUILT;
      readonly id: number;
      readonly state: DeploymentState;
      readonly description: string;
    };

function newestFirst<T extends { readonly created_at: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function decidePreview(
  records: readonly DeploymentRecord[],
  statusesOf: (record: DeploymentRecord) => readonly DeploymentStatus[],
): PreviewReading {
  const record = newestFirst(
    records.filter((candidate) => candidate.environment === VERCEL_PREVIEW_ENVIRONMENT),
  )[0];
  if (record === undefined) return { kind: PREVIEW_STATE.WAITING };
  const status = newestFirst(statusesOf(record))[0];
  if (status === undefined) return { kind: PREVIEW_STATE.WAITING };
  const description = status.description ?? "";
  switch (status.state) {
    case DEPLOYMENT_STATE.PENDING:
    case DEPLOYMENT_STATE.QUEUED:
    case DEPLOYMENT_STATE.IN_PROGRESS:
      return { kind: PREVIEW_STATE.WAITING };
    case DEPLOYMENT_STATE.SUCCESS: {
      const address = status.environment_url ?? status.target_url;
      return address
        ? { kind: PREVIEW_STATE.READY, id: record.id, address }
        : { kind: PREVIEW_STATE.NOT_BUILT, id: record.id, state: status.state, description };
    }
    case DEPLOYMENT_STATE.INACTIVE:
      return description === VERCEL_SKIPPED_DESCRIPTION
        ? { kind: PREVIEW_STATE.NOT_AFFECTED, id: record.id }
        : { kind: PREVIEW_STATE.WAITING };
    case DEPLOYMENT_STATE.FAILURE:
    case DEPLOYMENT_STATE.ERROR:
      return { kind: PREVIEW_STATE.NOT_BUILT, id: record.id, state: status.state, description };
  }
}

export interface PreviewSource {
  readonly repository: string;
  readonly sha: string;
  readonly token: Redacted.Redacted<string>;
}

function githubRead(
  source: PreviewSource,
  path: string,
  params: Readonly<Record<string, string>>,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.get(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.setUrlParams(params),
    HttpClientRequest.bearerToken(source.token),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
  );
}

const readPreview = /* @__PURE__ */ Effect.fn("web/readPreview")(
  function* (
    source: PreviewSource,
  ): Effect.fn.Return<
    PreviewReading,
    HttpClientError.HttpClientError | Schema.SchemaError,
    HttpClient.HttpClient
  > {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const records = yield* client
      .execute(
        githubRead(source, `/repos/${source.repository}/deployments`, {
          sha: source.sha,
          environment: VERCEL_PREVIEW_ENVIRONMENT,
          per_page: DEPLOYMENT_PAGE,
        }),
      )
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(DeploymentRecords)), Effect.scoped);
    const newest = newestFirst(records)[0];
    if (newest === undefined) return decidePreview([], () => []);
    const statuses = yield* client
      .execute(
        githubRead(source, `/repos/${source.repository}/deployments/${newest.id}/statuses`, {
          per_page: DEPLOYMENT_PAGE,
        }),
      )
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(DeploymentStatuses)), Effect.scoped);
    return decidePreview([newest], () => statuses);
  },
  Effect.retry({
    schedule: TRANSPORT_RETRY,
    while: (error) => error._tag === "HttpClientError",
  }),
);

const PREVIEW_WAIT = { intervalMs: 15_000, attempts: 80 } as const;

export class PreviewNotReady extends Schema.TaggedError<PreviewNotReady>()("PreviewNotReady", {
  sha: Schema.String,
  waitedMs: Schema.Number,
}) {
  override get message(): string {
    return `no preview for ${this.sha} reached a build's end within ${this.waitedMs} ms`;
  }
}

export function waitForPreview(
  source: PreviewSource,
  options: {
    readonly onReading?: (reading: PreviewReading) => Effect.Effect<void>;
  } = {},
): Effect.Effect<
  Exclude<PreviewReading, { readonly kind: typeof PREVIEW_STATE.WAITING }>,
  PreviewNotReady | HttpClientError.HttpClientError | Schema.SchemaError,
  HttpClient.HttpClient
> {
  const onReading = options.onReading ?? (() => Effect.void);
  return Effect.gen(function* () {
    const reading = yield* Effect.repeat(readPreview(source).pipe(Effect.tap(onReading)), {
      schedule: Schedule.spaced(Duration.millis(PREVIEW_WAIT.intervalMs)).pipe(
        Schedule.upTo({ times: PREVIEW_WAIT.attempts }),
      ),
      until: (reading: PreviewReading): boolean => reading.kind !== PREVIEW_STATE.WAITING,
    });
    if (reading.kind === PREVIEW_STATE.WAITING) {
      return yield* new PreviewNotReady({
        sha: source.sha,
        waitedMs: PREVIEW_WAIT.intervalMs * PREVIEW_WAIT.attempts,
      });
    }
    return reading;
  });
}
