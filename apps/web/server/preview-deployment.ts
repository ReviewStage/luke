import * as HttpClient from "@effect/platform/HttpClient";
import type * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Duration, Effect, type Redacted, Schedule, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import { TRANSPORT_RETRY } from "./preview-probe.js";

/**
 * The PR's own preview, found through the GitHub deployment record Vercel's
 * app writes for the head commit. The record is the one signal that names
 * the deployment built from exactly this commit — an alias like the branch
 * URL keeps serving the previous build until the new one is promoted, which
 * is how a probe during the 2026-09-11 incident read 404 from a deployment
 * that was not the one under test — so the address probed is always the
 * record's own, and the wait is on that record's status rather than on a
 * clock or a guess. A build Vercel's `ignoreCommand` skipped is its own
 * state, not a failure: nothing under the deployed tree changed, so there is
 * no preview of the head and nothing to see. A cancelled build is not the
 * end either: Vercel starts two deployments of a freshly pushed PR head and
 * cancels one within seconds, writing the record `inactive`, and the record
 * is moved to `success` with the surviving build's own address only when
 * that build completes, which the API showed minutes late on 2026-09-12; so
 * `inactive` is waited through, and only a build that failed, or the wait's
 * own budget, ends the wait with nothing to see.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "luke-preview-probe",
} as const;
/** The environment Vercel's GitHub app writes on a preview's deployment record. */
const VERCEL_PREVIEW_ENVIRONMENT = "Preview";
const DEPLOYMENT_PAGE = "10";
/** Vercel's own words on the status it writes for a build its `ignoreCommand` skipped, compared whole. */
const VERCEL_SKIPPED_DESCRIPTION = "Skipped - Not affected";

export const DEPLOYMENT_STATE = {
  ERROR: "error",
  FAILURE: "failure",
  INACTIVE: "inactive",
  IN_PROGRESS: "in_progress",
  QUEUED: "queued",
  PENDING: "pending",
  SUCCESS: "success",
} as const;
type DeploymentState = (typeof DEPLOYMENT_STATE)[keyof typeof DEPLOYMENT_STATE];

export const DeploymentRecord = Schema.Struct({
  id: Schema.Number,
  sha: Schema.String,
  environment: Schema.String,
  created_at: Schema.String,
});
export type DeploymentRecord = typeof DeploymentRecord.Type;
const DeploymentRecords = Schema.Array(DeploymentRecord);

export const DeploymentStatus = Schema.Struct({
  state: Schema.Literal(...Object.values(DEPLOYMENT_STATE)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  environment_url: Schema.optional(Schema.NullOr(Schema.String)),
  target_url: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
});
export type DeploymentStatus = typeof DeploymentStatus.Type;
const DeploymentStatuses = Schema.Array(DeploymentStatus);

export const PREVIEW_STATE = {
  /** No record yet, or its newest status is still on the way to a build's end. */
  WAITING: "waiting",
  /** The build completed and the record names its address. */
  READY: "ready",
  /** Vercel's `ignoreCommand` found nothing of the deployed tree changed, so no preview was built for this head. */
  NOT_AFFECTED: "not-affected",
  /** The build failed, or ended without an address: there is no deployment to see. */
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

/** The newest preview record for the head and its newest status, read as one of the four states. */
export function decidePreview(
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
  /** `owner/name`, as GitHub spells `GITHUB_REPOSITORY`. */
  readonly repository: string;
  /** The head commit whose preview is wanted, never the merge commit: Vercel builds the branch. */
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

/** One read of the head's preview from the deployment records, a dropped connection or a refused read retried a few times. */
function readPreview(
  source: PreviewSource,
): Effect.Effect<
  PreviewReading,
  HttpClientError.HttpClientError | ParseError,
  HttpClient.HttpClient
> {
  return Effect.gen(function* () {
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
  }).pipe(
    Effect.retry({
      schedule: TRANSPORT_RETRY,
      while: (error) => error._tag === "RequestError" || error._tag === "ResponseError",
    }),
  );
}

export interface PreviewWait {
  readonly intervalMs: number;
  readonly attempts: number;
}

/**
 * Twenty minutes. On 2026-09-12 a preview's record appeared about 25 s after
 * the push and reached success 85–115 s later; the rest of the budget is
 * Vercel's build queue on a day with many open branches.
 */
const DEFAULT_PREVIEW_WAIT: PreviewWait = { intervalMs: 15_000, attempts: 80 };

export class PreviewNotReady extends Schema.TaggedError<PreviewNotReady>()("PreviewNotReady", {
  sha: Schema.String,
  waitedMs: Schema.Number,
}) {
  override get message(): string {
    return `no preview for ${this.sha} reached a build's end within ${this.waitedMs} ms`;
  }
}

/** The head's preview once its record has settled, read on a schedule until it does or the budget ends. */
export function waitForPreview(
  source: PreviewSource,
  options: {
    readonly wait?: PreviewWait;
    /** Told each reading as it lands, so a log shows the wait rather than silence. */
    readonly onReading?: (reading: PreviewReading) => Effect.Effect<void>;
  } = {},
): Effect.Effect<
  Exclude<PreviewReading, { readonly kind: typeof PREVIEW_STATE.WAITING }>,
  PreviewNotReady | HttpClientError.HttpClientError | ParseError,
  HttpClient.HttpClient
> {
  const wait = options.wait ?? DEFAULT_PREVIEW_WAIT;
  const onReading = options.onReading ?? (() => Effect.void);
  return Effect.gen(function* () {
    const reading = yield* Effect.repeat(readPreview(source).pipe(Effect.tap(onReading)), {
      schedule: Schedule.identity<PreviewReading>().pipe(
        Schedule.zipLeft(Schedule.spaced(Duration.millis(wait.intervalMs))),
        Schedule.zipLeft(Schedule.recurs(wait.attempts)),
      ),
      until: (reading) => reading.kind !== PREVIEW_STATE.WAITING,
    });
    if (reading.kind === PREVIEW_STATE.WAITING) {
      return yield* new PreviewNotReady({
        sha: source.sha,
        waitedMs: wait.intervalMs * wait.attempts,
      });
    }
    return reading;
  });
}
