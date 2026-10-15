/**
 * vercel-sandbox-fake.ts -- what Vercel Sandbox's REST API refuses of a list before it answers one, for the suites that stand a fake of it.
 *
 * A fake that answers any query would have answered the `limit=100` every
 * real list was refused for, so each fake's list asks this first and
 * answers what it returns where it returns anything.
 */

/** `GET /v2/sandboxes`'s bounds on `limit`, as Vercel's REST reference states them. */
const LIST_LIMIT = { MIN: 1, MAX: 50 } as const;

/** Vercel's answer to a query value it does not take. */
const INVALID_QUERY_STATUS = 400;

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
