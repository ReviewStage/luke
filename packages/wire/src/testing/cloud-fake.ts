import type * as HttpClient from "@effect/platform/HttpClient";
import type { Layer } from "effect";
import { layerFromCloudFetch } from "../effect/http.js";
import type { CloudFetch } from "../json.js";
import { HTTP_STATUS, jsonResponse, type RecordedRequest, recordingFetch } from "./http-fake.js";
import type { JsonValue } from "./json.js";

/**
 * What one route answers. The answer is a function of the request rather than
 * a value, because a documented endpoint that pages answers windows of what it
 * holds; a route with nothing to vary on ignores its argument.
 */
export interface FakeCloudRoute {
  readonly answer: (request: RecordedRequest) => JsonValue;
  readonly status?: number;
}

/** The status a healthy fake turns to when a test asks it to fail. */
const FAKE_FAILURE_STATUS = HTTP_STATUS.SERVER_ERROR;

export interface FakeCloudApi {
  readonly fetch: CloudFetch;
  /**
   * The same fake as the `HttpClient` an Effect caller takes, so a test over a
   * migrated client hands the layer where it used to hand the fetch and reads
   * the requests back from the same recorder.
   */
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
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
export function fakeCloudApi(routes: Readonly<Record<string, FakeCloudRoute>>): FakeCloudApi {
  let failureStatus: number | undefined;
  const recording = recordingFetch((request) => {
    const key = routeKey(request.method, request.pathname);
    const route = routes[key];
    if (route === undefined) {
      throw new Error(`the fake cloud API has no route for ${key}`);
    }
    if (failureStatus !== undefined) return jsonResponse({}, failureStatus);
    return jsonResponse(route.answer(request), route.status ?? HTTP_STATUS.OK);
  });
  return {
    fetch: recording.fetch,
    layer: layerFromCloudFetch(recording.fetch),
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
