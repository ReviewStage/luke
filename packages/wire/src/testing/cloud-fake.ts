import type { CloudFetch } from "../http.js";
import { HTTP_STATUS, jsonResponse, type RecordedRequest, recordingFetch } from "./http-fake.js";
import type { JsonObject, JsonValue } from "./json.js";

/** What one route answers, and with which status. */
export interface FakeCloudRoute {
  readonly body: JsonValue | ((request: RecordedRequest) => JsonValue);
  readonly status?: number;
}

/** The status a healthy fake turns to when a test asks it to fail. */
const FAKE_FAILURE_STATUS = HTTP_STATUS.SERVER_ERROR;

export interface FakeCloudApi {
  readonly fetch: CloudFetch;
  /** Every request the fake saw, in order. */
  requests(): readonly RecordedRequest[];
  /** Every credential presented, in order, so a test can watch one replace another. */
  credentials(): readonly string[];
  /** From here on, answer this status for every route. */
  fail(status?: number): void;
  /** Answer normally again. */
  heal(): void;
}

const AUTHORIZATION_SCHEME_PREFIX = "Bearer ";

function isRoute(value: FakeCloudRoute | JsonValue): value is FakeCloudRoute {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "body" in value;
}

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

/**
 * A cloud provider's documented endpoints, as a table a fixture can hand over
 * whole: each key is `"<METHOD> <pathname>"`, and each value is either the
 * body that route answers or a {@link FakeCloudRoute} saying more about it.
 *
 * A request no key names throws rather than answering an empty body. That is
 * the point of the fake: an observation pass that reached for an endpoint the
 * build never fixed fails loudly, where an empty answer would let it read as
 * a provider that simply had nothing to report.
 */
export function fakeCloudApi(
  routes: Readonly<Record<string, FakeCloudRoute | JsonValue>>,
): FakeCloudApi {
  let failureStatus: number | undefined;
  const recording = recordingFetch((request) => {
    const key = routeKey(request.method, request.pathname);
    const entry = routes[key];
    if (entry === undefined) {
      throw new Error(`the fake cloud API has no route for ${key}`);
    }
    const route: FakeCloudRoute = isRoute(entry) ? entry : { body: entry };
    if (failureStatus !== undefined) return jsonResponse({}, failureStatus);
    const body = typeof route.body === "function" ? route.body(request) : route.body;
    return jsonResponse(body, route.status ?? HTTP_STATUS.OK);
  });
  return {
    fetch: recording.fetch,
    requests: () => recording.requests,
    credentials: () =>
      recording.requests
        .map((request) => request.authorization)
        .filter((value): value is string => value !== undefined)
        .map((value) =>
          value.startsWith(AUTHORIZATION_SCHEME_PREFIX)
            ? value.slice(AUTHORIZATION_SCHEME_PREFIX.length)
            : value,
        ),
    fail: (status = FAKE_FAILURE_STATUS) => {
      failureStatus = status;
    },
    heal: () => {
      failureStatus = undefined;
    },
  };
}

/** The requests one pass issued, as the golden line each is recorded on. */
export function recordedRoutes(requests: readonly RecordedRequest[]): readonly string[] {
  return requests.map((request) => {
    const query = [...request.searchParams.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    const route = routeKey(request.method, request.pathname);
    return query ? `${route}?${query}` : route;
  });
}

/** The JSON body a recorded write carried, for a test asserting the document. */
export function recordedBody(request: RecordedRequest): JsonObject | undefined {
  if (request.body === undefined) return undefined;
  // SAFETY: every fake route in this repository is handed a JSON body or none.
  return JSON.parse(request.body) as JsonObject;
}
