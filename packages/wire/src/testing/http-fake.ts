import assert from "node:assert/strict";
import type { Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { HTTP_STATUS as BOUNDARY_HTTP_STATUS } from "../json.js";
import { fakeHttpClientLayer } from "./http-client-fake.js";
import type { JsonValue } from "./json.js";

export const HTTP_STATUS = {
  OK: 200,
  ...BOUNDARY_HTTP_STATUS,
  BAD_REQUEST: 400,
  SERVER_ERROR: 500,
} as const;

export interface RecordedRequest {
  method: string;
  url: string;
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  authorization: string | undefined;
  accept: string | undefined;
  contentType: string | undefined;
  body: string | undefined;
  headers: Headers;
  init: RequestInit;
}

export function jsonResponse(body: JsonValue, status: number = HTTP_STATUS.OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function header(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

function requestBody(body: BodyInit | null | undefined): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (Object.prototype.toString.call(body) !== "[object String]") return undefined;
  return body as string;
}

export interface RecordingHttpClient {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  readonly requests: readonly RecordedRequest[];
}

export function recordingHttpClient(
  respond: (request: RecordedRequest) => Response | Promise<Response>,
): RecordingHttpClient {
  const requests: RecordedRequest[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    const parsed = new URL(url);
    const headers = new Headers(init.headers);
    const request: RecordedRequest = {
      method: init.method ?? "",
      url,
      pathname: parsed.pathname,
      search: parsed.search,
      searchParams: parsed.searchParams,
      authorization: header(headers, "authorization"),
      accept: header(headers, "accept"),
      contentType: header(headers, "content-type"),
      body: requestBody(init.body),
      headers,
      init,
    };
    requests.push(request);
    return respond(request);
  });
  return { layer, requests };
}

export function recordedRequest(requests: readonly RecordedRequest[], index = 0): RecordedRequest {
  const request = requests[index];
  assert.ok(request, `no request was recorded at index ${index}`);
  return request;
}
