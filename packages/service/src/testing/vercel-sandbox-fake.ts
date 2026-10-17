/**
 * vercel-sandbox-fake.ts -- what Vercel Sandbox's REST API refuses of a list or a stop before it answers one, for the suites that stand a fake of it.
 *
 * A fake that answers any query would have answered the `limit=100` every
 * real list was refused for, and a fake that answers any POST would have
 * answered the bodiless stop every real one was refused for with 415, so
 * each fake's list and stop asks this first and answers what it returns
 * where it returns anything.
 */

/** `GET /v2/sandboxes`'s bounds on `limit`, as Vercel's REST reference states them. */
const LIST_LIMIT = { MIN: 1, MAX: 50 } as const;

/** Vercel's answer to a query value it does not take. */
const INVALID_QUERY_STATUS = 400;

/** Vercel's answer to a POST that is not JSON. */
const UNSUPPORTED_MEDIA_TYPE_STATUS = 415;

const JSON_MEDIA_TYPE = "application/json";

/** The 400 Vercel answers a list whose query it refuses, or nothing where it would answer the list. */
export function sandboxListRefusal(url: URL): Response | undefined {
  const limit = url.searchParams.get("limit");
  if (limit === null) return undefined;
  const asked = Number(limit);
  if (Number.isInteger(asked) && asked >= LIST_LIMIT.MIN && asked <= LIST_LIMIT.MAX) {
    return undefined;
  }
  return Response.json(
    { error: { code: "bad_request", message: "Invalid request: `limit` out of range" } },
    { status: INVALID_QUERY_STATUS },
  );
}

/** The 415 Vercel answers a stop not sent as JSON, or nothing where it would answer the stop. */
export function sandboxStopRefusal(init: RequestInit): Response | undefined {
  const type = new Headers(init.headers).get("content-type") ?? "";
  if (type.split(";")[0]?.trim().toLowerCase() === JSON_MEDIA_TYPE) return undefined;
  return Response.json(
    { error: { code: "unsupported_media_type", message: "Unsupported Media Type" } },
    { status: UNSUPPORTED_MEDIA_TYPE_STATUS },
  );
}
