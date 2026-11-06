/**
 * vercel-sandbox-fake.ts -- what Vercel Sandbox's REST API refuses of a list, a stop, or a sandbox's tags before it answers one, how each call is answered to `@vercel/sandbox`, and the `fetch` the SDK sends through, for the suites that stand a fake of it.
 *
 * A fake that answers any query would have answered the `limit=100` every
 * real list was refused for, and a fake that answers any POST would have
 * answered the bodiless stop every real one was refused for with 415, so each
 * fake's list and stop asks this first and answers what it returns where it
 * returns anything.
 */

import { Layer } from "effect";
import { SandboxFetch } from "../agents/vercel-sandbox-api.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

/**
 * An unsigned token naming the fixture's project and team, with no expiry.
 * Note that it names none, because `@vercel/sandbox` reads the deployment's
 * token again before each request and refreshes one past its expiry, which
 * a fixed date would one day make it ask the network for.
 */
export function fixtureToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ project_id: PROJECT, owner_id: TEAM })).toString(
    "base64url",
  );
  return `${header}.${payload}.`;
}

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

/** A page of sandboxes as a list answers it, with the fields `@vercel/sandbox` checks. */
export function sandboxesListed<Listed extends ListedFake>(
  sandboxes: readonly Listed[],
  next: string | null = null,
) {
  return {
    sandboxes: sandboxes.map((sandbox) => sandboxDeleted(sandbox).sandbox),
    pagination: { count: sandboxes.length, next },
  };
}

/** A session as a stop, a policy write, an extension, or a snapshot answers it, with the fields `@vercel/sandbox` checks. */
export function sessionAnswered(session: {
  readonly id: string;
  readonly status: string;
  readonly createdAt?: number;
  readonly timeout?: number;
}) {
  return {
    session: sandboxFound({
      name: "",
      status: session.status,
      currentSessionId: session.id,
      createdAt: session.createdAt ?? 0,
      ...(session.timeout === undefined ? undefined : { timeout: session.timeout }),
    }).session,
  };
}

/** A command as Vercel names it, with the fields `@vercel/sandbox` checks. */
function commandOf(command: {
  readonly id: string;
  readonly sessionId: string;
  readonly exitCode: number | null;
}) {
  return {
    id: command.id,
    name: "",
    args: [],
    cwd: SESSION_SIZE.CWD,
    sessionId: command.sessionId,
    exitCode: command.exitCode,
    startedAt: 0,
  };
}

/** A command as a start, a read, a kill, or a stdin write answers it. */
export function commandAnswered(command: Parameters<typeof commandOf>[0], bytesWritten?: number) {
  return {
    command: commandOf(command),
    ...(bytesWritten === undefined ? undefined : { bytesWritten }),
  };
}

/** One line of a command's output as its stream carries it. */
interface OutputLine {
  readonly stream: "stdout" | "stderr";
  readonly data: string;
}

/** Lines of JSON as Vercel streams them, which `@vercel/sandbox` reads only under their own content type. */
function streamed(lines: readonly object[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    headers: { "content-type": "application/x-ndjson" },
  });
}

/** A command run to its end as a waiting run streams it: the command, what it printed, and the command again with its exit. */
export function commandRunStreamed(
  command: { readonly id: string; readonly sessionId: string },
  run: { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
): Response {
  const printed: OutputLine[] = [
    { stream: "stdout", data: run.stdout },
    { stream: "stderr", data: run.stderr },
  ];
  return streamed([
    { command: commandOf({ ...command, exitCode: null }) },
    ...printed.filter((line) => line.data !== ""),
    { command: commandOf({ ...command, exitCode: run.exitCode }) },
  ]);
}

/** What a command printed on stderr, as its logs stream it. */
export function commandLogsStreamed(stderr: string): Response {
  const printed: OutputLine[] = [{ stream: "stderr", data: stderr }];
  return streamed(printed.filter((line) => line.data !== ""));
}

/** A snapshot as a lookup, a list, or a session's snapshot answers it, with the fields `@vercel/sandbox` checks. */
export function snapshotOf(snapshot: {
  readonly id: string;
  readonly status: string;
  readonly sourceSessionId?: string;
}) {
  return {
    id: snapshot.id,
    sourceSessionId: snapshot.sourceSessionId ?? "",
    region: SESSION_SIZE.REGION,
    status: snapshot.status,
    sizeBytes: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A fake's responder as `fetch`. */
type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

/** `@vercel/sandbox`'s `fetch` over a fake's responder, which the `HttpClient` the fake stands behind answers through too. */
export function sandboxFetchOver(respond: Responder): Layer.Layer<never> {
  const send: typeof globalThis.fetch = (input, init) =>
    Promise.resolve(respond(input instanceof Request ? input.url : String(input), init ?? {}));
  return Layer.succeed(SandboxFetch, send);
}
