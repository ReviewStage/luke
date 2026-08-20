import assert from "node:assert/strict";
import { HTTP_STATUS as BOUNDARY_HTTP_STATUS, type CloudFetch } from "../http.js";
import type { JsonValue } from "./json.js";

/**
 * Statuses a fake answers with, plus the ones product code names, so a test
 * never restates 401. `OK` and `SERVER_ERROR` are what a route table returns;
 * the rest are the failures the boundary already branches on.
 */
export const HTTP_STATUS = {
  OK: 200,
  ...BOUNDARY_HTTP_STATUS,
  // Named by the OAuth tests, which treat it as transient alongside 408.
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
} as const;

/**
 * One recorded fetch, with the URL and headers already parsed. Provider tests
 * that need a header of their own — Jules's API key, GitHub's version pin —
 * read it from `headers`; everything else is here because every fake asked
 * for it.
 */
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

/** The body as sent, when it was sent as text; a test records nothing else. */
export function requestBody(body: BodyInit | null | undefined): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (Object.prototype.toString.call(body) !== "[object String]") return undefined;
  // SAFETY: Object.prototype.toString confirmed a string body before recording.
  return body as string;
}

/**
 * A fetch that records every call, then answers through `respond`. The
 * per-provider route table is `respond`; this only keeps the log.
 */
export function recordingFetch(
  respond: (request: RecordedRequest) => Response | Promise<Response>,
) {
  const requests: RecordedRequest[] = [];
  const fetch: CloudFetch = async (url, init) => {
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
  };
  return { fetch, requests };
}

/**
 * The recorded request at `index`. A test that has already asserted how many
 * calls were made still cannot convince the type checker that an indexed read
 * found one, so the check lives here and fails as a test rather than as a
 * `possibly undefined` on every assertion that follows.
 */
export function recordedRequest(requests: readonly RecordedRequest[], index = 0): RecordedRequest {
  const request = requests[index];
  assert.ok(request, `no request was recorded at index ${index}`);
  return request;
}
