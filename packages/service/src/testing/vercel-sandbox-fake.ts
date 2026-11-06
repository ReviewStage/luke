import { Layer } from "effect";
import { SandboxFetch } from "../agents/vercel-sandbox-api.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

export function fixtureToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ project_id: PROJECT, owner_id: TEAM })).toString(
    "base64url",
  );
  return `${header}.${payload}.`;
}

const LIST_LIMIT = { MIN: 1, MAX: 50 } as const;

const TAG_LIMIT = 5;

const INVALID_QUERY_STATUS = 400;

const UNSUPPORTED_MEDIA_TYPE_STATUS = 415;

const JSON_MEDIA_TYPE = "application/json";

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

export function sandboxStopRefusal(init: RequestInit): Response | undefined {
  const type = new Headers(init.headers).get("content-type") ?? "";
  if (type.split(";")[0]?.trim().toLowerCase() === JSON_MEDIA_TYPE) return undefined;
  return Response.json(
    { error: { code: "unsupported_media_type", message: "Unsupported Media Type" } },
    { status: UNSUPPORTED_MEDIA_TYPE_STATUS },
  );
}

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

const SESSION_SIZE = {
  MEMORY_MB: 4096,
  VCPUS: 2,
  REGION: "iad1",
  CWD: "/vercel/sandbox",
} as const;

interface ListedFake {
  readonly name: string;
  readonly status: string;
  readonly currentSessionId: string;
  readonly createdAt: number;
  readonly timeout?: number;
}

export function sandboxDeleted<Listed extends ListedFake>(listed: Listed) {
  return { sandbox: { ...listed, persistent: true, updatedAt: listed.createdAt } };
}

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

export function sandboxesListed<Listed extends ListedFake>(
  sandboxes: readonly Listed[],
  next: string | null = null,
) {
  return {
    sandboxes: sandboxes.map((sandbox) => sandboxDeleted(sandbox).sandbox),
    pagination: { count: sandboxes.length, next },
  };
}

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

export function commandAnswered(command: Parameters<typeof commandOf>[0], bytesWritten?: number) {
  return {
    command: commandOf(command),
    ...(bytesWritten === undefined ? undefined : { bytesWritten }),
  };
}

interface OutputLine {
  readonly stream: "stdout" | "stderr";
  readonly data: string;
}

function streamed(lines: readonly object[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    headers: { "content-type": "application/x-ndjson" },
  });
}

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

export function commandLogsStreamed(stderr: string): Response {
  const printed: OutputLine[] = [{ stream: "stderr", data: stderr }];
  return streamed(printed.filter((line) => line.data !== ""));
}

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

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

export function sandboxFetchOver(respond: Responder): Layer.Layer<never> {
  const send: typeof globalThis.fetch = (input, init) =>
    Promise.resolve(respond(input instanceof Request ? input.url : String(input), init ?? {}));
  return Layer.succeed(SandboxFetch, send);
}
