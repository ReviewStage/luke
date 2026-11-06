import type { Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "./http-fake.js";
import type { JsonValue } from "./json.js";

export interface FakeCloudRoute {
  readonly answer: (request: RecordedRequest) => JsonValue;
  readonly status?: number;
}

const FAKE_FAILURE_STATUS = HTTP_STATUS.SERVER_ERROR;

export interface FakeCloudApi {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  requests(): readonly RecordedRequest[];
  credentials(): readonly string[];
  fail(status?: number): void;
  heal(): void;
}

const AUTHORIZATION_SCHEME_PREFIX = "Bearer ";

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

export function fakeCloudApi(routes: Readonly<Record<string, FakeCloudRoute>>): FakeCloudApi {
  let failureStatus: number | undefined;
  const recording = recordingHttpClient((request) => {
    const key = routeKey(request.method, request.pathname);
    const route = routes[key];
    if (route === undefined) {
      throw new Error(`the fake cloud API has no route for ${key}`);
    }
    if (failureStatus !== undefined) return jsonResponse({}, failureStatus);
    return jsonResponse(route.answer(request), route.status ?? HTTP_STATUS.OK);
  });
  return {
    layer: recording.layer,
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
