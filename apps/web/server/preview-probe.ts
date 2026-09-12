import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Headers from "@effect/platform/Headers";
import * as HttpClient from "@effect/platform/HttpClient";
import type * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { withoutTrailingSlash } from "@sidecar/wire";
import { Clock, Duration, Effect, Option, Redacted, Schedule, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import { checkApiCallers, PROBE_SEGMENT, RESOLUTION } from "./api-callers.js";

/**
 * The deployed shape, read from a deployment's own answers. On 2026-09-11
 * five production deploys failed in a row while every PR was green, because
 * nothing in CI could see what Vercel had built: the Framework Preset and
 * `vercel.json`'s `services` key must agree, and only a deployment shows
 * whether they did. A deployment distinguishes the states — a services build
 * serves eve at `/eve/v1/health` and every `/api/` function; the single-app
 * build answers `NOT_FOUND` for eve; a preset without the key fails to build
 * at all — so this sends one the requests the Services preset sitting runbook
 * probes by hand: every `/api/` path a client in the repository spells
 * (`api-callers.ts` derives the list; nothing here re-enumerates it), the
 * cron's path, the page, and eve's health, each cache-busted.
 *
 * What a probe asserts is a value, never prose. A handler that is present
 * answers with its own refusal (401, 405, 426, or its own 404, as better-auth
 * gives an unknown sub-route); a function Vercel did not build answers with
 * Vercel's own `NOT_FOUND`, and the platform marks every answer of its own
 * with an `x-vercel-error` header a function's answer never carries. That
 * header is the discriminator, so the whole derived list can be judged
 * without a table of codes, and the runbook's eight requests keep their exact
 * codes on top.
 *
 * A preview is behind Deployment Protection, and a stranger's request is
 * redirected to Vercel's SSO. Two project settings open a way through, and
 * which one stands is the door: Protection Bypass for Automation, a secret
 * sent as a header, which lets the probe send GET exactly as the call sites
 * do; or the OPTIONS Allowlist over `/api` and `/eve`, which lets an
 * unauthenticated OPTIONS through and needs no secret anywhere, at the cost
 * of asserting the preflight's refusal rather than the GET's. A redirect to
 * the SSO is reported as the protection answering, never as the deployment.
 */

/** Which project setting the probe relies on to get past Deployment Protection, and so which method it sends. */
export const PROBE_DOOR = {
  /** Protection Bypass for Automation: GET as each call site spells it, the secret in `x-vercel-protection-bypass`. */
  BYPASS_SECRET: "bypass-secret",
  /** OPTIONS Allowlist over `/api` and `/eve`: an OPTIONS the allowlist lets through with no credential at all. */
  OPTIONS_ALLOWLIST: "options-allowlist",
} as const;
export type ProbeDoor = (typeof PROBE_DOOR)[keyof typeof PROBE_DOOR];
export const ProbeDoorSchema = Schema.Literal(
  PROBE_DOOR.BYPASS_SECRET,
  PROBE_DOOR.OPTIONS_ALLOWLIST,
);

export const PROBE_METHOD = {
  GET: "GET",
  OPTIONS: "OPTIONS",
} as const;
type ProbeMethod = (typeof PROBE_METHOD)[keyof typeof PROBE_METHOD];

const METHOD_BY_DOOR = {
  [PROBE_DOOR.BYPASS_SECRET]: PROBE_METHOD.GET,
  [PROBE_DOOR.OPTIONS_ALLOWLIST]: PROBE_METHOD.OPTIONS,
} as const satisfies Readonly<Record<ProbeDoor, ProbeMethod>>;

export const SITE_ROOT_PATH = "/";
/**
 * eve's own `EVE_HEALTH_ROUTE_PATH`, which the package keeps off its public
 * exports; `vercel.json`'s `/eve/v1/(.*)` rewrite is what lands it on the
 * eve service, so its answer is the eve service being served.
 */
export const EVE_HEALTH_PATH = "/eve/v1/health";

export const PROBE_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  METHOD_NOT_ALLOWED: 405,
  UPGRADE_REQUIRED: 426,
} as const;
const SERVER_ERROR_FLOOR = 500;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * The runbook's eight requests, the page, and eve's health, each with the
 * status production answered on 2026-09-12: a 401, 405, or 426 is the handler
 * present and refusing the caller, which is what a probe with no credential
 * should see. The OPTIONS door meets the same handlers' preflight refusals;
 * the page is not on it, because the allowlist is a prefix and `/` would
 * unprotect every OPTIONS on the deployment, and eve's health answers OPTIONS
 * with its own 404, which the discriminator below already reads as eve.
 */
export const EXPECTED_STATUS = {
  [PROBE_DOOR.BYPASS_SECRET]: new Map([
    [SITE_ROOT_PATH, PROBE_STATUS.OK],
    ["/api/brain/capabilities", PROBE_STATUS.UNAUTHORIZED],
    ["/api/observation/tick", PROBE_STATUS.UNAUTHORIZED],
    ["/api/devices", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/brain/ask", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/voice/sessions", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/voice/introduction", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/feedback", PROBE_STATUS.METHOD_NOT_ALLOWED],
    [EVE_HEALTH_PATH, PROBE_STATUS.OK],
  ]),
  [PROBE_DOOR.OPTIONS_ALLOWLIST]: new Map([
    ["/api/brain/capabilities", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/observation/tick", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/devices", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/brain/ask", PROBE_STATUS.METHOD_NOT_ALLOWED],
    ["/api/voice/sessions", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/voice/introduction", PROBE_STATUS.UPGRADE_REQUIRED],
    ["/api/feedback", PROBE_STATUS.METHOD_NOT_ALLOWED],
  ]),
} satisfies Readonly<Record<ProbeDoor, ReadonlyMap<string, number>>>;

export interface PlannedRequest {
  readonly method: ProbeMethod;
  readonly path: string;
  /** The exact status the table above names, or none: then any answer of the deployment's own is accepted. */
  readonly expected: number | undefined;
}

/** The paths a deployment is asked for, from the two places callers are written down. */
export interface ProbePaths {
  /**
   * Every `/api/` path a client builds, an interpolated id stood in for by the
   * callers check's probe segment, and a base other segments are appended to
   * probed one segment below, as the check matches it: the base itself is no
   * route, and Vercel answers it with its own `NOT_FOUND`.
   */
  readonly callers: readonly string[];
  /** The paths `vercel.json`'s `crons` call. */
  readonly crons: readonly string[];
}

/** The requests for one door, each path once, in a fixed order so two reports of one deployment read alike. */
export function planProbes(door: ProbeDoor, paths: ProbePaths): readonly PlannedRequest[] {
  const method = METHOD_BY_DOOR[door];
  const expected = EXPECTED_STATUS[door];
  const page = door === PROBE_DOOR.BYPASS_SECRET ? [SITE_ROOT_PATH] : [];
  const unique = new Set([...page, ...paths.callers, ...paths.crons, EVE_HEALTH_PATH]);
  return [...unique].sort().map((path) => ({ method, path, expected: expected.get(path) }));
}

const VERCEL_CONFIG_FILE = "vercel.json";
const VercelCrons = Schema.Struct({
  crons: Schema.optionalWith(Schema.Array(Schema.Struct({ path: Schema.String })), {
    default: () => [],
  }),
});
const decodeVercelCrons = Schema.decodeUnknown(Schema.parseJson(VercelCrons));

/** The caller paths of the checkout, read the way the callers check reads them, and the cron paths of its `vercel.json`. */
export function readProbePaths(input: {
  readonly repoRoot: string;
  readonly web: string;
}): Effect.Effect<ProbePaths, ParseError> {
  return Effect.gen(function* () {
    const report = yield* Effect.promise(() => checkApiCallers(input));
    const config = yield* decodeVercelCrons(
      yield* Effect.promise(() => readFile(join(input.web, VERCEL_CONFIG_FILE), "utf8")),
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
  /** The deployment's own handler answered, with the expected status where the table names one. */
  OK: "ok",
  /** Deployment Protection answered with its redirect to Vercel's SSO; the door named is not open. */
  PROTECTED: "protected",
  /** Vercel answered for itself (`x-vercel-error`): no function stands at the path, or the one there could not run. */
  PLATFORM_ERROR: "platform-error",
  /** A function answered with a 5xx of its own: deployed, and broken. */
  SERVER_ERROR: "server-error",
  /** A handler answered, but not with the status the table names for this path. */
  UNEXPECTED_STATUS: "unexpected-status",
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
/** Where Vercel Authentication sends a stranger; a redirect there is the protection answering, not the deployment. */
const VERCEL_SSO = { host: "vercel.com", pathname: "/sso-api" } as const;

/** What a probe reads of an answer: the status and the two headers that decide whose answer it is. */
export interface ProbeAnswer {
  readonly status: number;
  readonly vercelError: Option.Option<string>;
  readonly location: Option.Option<string>;
}

function redirectsToVercelSso(answer: ProbeAnswer): boolean {
  if (!REDIRECT_STATUSES.has(answer.status) || Option.isNone(answer.location)) return false;
  if (!URL.canParse(answer.location.value)) return false;
  const target = new URL(answer.location.value);
  return target.host === VERCEL_SSO.host && target.pathname === VERCEL_SSO.pathname;
}

export function judge(request: PlannedRequest, answer: ProbeAnswer): Verdict {
  if (redirectsToVercelSso(answer)) return VERDICT.PROTECTED;
  if (Option.isSome(answer.vercelError)) return VERDICT.PLATFORM_ERROR;
  if (answer.status >= SERVER_ERROR_FLOOR) return VERDICT.SERVER_ERROR;
  if (request.expected !== undefined && answer.status !== request.expected) {
    return VERDICT.UNEXPECTED_STATUS;
  }
  return VERDICT.OK;
}

export interface ProbeResult extends PlannedRequest {
  readonly status: number;
  readonly vercelError: string | undefined;
  readonly verdict: Verdict;
}

export interface ProbeTarget {
  /** The deployment's origin, as the deployment record or the developer named it. */
  readonly address: string;
  /** The bypass secret, sent on every probe when the door is the secret's; none under the OPTIONS door. */
  readonly bypassSecret: Option.Option<Redacted.Redacted<string>>;
}

export interface ProbeReport {
  readonly door: ProbeDoor;
  readonly address: string;
  readonly results: readonly ProbeResult[];
}

/**
 * What the runtime edge hands `FetchHttpClient`: a redirect is read, never
 * followed, because the protection's redirect is an answer to judge and a
 * followed one would land on Vercel's sign-in page as a 200 of nobody's.
 */
export const PROBE_REQUEST_INIT: RequestInit = { redirect: "manual" };

/** A dropped connection is retried a few times; an answer, whatever its status, is never retried. */
const TRANSPORT_RETRY = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.intersect(Schedule.recurs(3)),
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

/** Every planned request sent to the target and judged; the answer's body is never read. */
export function probeDeployment(
  target: ProbeTarget,
  plan: readonly PlannedRequest[],
): Effect.Effect<readonly ProbeResult[], HttpClientError.HttpClientError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const now = yield* Clock.currentTimeMillis;
    return yield* Effect.forEach(
      plan,
      (planned, index) =>
        client.execute(probeRequest(target, planned, `${now}-${index}`)).pipe(
          Effect.map((response): ProbeResult => {
            const answer: ProbeAnswer = {
              status: response.status,
              vercelError: Headers.get(response.headers, HEADER.VERCEL_ERROR),
              location: Headers.get(response.headers, HEADER.LOCATION),
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
            while: (error) => error._tag === "RequestError",
          }),
        ),
      { concurrency: PROBE_CONCURRENCY },
    );
  });
}

export function probeFailures(report: ProbeReport): readonly ProbeResult[] {
  return report.results.filter((result) => result.verdict !== VERDICT.OK);
}
