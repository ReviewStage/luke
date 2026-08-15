import { HTTP_STATUS as CLOUD_HTTP_STATUS, type CloudFetch } from "../../src/cloud-session-adapter";

/**
 * Statuses a fake answers with, plus the ones product code names, so a test
 * never restates 401. `OK` and `SERVER_ERROR` are what a route table returns;
 * the rest are the failures the adapter already branches on.
 */
export const HTTP_STATUS = {
  OK: 200,
  ...CLOUD_HTTP_STATUS,
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

export function jsonResponse(body: unknown, status = HTTP_STATUS.OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function header(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

/**
 * A fetch that records every call, then answers through `respond`. The
 * per-provider route table is `respond`; this only keeps the log.
 */
export function recordingFetch(
  respond: (request: RecordedRequest) => Response | Promise<Response>,
): { fetch: CloudFetch; requests: RecordedRequest[] } {
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
      body: typeof init.body === "string" ? init.body : undefined,
      headers,
      init,
    };
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}
