/**
 * vercel-sandbox-fake.ts -- what Vercel Sandbox's REST API refuses of a list, a stop, or a sandbox's tags before it answers one, and how a lookup and a delete are answered to `@vercel/sandbox`, for the suites that stand a fake of it.
 *
 * A fake that answers any query would have answered the `limit=100` every
 * real list was refused for, and a fake that answers any POST would have
 * answered the bodiless stop every real one was refused for with 415, and one
 * that answers a name prefix under any sort would have answered the list every
 * template sweep was refused for, so
 * each fake's list and stop asks this first and answers what it returns
 * where it returns anything.
 */

import { Layer } from "effect";
import { SandboxFetch } from "../agents/vercel-sandbox-api.js";

/** `GET /v2/sandboxes`'s bounds on `limit`, as Vercel's REST reference states them. */
const LIST_LIMIT = { MIN: 1, MAX: 50 } as const;

/** How many tags Vercel takes on a sandbox, as its create and its update answer past it. */
const TAG_LIMIT = 5;

/** Vercel's answer to a query value or a body it does not take. */
const INVALID_QUERY_STATUS = 400;

/** Vercel's answer to a POST that is not JSON. */
const UNSUPPORTED_MEDIA_TYPE_STATUS = 415;

const JSON_MEDIA_TYPE = "application/json";

/** The 400 Vercel answers a list whose query it refuses, or nothing where it would answer the list. */
export function sandboxListRefusal(url: URL): Response | undefined {
  if (url.searchParams.has("namePrefix") && url.searchParams.get("sortBy") !== "name") {
    return Response.json(
      { error: { code: "bad_request", message: "namePrefix is only valid when sortBy is name" } },
      { status: INVALID_QUERY_STATUS },
    );
  }
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

/** The 400 Vercel answers a create or an update asking more tags than a sandbox takes, or nothing where it would take them. */
export function sandboxTagsRefusal(
  tags: Readonly<Record<string, string>> | undefined,
): Response | undefined {
  if (tags === undefined || Object.keys(tags).length <= TAG_LIMIT) return undefined;
  return Response.json(
    {
      error: {
        code: "bad_request",
        message: `Invalid request: \`tags\` should NOT have more than ${TAG_LIMIT} properties.`,
      },
    },
    { status: INVALID_QUERY_STATUS },
  );
}

/** The size, place, and working directory every faked session reports, which nothing reads beyond `@vercel/sandbox`'s check of its answers. */
const SESSION_SIZE = {
  MEMORY_MB: 4096,
  VCPUS: 2,
  REGION: "iad1",
  CWD: "/vercel/sandbox",
} as const;

/** A sandbox as a fake's list names it: what a lookup's and a delete's answers are built from. */
interface ListedFake {
  readonly name: string;
  readonly status: string;
  readonly currentSessionId: string;
  readonly createdAt: number;
  readonly timeout?: number;
}

/** A sandbox as a delete answers it, with the fields `@vercel/sandbox` checks beside those a list names. */
export function sandboxDeleted<Listed extends ListedFake>(listed: Listed) {
  return { sandbox: { ...listed, persistent: true, updatedAt: listed.createdAt } };
}

/** A sandbox and its current session as a lookup answers them, with the fields `@vercel/sandbox` checks. */
export function sandboxFound<Listed extends ListedFake>(listed: Listed) {
  return {
    ...sandboxDeleted(listed),
    session: {
      id: listed.currentSessionId,
      memory: SESSION_SIZE.MEMORY_MB,
      vcpus: SESSION_SIZE.VCPUS,
      region: SESSION_SIZE.REGION,
      timeout: listed.timeout ?? 0,
      status: listed.status,
      requestedAt: listed.createdAt,
      createdAt: listed.createdAt,
      cwd: SESSION_SIZE.CWD,
      updatedAt: listed.createdAt,
    },
    routes: [],
  };
}

/** `@vercel/sandbox`'s `fetch` over a fake's responder, which the `HttpClient` the fake stands behind answers through too. */
export function sandboxFetchOver(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): Layer.Layer<never> {
  return Layer.succeed(SandboxFetch, (input, init) =>
    Promise.resolve(respond(String(input), init ?? {})),
  );
}
