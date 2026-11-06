import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutTrailingSlash } from "@repo/wire";
import { Clock, Duration, Effect, Option, Redacted, Schedule, Schema } from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { checkApiCallers, PROBE_SEGMENT, RESOLUTION } from "./api-callers.js";

export const PROBE_DOOR = {
  BYPASS_SECRET: "bypass-secret",
  OPTIONS_ALLOWLIST: "options-allowlist",
} as const;
type ProbeDoor = (typeof PROBE_DOOR)[keyof typeof PROBE_DOOR];
export const ProbeDoorSchema = Schema.Literals([
  PROBE_DOOR.BYPASS_SECRET,
  PROBE_DOOR.OPTIONS_ALLOWLIST,
]);

const PROBE_METHOD = {
  GET: "GET",
  OPTIONS: "OPTIONS",
} as const;
type ProbeMethod = (typeof PROBE_METHOD)[keyof typeof PROBE_METHOD];

const METHOD_BY_DOOR = {
  [PROBE_DOOR.BYPASS_SECRET]: PROBE_METHOD.GET,
  [PROBE_DOOR.OPTIONS_ALLOWLIST]: PROBE_METHOD.OPTIONS,
} as const satisfies Readonly<Record<ProbeDoor, ProbeMethod>>;

const SITE_ROOT_PATH = "/";

const PROBE_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UPGRADE_REQUIRED: 426,
} as const;
const SERVER_ERROR_FLOOR = 500;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const UNKNOWN_API_PATH = "/api/nope";
const EXCEPTION_PATH = "/api/automations/probe/webhook";
const ROUTER_NOT_FOUND_BODY = '{"error":"not-found"}';

const EXPECTED_STATUS = {
  [PROBE_DOOR.BYPASS_SECRET]: new Map([
    [SITE_ROOT_PATH, PROBE_STATUS.OK],
    ["/api/plans", PROBE_STATUS.UNAUTHORIZED],
    ["/api/maintenance/sweep", PROBE_STATUS.UNAUTHORIZED],
    ["/api/events", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/terminal/sessions", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/browser/live", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/feedback", PROBE_STATUS.METHOD_NOT_ALLOWED],
    [EXCEPTION_PATH, PROBE_STATUS.METHOD_NOT_ALLOWED],
    [UNKNOWN_API_PATH, PROBE_STATUS.NOT_FOUND],
  ]),
  [PROBE_DOOR.OPTIONS_ALLOWLIST]: new Map([
    ["/api/plans", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/maintenance/sweep", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/events", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/feedback", PROBE_STATUS.METHOD_NOT_ALLOWED],
    [EXCEPTION_PATH, PROBE_STATUS.METHOD_NOT_ALLOWED],
    [UNKNOWN_API_PATH, PROBE_STATUS.NOT_FOUND],
  ]),
} satisfies Readonly<Record<ProbeDoor, ReadonlyMap<string, number>>>;

const EXPECTED_BODY: ReadonlyMap<string, string> = new Map([
  [UNKNOWN_API_PATH, ROUTER_NOT_FOUND_BODY],
]);

export interface PlannedRequest {
  readonly method: ProbeMethod;
  readonly path: string;
  readonly expected: number | undefined;
  readonly expectedBody: string | undefined;
}

interface ProbePaths {
  readonly callers: readonly string[];
  readonly crons: readonly string[];
}

export function planProbes(door: ProbeDoor, paths: ProbePaths): readonly PlannedRequest[] {
  const method = METHOD_BY_DOOR[door];
  const expected = EXPECTED_STATUS[door];
  const page = door === PROBE_DOOR.BYPASS_SECRET ? [SITE_ROOT_PATH] : [];
  const unique = new Set([...page, ...paths.callers, ...paths.crons, ...expected.keys()]);
  return [...unique].sort().map((path) => ({
    method,
    path,
    expected: expected.get(path),
    expectedBody: EXPECTED_BODY.get(path),
  }));
}

const VERCEL_CONFIG_FILE = "vercel.json";
const VercelCrons = Schema.Struct({
  crons: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(
    Schema.withDecodingDefaultType(Effect.succeed([])),
  ),
});
const decodeVercelCrons = Schema.decodeUnknownEffect(Schema.fromJsonString(VercelCrons));

export function readProbePaths(input: {
  readonly repoRoot: string;
  readonly web: string;
}): Effect.Effect<ProbePaths, Schema.SchemaError> {
  return Effect.gen(function* () {
    const report = yield* Effect.promise(() => checkApiCallers(input));
    const config = yield* decodeVercelCrons(
      yield* Effect.promise(() => readFile(join(input.repoRoot, VERCEL_CONFIG_FILE), "utf8")),
    );
    return {
      callers: report.resolved.map((entry) =>
        entry.resolution === RESOLUTION.PREFIX
          ? `${withoutTrailingSlash(entry.caller.probe)}/${PROBE_SEGMENT}`
          : entry.caller.probe,
      ),
      crons: config.crons.map((cron) => cron.path),
    };
  });
}

export const VERDICT = {
  OK: "ok",
  PROTECTED: "protected",
  PLATFORM_ERROR: "platform-error",
  SERVER_ERROR: "server-error",
  UNEXPECTED_STATUS: "unexpected-status",
  UNEXPECTED_BODY: "unexpected-body",
} as const;
export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

const HEADER = {
  CACHE_CONTROL: "cache-control",
  LOCATION: "location",
  VERCEL_ERROR: "x-vercel-error",
  BYPASS: "x-vercel-protection-bypass",
} as const;
const NO_CACHE = "no-cache";
const CACHE_BUSTER = "nocache";
const VERCEL_SSO = { host: "vercel.com", pathname: "/sso-api" } as const;

interface ProbeAnswer {
  readonly status: number;
  readonly vercelError: Option.Option<string>;
  readonly location: Option.Option<string>;
  readonly body: Option.Option<string>;
}

function redirectsToVercelSso(answer: ProbeAnswer): boolean {
  if (!REDIRECT_STATUSES.has(answer.status) || Option.isNone(answer.location)) return false;
  if (!URL.canParse(answer.location.value)) return false;
  const target = new URL(answer.location.value);
  return target.host === VERCEL_SSO.host && target.pathname === VERCEL_SSO.pathname;
}

function judge(request: PlannedRequest, answer: ProbeAnswer): Verdict {
  if (redirectsToVercelSso(answer)) return VERDICT.PROTECTED;
  if (Option.isSome(answer.vercelError)) return VERDICT.PLATFORM_ERROR;
  if (answer.status >= SERVER_ERROR_FLOOR) return VERDICT.SERVER_ERROR;
  if (request.expected !== undefined && answer.status !== request.expected) {
    return VERDICT.UNEXPECTED_STATUS;
  }
  if (
    request.expectedBody !== undefined &&
    Option.getOrUndefined(answer.body) !== request.expectedBody
  ) {
    return VERDICT.UNEXPECTED_BODY;
  }
  return VERDICT.OK;
}

interface ProbeResult extends PlannedRequest {
  readonly status: number;
  readonly vercelError: string | undefined;
  readonly verdict: Verdict;
}

export interface ProbeTarget {
  readonly address: string;
  readonly bypassSecret: Option.Option<Redacted.Redacted<string>>;
}

export interface ProbeReport {
  readonly door: ProbeDoor;
  readonly address: string;
  readonly results: readonly ProbeResult[];
}

export const PROBE_REQUEST_INIT: RequestInit = { redirect: "manual" };

export const TRANSPORT_RETRY = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.upTo({ times: 3 }),
);
const PROBE_CONCURRENCY = 4;

function probeRequest(
  target: ProbeTarget,
  planned: PlannedRequest,
  buster: string,
): HttpClientRequest.HttpClientRequest {
  const url = new URL(planned.path, target.address);
  url.searchParams.set(CACHE_BUSTER, buster);
  const request = HttpClientRequest.make(planned.method)(url).pipe(
    HttpClientRequest.setHeader(HEADER.CACHE_CONTROL, NO_CACHE),
  );
  return Option.match(target.bypassSecret, {
    onNone: () => request,
    onSome: (secret) => HttpClientRequest.setHeader(HEADER.BYPASS, Redacted.value(secret))(request),
  });
}

export const probeDeployment = /* @__PURE__ */ Effect.fn("web/probeDeployment")(function* (
  target: ProbeTarget,
  task: readonly PlannedRequest[],
): Effect.fn.Return<
  readonly ProbeResult[],
  HttpClientError.HttpClientError,
  HttpClient.HttpClient
> {
  const client = yield* HttpClient.HttpClient;
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.forEach(
    task,
    (planned, index) =>
      client.execute(probeRequest(target, planned, `${now}-${index}`)).pipe(
        Effect.flatMap((response) =>
          planned.expectedBody === undefined
            ? Effect.succeed({ response, body: Option.none<string>() })
            : Effect.map(response.text, (text) => ({ response, body: Option.some(text) })),
        ),
        Effect.map(({ response, body }): ProbeResult => {
          const answer: ProbeAnswer = {
            status: response.status,
            vercelError: Headers.get(response.headers, HEADER.VERCEL_ERROR),
            location: Headers.get(response.headers, HEADER.LOCATION),
            body,
          };
          return {
            ...planned,
            status: answer.status,
            vercelError: Option.getOrUndefined(answer.vercelError),
            verdict: judge(planned, answer),
          };
        }),
        Effect.scoped,
        Effect.retry({
          schedule: TRANSPORT_RETRY,
          while: (error) => error.response === undefined,
        }),
      ),
    { concurrency: PROBE_CONCURRENCY },
  );
});

export function probeFailures(report: ProbeReport): readonly ProbeResult[] {
  return report.results.filter((result) => result.verdict !== VERDICT.OK);
}
