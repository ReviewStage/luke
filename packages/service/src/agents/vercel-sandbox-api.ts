/**
 * vercel-sandbox-api.ts -- the few calls Luke makes of Vercel Sandbox's REST API itself, under the deployment's own OIDC token.
 *
 * eve opens and drives each session's sandbox through the SDK it bundles,
 * and hands Luke's own code no handle to it. What Luke asks of a sandbox
 * outside an eve tool — a retired session's sandboxes deleted, a sandbox no
 * terminal holds stopped, a developer's resume, a short command for a
 * terminal's list, a terminal's PTY, the GitHub credential at its firewall —
 * it asks here, of the calls that SDK's `APIClient` makes (`@vercel/sandbox`
 * 3.3.0, the copy eve 0.74.0 bundles: re-read `listSandboxes`, `getSandbox`,
 * `deleteSandbox`, `stopSession`, `runCommand`, `openInteractive`, and
 * `updateNetworkPolicy` when it moves; `readFile` is Vercel's documented
 * `fs/read`), directly rather than through the SDK,
 * because
 * the SDK bundled into a function fails it as it loads and carries a dozen
 * Node modules these calls never use.
 *
 * A native harness's sandbox is the one sandbox Luke opens itself rather
 * than eve, so its calls are copied from the SDK's 3.8.0 client, the first
 * with stdin on a detached command: the create from a snapshot, a file
 * upload, a detached command started with its stdin held open, a write to
 * that stdin, a command's state, its kill, and a sandbox's tags updated;
 * and, for Luke's own template of that sandbox's image
 * (`native-sandbox-template.ts`), a sandbox looked up and listed by name,
 * one created on an image, and a running session snapshotted.
 *
 * Every sandbox eve opens carries its session's id as a tag, so a session's
 * sandbox is found by the tag alone; a session has one, so the first page is
 * all of them. What is sent is a tag, a name, and the argv of a command Luke
 * wrote; what a failure carries is its status alone. A deployment without an
 * OIDC token answers every call as unavailable.
 */

import { gzipSync } from "node:zlib";
import { readEither } from "@luke/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { Data, Effect, Redacted, Result, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";

/** The tag eve sets on every session's sandbox, its value the session's id; a sandbox Luke opens itself carries it too. */
export const SESSION_TAG = "sessionId";

/** The status a sandbox is up in, which the list of running sandboxes filters on. */
export const RUNNING_STATUS = "running";

/** Vercel's answer for a sandbox or session already gone. */
const NOT_FOUND_STATUS = 404;

/** Vercel's answer for a resume whose snapshot is gone: expired past `CODER.SANDBOX_SNAPSHOTS`'s expiration, or deleted. */
export const SNAPSHOT_GONE_STATUS = 410;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

const SANDBOX_API = {
  ORIGIN: "https://vercel.com",
  PATH: "/api/v2/sandboxes",
  /** The create's own path: the SDK's 3.8.0 client creates on v3 and reads every answer after on v2. */
  CREATE_PATH: "/api/v3/sandboxes",
  /**
   * A session has one sandbox, so the first page is all of them. Note that
   * the page is the API's widest, because a list asked for more is refused
   * whole (`limit`'s maximum in Vercel's REST reference is 50).
   */
  PAGE: 50,
} as const;

/** Vercel could not be asked, or did not confirm what was asked; the status where it answered one. */
export class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly status?: number;
}> {
  override get message(): string {
    return this.status === undefined
      ? "Vercel Sandbox was unavailable"
      : `Vercel Sandbox answered ${this.status}`;
  }
}

/** A sandbox as a list or a lookup names it: its name, where it stands, the session it runs while up, and its tags. */
export interface ListedSandbox {
  readonly name: string;
  readonly status?: string | undefined;
  readonly currentSessionId?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
  /** The snapshot a persistent sandbox resumes from, which its last stop or snapshot made. */
  readonly currentSnapshotId?: string | undefined;
  /** When the sandbox was created, in epoch milliseconds. */
  readonly createdAt?: number | undefined;
}

/** A command the sandbox ran to its end: its exit code and what it printed on stdout and stderr. */
export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Where a sandbox session's PTY is reached: a WebSocket address and the
 * token it is opened with, minted for one connection. Both stay on the
 * service; nothing of either reaches a device.
 */
export interface InteractiveShell {
  readonly url: string;
  readonly token: Redacted.Redacted;
}

/**
 * A sandbox session's network policy as the API takes it: the open internet
 * with nothing set, or every host open and, on the hosts named, headers the
 * firewall sets on the way out, on every request or on those whose path
 * matches.
 */
export type NetworkPolicy =
  | { readonly mode: "allow-all" }
  | {
      readonly allow: Readonly<
        Record<
          string,
          readonly {
            readonly match?: {
              readonly path: { readonly startsWith: string } | { readonly exact: string };
            };
            readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
          }[]
        >
      >;
    };

/** The argv of a command Luke wrote, where it runs, and the variables it is handed beside the sandbox's own. */
export interface CommandAsk {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A detached command: started as root where `sudo` asks it, which the
 * sandbox's API grants whatever the image's sudoers say, with its stdin held
 * open for `writeStdin`. Its `env` is handed to it by the API alone, so a
 * secret in it reaches no argv and no file.
 */
interface DetachedCommandAsk extends CommandAsk {
  readonly sudo: boolean;
}

/** A sandbox opened from a snapshot: its name, its tags, how long it may run and how large, and how many of its snapshots Vercel keeps. */
interface SandboxCreate {
  readonly name: string;
  readonly snapshotId: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly vcpus: number;
  readonly keepLastSnapshots: {
    readonly count: number;
    readonly expiration: number;
    readonly deleteEvicted: boolean;
  };
  readonly env: Readonly<Record<string, string>>;
}

/** A persistent sandbox opened on an image rather than a snapshot: a template being prepared. */
interface ImageSandboxCreate {
  readonly name: string;
  readonly image: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly vcpus: number;
}

/** A file written into a sandbox: its absolute path, its bytes, and its mode. */
interface SandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly mode: number;
}

/** The order a list runs in by when each sandbox was created. */
export const LIST_ORDER = { OLDEST_FIRST: "asc", NEWEST_FIRST: "desc" } as const;

export type ListOrder = (typeof LIST_ORDER)[keyof typeof LIST_ORDER];

/** A page of the running sandboxes: the sandboxes, and the cursor of the next page where there is one. */
export interface RunningPage {
  readonly sandboxes: readonly ListedSandbox[];
  readonly next: string | undefined;
}

export interface VercelSandboxApi {
  /** Every sandbox carrying the session's tag. */
  readonly listTagged: (
    sessionId: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
  /**
   * One page of the project's running sandboxes, every kind, by when they
   * were created in the order given, from the cursor a page before answered;
   * with the cursor of the next page where there is one.
   */
  readonly listRunning: (
    cursor: string | undefined,
    order: ListOrder,
  ) => Effect.Effect<RunningPage, SandboxUnavailable>;
  /** The named sandbox, resumed from its snapshot first where it was stopped. */
  readonly resume: (name: string) => Effect.Effect<ListedSandbox, SandboxUnavailable>;
  /** Stops the sandbox session named, keeping its filesystem; one already gone counts as stopped. */
  readonly stopSession: (sandboxSessionId: string) => Effect.Effect<void, SandboxUnavailable>;
  /** Deletes the named sandbox with the snapshots no other sandbox uses; one already gone counts as deleted. */
  readonly deleteSandbox: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  /** Runs a command in the sandbox session named and waits for its end. */
  readonly run: (
    sandboxSessionId: string,
    ask: CommandAsk,
  ) => Effect.Effect<CommandRun, SandboxUnavailable>;
  /**
   * One file of the running sandbox session, its path absolute or from the
   * sandbox's home, read off the wire up to `maxBytes` and one byte past
   * them, so a caller's own bound still sees a file larger than it; nothing
   * where there is no such file.
   */
  readonly readFile: (
    sandboxSessionId: string,
    path: string,
    maxBytes: number,
  ) => Effect.Effect<Uint8Array | undefined, SandboxUnavailable>;
  /** Mints a connection to the running sandbox session's PTY; a session not running is unavailable, and nothing is resumed. */
  readonly openInteractive: (
    sandboxSessionId: string,
  ) => Effect.Effect<InteractiveShell, SandboxUnavailable>;
  /** Sets the running sandbox session's network policy whole. */
  readonly updateNetworkPolicy: (
    sandboxSessionId: string,
    policy: NetworkPolicy,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** Opens a persistent sandbox from the snapshot named, on the open internet; answers it with the session it runs. */
  readonly create: (ask: SandboxCreate) => Effect.Effect<ListedSandbox, SandboxUnavailable>;
  /** The sandbox of that name, as it stands, without resuming it; none where there is no such sandbox. */
  readonly getNamed: (name: string) => Effect.Effect<ListedSandbox | undefined, SandboxUnavailable>;
  /** The project's sandboxes whose names start with the prefix, the first page of them. */
  readonly listNamed: (
    prefix: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
  /**
   * Opens a persistent sandbox of that name on the image, on the open
   * internet. A name already taken is refused with Vercel's 409, which is
   * what makes the name a lock.
   */
  readonly createFromImage: (
    ask: ImageSandboxCreate,
  ) => Effect.Effect<ListedSandbox, SandboxUnavailable>;
  /**
   * Snapshots the running session, which stops it, answering the snapshot's
   * id. The snapshot never expires. A session that is no longer running is
   * refused, so of two snapshots asked at once only the first is taken.
   */
  readonly snapshot: (sandboxSessionId: string) => Effect.Effect<string, SandboxUnavailable>;
  /** Replaces the named sandbox's tags whole. */
  readonly updateTags: (
    name: string,
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** Writes the files into the running sandbox session, as the sandbox's default user. */
  readonly writeFiles: (
    sandboxSessionId: string,
    files: readonly SandboxFile[],
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** Starts a detached command with its stdin held open; answers the command's id. */
  readonly start: (
    sandboxSessionId: string,
    ask: DetachedCommandAsk,
  ) => Effect.Effect<string, SandboxUnavailable>;
  /** Appends the text to a detached command's stdin, after whatever it already took. */
  readonly writeStdin: (
    sandboxSessionId: string,
    commandId: string,
    text: string,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** A command's exit code, or null while it runs; a command or session gone is unavailable. */
  readonly commandExit: (
    sandboxSessionId: string,
    commandId: string,
  ) => Effect.Effect<number | null, SandboxUnavailable>;
  /** Ends a command with SIGTERM; one already gone counts as ended. */
  readonly kill: (
    sandboxSessionId: string,
    commandId: string,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

/** The OIDC token's claims the API is asked under: the project and team it names. */
const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

const ListedSandboxSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.optional(Schema.String),
  currentSessionId: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  currentSnapshotId: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Number),
});

/** A snapshot's answer: the snapshot taken. */
const SnapshotTakenSchema = Schema.Struct({ snapshot: Schema.Struct({ id: Schema.String }) });

/** A create's answer: the sandbox and the session it opened. */
const CreatedSandboxSchema = Schema.Struct({
  sandbox: ListedSandboxSchema,
  session: Schema.Struct({ id: Schema.String, status: Schema.optional(Schema.String) }),
});

/** A command as the API names it: its id, and its exit code once it ended. */
const CommandSchema = Schema.Struct({
  command: Schema.Struct({ id: Schema.String, exitCode: Schema.NullOr(Schema.Number) }),
});

/** A stdin write's answer: how many bytes the command's stdin has taken in all. */
const StdinSchema = Schema.Struct({ bytesWritten: Schema.optional(Schema.Number) });

/** A page of the sandboxes listed under a tag. */
const ListedSandboxesSchema = Schema.Struct({ sandboxes: Schema.Array(ListedSandboxSchema) });

/** A page of the running sandboxes, with the cursor of the next where there is one. */
const RunningSandboxesSchema = Schema.Struct({
  sandboxes: Schema.Array(ListedSandboxSchema),
  pagination: Schema.optional(
    Schema.Struct({ next: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
});

/** A lookup's answer: the sandbox, and the session it runs now, which a resume opened. */
const FoundSandboxSchema = Schema.Struct({
  sandbox: ListedSandboxSchema,
  session: Schema.optional(
    Schema.Struct({ id: Schema.String, status: Schema.optional(Schema.String) }),
  ),
});

/** One line of a command's stream: the command, which carries its exit code once it ended, a line it printed, or the stream's own error. */
const CommandLineSchema = Schema.Union([
  Schema.Struct({ command: Schema.Struct({ exitCode: Schema.NullOr(Schema.Number) }) }),
  Schema.Struct({ stream: Schema.Literals(["stdout", "stderr"]), data: Schema.String }),
  Schema.Struct({ stream: Schema.Literal("error"), data: Schema.Unknown }),
]);

/** A minted PTY connection. */
const InteractiveSchema = Schema.Struct({ url: Schema.String, token: Schema.String });

/** Where a sandbox's own PTY server is served: Vercel's sandbox domain, as it addresses a sandbox's routes, on a secure socket. */
const SANDBOX_SHELL_ADDRESS = {
  HOST_SUFFIX: ".vercel.run",
  PROTOCOLS: new Set(["wss:", "https:"]),
} as const;

/** Whether a minted PTY address is one of Vercel's sandboxes, by its protocol and host alone, so the shell's token is never sent anywhere else. */
function isSandboxShellAddress(address: string): boolean {
  const url = Result.try(() => new URL(address));
  if (Result.isFailure(url)) return false;
  const { protocol, hostname, username, password } = url.success;
  return (
    SANDBOX_SHELL_ADDRESS.PROTOCOLS.has(protocol) &&
    hostname.endsWith(SANDBOX_SHELL_ADDRESS.HOST_SUFFIX) &&
    username === "" &&
    password === ""
  );
}

const readClaims = readEither(OidcClaimsSchema, { excess: EXCESS_KEYS.DROP });
const readInteractive = readEither(InteractiveSchema, { excess: EXCESS_KEYS.DROP });
const readListed = readEither(ListedSandboxesSchema, { excess: EXCESS_KEYS.DROP });
const readRunning = readEither(RunningSandboxesSchema, { excess: EXCESS_KEYS.DROP });
const readFound = readEither(FoundSandboxSchema, { excess: EXCESS_KEYS.DROP });
const readCommandLine = readEither(CommandLineSchema, { excess: EXCESS_KEYS.DROP });
const readCreated = readEither(CreatedSandboxSchema, { excess: EXCESS_KEYS.DROP });
const readCommand = readEither(CommandSchema, { excess: EXCESS_KEYS.DROP });
const readStdin = readEither(StdinSchema, { excess: EXCESS_KEYS.DROP });
const readSnapshot = readEither(SnapshotTakenSchema, { excess: EXCESS_KEYS.DROP });

/** SIGTERM's number, which the kill takes. */
const SIGTERM = 15;

/**
 * The most bytes one stdin write carries, as the SDK's 3.8.0 client chunks
 * them, because the API refuses a body over a megabyte and base64 grows the
 * bytes by a third.
 */
const STDIN_CHUNK_BYTES = 512 * 1024;

/** The tar format's block, which every header and every file's padding is a whole number of. */
const TAR_BLOCK = 512;

/** One ustar header field written at its offset, as octal where it is a number. */
function tarField(header: Uint8Array, offset: number, length: number, value: string): void {
  header.set(Buffer.from(value, "utf8").subarray(0, length), offset);
}

function tarOctal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/**
 * The files as one gzipped ustar archive, each under its path relative to
 * the root, which is what the file write takes. Note that a path past a
 * hundred bytes is split at a slash into ustar's prefix, and one that will
 * not split is refused, since every path here is Luke's own.
 */
function tarOf(files: readonly SandboxFile[]): Uint8Array | undefined {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    const path = file.path.replace(/^\/+/u, "");
    let name = path;
    let prefix = "";
    if (Buffer.byteLength(path) > 100) {
      const cut = path.lastIndexOf("/", 155);
      if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) return undefined;
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    }
    const header = new Uint8Array(TAR_BLOCK);
    tarField(header, 0, 100, name);
    tarField(header, 100, 8, tarOctal(file.mode, 8));
    tarField(header, 108, 8, tarOctal(0, 8));
    tarField(header, 116, 8, tarOctal(0, 8));
    tarField(header, 124, 12, tarOctal(file.contents.byteLength, 12));
    tarField(header, 136, 12, tarOctal(0, 12));
    tarField(header, 148, 8, "        ");
    tarField(header, 156, 1, "0");
    tarField(header, 257, 6, "ustar\0");
    tarField(header, 263, 2, "00");
    tarField(header, 345, 155, prefix);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    tarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, file.contents);
    const padding = (TAR_BLOCK - (file.contents.byteLength % TAR_BLOCK)) % TAR_BLOCK;
    if (padding > 0) blocks.push(new Uint8Array(padding));
  }
  blocks.push(new Uint8Array(TAR_BLOCK * 2));
  return gzipSync(Buffer.concat(blocks));
}

/** How the deployment's own OIDC token is read: the function's in production, a fixed one in a test. */
export type OidcTokenRead = () => Promise<string>;

/** The function's own token, as Vercel hands it to a running function. */
export const deploymentOidcToken: OidcTokenRead = () => getVercelOidcToken();

/** The project and team a token names, read from its payload; Vercel verifies the token itself. */
function claimsOf(
  token: string,
): { readonly projectId: string; readonly teamId: string } | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  const decoded = Result.try(() => JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (Result.isFailure(decoded)) return undefined;
  const claims = readClaims(unparsedWire(decoded.success));
  return Result.isSuccess(claims)
    ? { projectId: claims.success.project_id, teamId: claims.success.owner_id }
    : undefined;
}

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

/** One call as the client answers it: its status and its body's text, or unavailable where it never answered. */
function callApi(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<{ readonly status: number; readonly text: string }, SandboxUnavailable> {
  return client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.text.pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((text) => ({ status: response.status, text })),
      ),
    ),
    Effect.scoped,
    Effect.mapError(() => new SandboxUnavailable({})),
  );
}

/** A body's bytes, read off the wire up to the bound given and no further. */
function boundedBytes(
  response: HttpClientResponse.HttpClientResponse,
  bound: number,
): Effect.Effect<Uint8Array, unknown> {
  return response.stream.pipe(
    Stream.mapAccum(
      () => 0,
      (seen, chunk: Uint8Array) => {
        const kept = chunk.subarray(0, Math.max(0, bound - seen));
        const total = seen + kept.length;
        return [total, [{ kept, total }]] as const;
      },
    ),
    Stream.takeUntil(({ total }) => total >= bound),
    Stream.runCollect,
    Effect.map((pieces) => {
      const bytes = new Uint8Array(pieces.at(-1)?.total ?? 0);
      let at = 0;
      for (const { kept } of pieces) {
        bytes.set(kept, at);
        at += kept.length;
      }
      return bytes;
    }),
  );
}

/** A body's JSON, or nothing a reader takes where it is none. */
function jsonOf(text: string): UnparsedWireValue {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

/**
 * A finished command's stream read whole: the lines it printed on stdout,
 * and those on stderr, each in order, and the exit code its last line
 * carries. An error line, or a stream that ends before the command does, is
 * unavailable.
 */
function commandRunOf(text: string): CommandRun | undefined {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const read = readCommandLine(jsonOf(line));
    if (Result.isFailure(read)) return undefined;
    const value = read.success;
    if ("command" in value) {
      exitCode = value.command.exitCode ?? exitCode;
      continue;
    }
    if (value.stream === "error") return undefined;
    if (value.stream === "stdout") stdout += value.data;
    else stderr += value.data;
  }
  return exitCode === undefined ? undefined : { exitCode, stdout, stderr };
}

/** The API under the token the reader hands, read afresh for each call. */
export function vercelSandboxApi(
  readToken: OidcTokenRead,
): Effect.Effect<VercelSandboxApi, never, HttpClient.HttpClient> {
  return Effect.map(HttpClient.HttpClient, (client) => {
    const credentials = Effect.gen(function* () {
      const token = yield* Effect.tryPromise({
        try: readToken,
        catch: () => new SandboxUnavailable({}),
      });
      const claims = claimsOf(token);
      if (claims === undefined) return yield* new SandboxUnavailable({});
      return { headers: { authorization: `Bearer ${token}` }, ...claims };
    });

    /** A URL on the API, under the team the token names and the extra query given. */
    const apiUrl = (path: string, teamId: string, query: Readonly<Record<string, string>> = {}) => {
      const url = new URL(`${SANDBOX_API.PATH}${path}`, SANDBOX_API.ORIGIN);
      url.searchParams.set("teamId", teamId);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      return url;
    };

    return {
      listTagged: (sessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // The API's own filter syntax, one `key:value` pair.
            tags: `${SESSION_TAG}:${sessionId}`,
          });
          const listed = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readListed(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* new SandboxUnavailable({ status: listed.status });
          }
          return page.success.sandboxes;
        }),
      listRunning: (cursor, order) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // Note that the API takes a status filter only under a sort by creation.
            sortBy: "createdAt",
            sortOrder: order,
            status: RUNNING_STATUS,
            ...(cursor === undefined ? undefined : { cursor }),
          });
          const listed = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readRunning(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* new SandboxUnavailable({ status: listed.status });
          }
          return {
            sandboxes: page.success.sandboxes,
            next: page.success.pagination?.next ?? undefined,
          };
        }),
      resume: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            resume: "true",
          });
          const found = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const read = readFound(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: found.status });
          }
          const { sandbox, session } = read.success;
          // The session a resume opened is the one running now, whatever the sandbox's own record lags.
          return session === undefined
            ? sandbox
            : {
                ...sandbox,
                currentSessionId: session.id,
                status: session.status ?? sandbox.status,
              };
        }),
      stopSession: (sandboxSessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/stop`,
            asked.teamId,
          );
          // Note that the stop is sent as JSON though it asks nothing, because Vercel answers 415 to a
          // POST with no JSON content type, as `@vercel/sandbox` sends every call.
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({}),
          );
          const stopped = yield* callApi(client, request);
          if (!succeeded(stopped.status) && stopped.status !== NOT_FOUND_STATUS) {
            return yield* new SandboxUnavailable({ status: stopped.status });
          }
        }),
      deleteSandbox: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            deleteOrphanSnapshots: "true",
          });
          const deleted = yield* callApi(
            client,
            HttpClientRequest.delete(url, { headers: asked.headers }),
          );
          if (!succeeded(deleted.status) && deleted.status !== NOT_FOUND_STATUS) {
            return yield* new SandboxUnavailable({ status: deleted.status });
          }
        }),
      run: (sandboxSessionId, ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/sessions/${encodeURIComponent(sandboxSessionId)}/cmd`, asked.teamId);
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              command: ask.command,
              args: ask.args,
              cwd: ask.cwd,
              ...(ask.env === undefined ? undefined : { env: ask.env }),
              wait: true,
              logs: true,
            }),
          );
          const ran = yield* callApi(client, request);
          const run = commandRunOf(ran.text);
          if (!succeeded(ran.status) || run === undefined) {
            return yield* new SandboxUnavailable({ status: ran.status });
          }
          return run;
        }),
      readFile: (sandboxSessionId, path, maxBytes) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/fs/read`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ path }),
          );
          return yield* client.execute(request).pipe(
            Effect.flatMap((response) => {
              if (response.status === NOT_FOUND_STATUS) return Effect.succeed(undefined);
              if (!succeeded(response.status)) {
                return Effect.fail(new SandboxUnavailable({ status: response.status }));
              }
              return boundedBytes(response, maxBytes + 1);
            }),
            Effect.scoped,
            Effect.mapError((failure) =>
              failure instanceof SandboxUnavailable ? failure : new SandboxUnavailable({}),
            ),
          );
        }),
      openInteractive: (sandboxSessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/interactive`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({}),
          );
          const minted = yield* callApi(client, request);
          const read = readInteractive(jsonOf(minted.text));
          if (!succeeded(minted.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: minted.status });
          }
          if (!isSandboxShellAddress(read.success.url)) {
            yield* Effect.logWarning("a minted PTY address was not on Vercel's sandbox domain");
            return yield* new SandboxUnavailable({});
          }
          return { url: read.success.url, token: Redacted.make(read.success.token) };
        }),
      updateNetworkPolicy: (sandboxSessionId, policy) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/network-policy`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe(policy),
          );
          const updated = yield* callApi(client, request);
          if (!succeeded(updated.status)) {
            return yield* new SandboxUnavailable({ status: updated.status });
          }
        }),
      create: (ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = new URL(SANDBOX_API.CREATE_PATH, SANDBOX_API.ORIGIN);
          url.searchParams.set("teamId", asked.teamId);
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              projectId: asked.projectId,
              ports: [],
              source: { type: "snapshot", snapshotId: ask.snapshotId },
              name: ask.name,
              persistent: true,
              tags: ask.tags,
              timeout: ask.timeoutMs,
              resources: { vcpus: ask.vcpus },
              keepLastSnapshots: ask.keepLastSnapshots,
              env: ask.env,
              networkPolicy: { mode: "allow-all" },
            }),
          );
          const created = yield* callApi(client, request);
          const read = readCreated(jsonOf(created.text));
          if (!succeeded(created.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: created.status });
          }
          const { sandbox, session } = read.success;
          return {
            ...sandbox,
            currentSessionId: session.id,
            status: session.status ?? sandbox.status,
          };
        }),
      getNamed: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            resume: "false",
          });
          const found = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          if (found.status === NOT_FOUND_STATUS) return undefined;
          const read = readFound(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: found.status });
          }
          const { sandbox, session } = read.success;
          // The session's own status is the live one; the sandbox's record of it can lag.
          return session === undefined || session.id !== sandbox.currentSessionId
            ? sandbox
            : { ...sandbox, status: session.status ?? sandbox.status };
        }),
      listNamed: (prefix) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            namePrefix: prefix,
          });
          const listed = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readListed(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* new SandboxUnavailable({ status: listed.status });
          }
          return page.success.sandboxes;
        }),
      createFromImage: (ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = new URL(SANDBOX_API.CREATE_PATH, SANDBOX_API.ORIGIN);
          url.searchParams.set("teamId", asked.teamId);
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              projectId: asked.projectId,
              ports: [],
              image: ask.image,
              name: ask.name,
              persistent: true,
              tags: ask.tags,
              timeout: ask.timeoutMs,
              resources: { vcpus: ask.vcpus },
              networkPolicy: { mode: "allow-all" },
            }),
          );
          const created = yield* callApi(client, request);
          const read = readCreated(jsonOf(created.text));
          if (!succeeded(created.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: created.status });
          }
          const { sandbox, session } = read.success;
          return {
            ...sandbox,
            currentSessionId: session.id,
            status: session.status ?? sandbox.status,
          };
        }),
      snapshot: (sandboxSessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/snapshot`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ expiration: 0 }),
          );
          const taken = yield* callApi(client, request);
          const read = readSnapshot(jsonOf(taken.text));
          if (!succeeded(taken.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: taken.status });
          }
          return read.success.snapshot.id;
        }),
      updateTags: (name, tags) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
          });
          const request = HttpClientRequest.patch(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ tags }),
          );
          const updated = yield* callApi(client, request);
          if (!succeeded(updated.status)) {
            return yield* new SandboxUnavailable({ status: updated.status });
          }
        }),
      writeFiles: (sandboxSessionId, files) =>
        Effect.gen(function* () {
          const archive = tarOf(files);
          if (archive === undefined) return yield* new SandboxUnavailable({});
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/fs/write`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, {
            headers: { ...asked.headers, "x-cwd": "/" },
          }).pipe(HttpClientRequest.bodyUint8Array(archive, "application/gzip"));
          const written = yield* callApi(client, request);
          if (!succeeded(written.status)) {
            return yield* new SandboxUnavailable({ status: written.status });
          }
        }),
      start: (sandboxSessionId, ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(`/sessions/${encodeURIComponent(sandboxSessionId)}/cmd`, asked.teamId);
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              command: ask.command,
              args: ask.args,
              cwd: ask.cwd,
              env: ask.env ?? {},
              sudo: ask.sudo,
              attachStdin: true,
            }),
          );
          const started = yield* callApi(client, request);
          const read = readCommand(jsonOf(started.text));
          if (!succeeded(started.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: started.status });
          }
          return read.success.command.id;
        }),
      writeStdin: (sandboxSessionId, commandId, text) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}/stdin`,
            asked.teamId,
          );
          const post = (body: object) =>
            Effect.flatMap(
              callApi(
                client,
                HttpClientRequest.post(url, { headers: asked.headers }).pipe(
                  HttpClientRequest.bodyJsonUnsafe(body),
                ),
              ),
              (answered) => {
                const read = readStdin(jsonOf(answered.text));
                return succeeded(answered.status) && Result.isSuccess(read)
                  ? Effect.succeed(read.success.bytesWritten)
                  : Effect.fail(new SandboxUnavailable({ status: answered.status }));
              },
            );
          // Note that the offset is where the stdin stands now, asked first, so a write the API
          // already took in part is never taken twice: the API skips the bytes it holds.
          let offset = (yield* post({})) ?? 0;
          const bytes = Buffer.from(text, "utf8");
          for (let at = 0; at < bytes.byteLength; at += STDIN_CHUNK_BYTES) {
            const chunk = bytes.subarray(at, at + STDIN_CHUNK_BYTES);
            yield* post({ data: chunk.toString("base64"), offset });
            offset += chunk.byteLength;
          }
        }),
      commandExit: (sandboxSessionId, commandId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}`,
            asked.teamId,
          );
          const found = yield* callApi(
            client,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const read = readCommand(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* new SandboxUnavailable({ status: found.status });
          }
          return read.success.command.exitCode;
        }),
      kill: (sandboxSessionId, commandId) =>
        Effect.gen(function* () {
          const asked = yield* credentials;
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}/kill`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ signal: SIGTERM }),
          );
          const killed = yield* callApi(client, request);
          if (!succeeded(killed.status) && killed.status !== NOT_FOUND_STATUS) {
            return yield* new SandboxUnavailable({ status: killed.status });
          }
        }),
    };
  });
}
