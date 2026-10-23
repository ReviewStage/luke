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
 * `deleteSandbox`, `stopSession`, `runCommand`, `openInteractive`,
 * `updateNetworkPolicy`, `getSession`, `extendTimeout`, and `updateSandbox`
 * when it moves; a sandbox's snapshot retention is set by Vercel's documented
 * "Update a sandbox" and checked against its documented "List snapshots"),
 * directly rather than through the SDK,
 * because
 * the SDK bundled into a function fails it as it loads and carries a dozen
 * Node modules these calls never use.
 *
 * A native harness's sandbox is the one sandbox Luke opens itself rather
 * than eve, so its calls are copied from the SDK's 3.8.0 client, the first
 * with stdin on a detached command: the create from a snapshot, a file
 * upload, a detached command started with its stdin held open, a write to
 * that stdin, a command's exit read as it waits for it, its kill, and a sandbox's tags updated;
 * and, for Luke's own template of that sandbox's image
 * (`native-sandbox-template.ts`), a sandbox looked up and listed by name,
 * one created on an image, and a running session snapshotted.
 *
 * Every sandbox eve opens carries its session's id as a tag, so a session's
 * sandbox is found by the tag alone; a session has one, so the first page is
 * all of them. What is sent is a tag, a name, and the argv of a command Luke
 * wrote; what a failure carries is the call that failed, its status, and
 * Vercel's own error code and message, or the cause's where Vercel never
 * answered, and never what was sent. A deployment without an OIDC token
 * answers every call as unavailable.
 */

import { gzipSync } from "node:zlib";
import { readEither } from "@luke/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { Data, Duration, Effect, Option, Redacted, Result, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";

/** The tag eve sets on every session's sandbox, its value the session's id; a sandbox Luke opens itself carries it too. */
export const SESSION_TAG = "sessionId";

/** The status a sandbox is up in, which the list of running sandboxes filters on. */
export const RUNNING_STATUS = "running";

/** Vercel's answer for a sandbox, session, or snapshot already gone. */
export const NOT_FOUND_STATUS = 404;

/**
 * Vercel's answer for a resume or a create whose snapshot is gone: expired
 * past `CODER.SANDBOX_SNAPSHOTS`'s expiration, or deleted. Vercel's body
 * names it `snapshot_not_found`, as the SDK's own check reads it.
 */
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
  /**
   * How long a read of a command's exit waits for it. Vercel records a
   * command's exit only once a read that waits for it (`wait=true`) has seen
   * it, and a plain read answers no exit forever, so the read waits, and one
   * that outlasts this finds the command still running.
   */
  EXIT_WAIT: Duration.seconds(2),
} as const;

/** What a read of a command's exit answers for a command, or its session, Vercel no longer knows. */
export const COMMAND_GONE = "gone";

/** A command's exit code, null while it runs, or gone (`COMMAND_GONE`). */
export type CommandExit = number | null | typeof COMMAND_GONE;

/** Which of the API's calls was made, as a failure names it. */
export const SANDBOX_CALL = {
  CREATE: "create",
  FS_WRITE: "fs/write",
  CMD: "cmd",
  STDIN: "stdin",
  LOGS: "logs",
  KILL: "kill",
  TAGS: "tags",
  TIMEOUT: "timeout",
  GET: "get",
  LIST: "list",
  DELETE: "delete",
  STOP: "stop",
  SESSION: "session",
  EXTEND: "extend",
  NETWORK_POLICY: "network-policy",
  INTERACTIVE: "interactive",
  SNAPSHOT: "snapshot",
  SNAPSHOT_LOOKUP: "snapshot-lookup",
  SNAPSHOT_LIST: "snapshot-list",
  RETENTION: "retention",
} as const;

export type SandboxCall = (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL];

/**
 * Vercel could not be asked, or did not confirm what was asked: the call
 * that failed, the status where Vercel answered one, and what went wrong in
 * a line, Vercel's own error code and message or the cause's where it never
 * answered. None of it is anything Luke sent.
 */
export class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly call?: SandboxCall;
  readonly status?: number;
  readonly detail?: string;
}> {
  override get message(): string {
    const asked = this.call === undefined ? "Vercel Sandbox" : `Vercel Sandbox ${this.call}`;
    const answer =
      this.status === undefined ? `${asked} was unavailable` : `${asked} answered ${this.status}`;
    return this.detail === undefined ? answer : `${answer}: ${this.detail}`;
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
  /** The timeout each session of the sandbox opens with, which Vercel reapplies at every resume. */
  readonly timeout?: number | undefined;
  /** How many of its snapshots Vercel keeps and for how long; null where none was set, which keeps every one. */
  readonly keepLastSnapshots?: SnapshotRetention | null | undefined;
}

/**
 * A sandbox's snapshot retention as Vercel's "Update a sandbox" takes it
 * (https://vercel.com/docs/rest-api/sandboxes/update-a-sandbox): the newest
 * `count` kept, each for `expiration` milliseconds, and the rest deleted
 * at once where `deleteEvicted`, which Vercel defaults to true.
 */
export interface SnapshotRetention {
  readonly count: number;
  readonly expiration?: number | undefined;
  readonly deleteEvicted?: boolean | undefined;
}

/** A snapshot as a list of them names it: its id, and whether a sandbox can still open from it. */
interface ListedSnapshot {
  readonly id: string;
  readonly usable: boolean;
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
 * sandbox's API does by running the `sudo` binary as the default user, so
 * it needs that user's sudoers entry, which the image keeps; its stdin held
 * open for `writeStdin`. Its `env` is handed to it by the API alone, so a
 * secret in it reaches no argv and no file. Vercel documents that its `sudo`
 * keeps that environment (setting `HOME` to root's), which the image's
 * sudoers must honour (`agent-runtime/sandbox-image.ts`).
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
export interface SandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly mode: number;
}

/**
 * A sandbox session's lifetime as Vercel holds it: where it stands, when it
 * started (when it was created where Vercel names no start), and how long
 * from then it may run, which an extension lengthens.
 */
export interface SessionLifetime {
  readonly status: string;
  readonly startedAt: number;
  readonly timeoutMs: number;
}

/** The order a list runs in by when each sandbox was created. */
export const LIST_ORDER = { OLDEST_FIRST: "asc", NEWEST_FIRST: "desc" } as const;

export type ListOrder = (typeof LIST_ORDER)[keyof typeof LIST_ORDER];

/** A page of sandboxes: the sandboxes, and the cursor of the next page where there is one. */
interface SandboxPage {
  readonly sandboxes: readonly ListedSandbox[];
  readonly next: string | undefined;
}

export interface VercelSandboxApi {
  /**
   * Every sandbox carrying the session's tag, the newest first. Note that
   * the order is made here rather than left to every reader's first pick,
   * because an expired sandbox whose delete Vercel did not confirm stands
   * beside the replacement that took its place, and the replacement is the
   * one a session's readers (the runner, the terminal, a copy of its work,
   * the browser) must find first.
   */
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
  ) => Effect.Effect<SandboxPage, SandboxUnavailable>;
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
  /** Mints a connection to the running sandbox session's PTY; a session not running is unavailable, and nothing is resumed. */
  readonly openInteractive: (
    sandboxSessionId: string,
  ) => Effect.Effect<InteractiveShell, SandboxUnavailable>;
  /** The sandbox session's lifetime as it stands; nothing where Vercel holds no such session. */
  readonly getSession: (
    sandboxSessionId: string,
  ) => Effect.Effect<SessionLifetime | undefined, SandboxUnavailable>;
  /**
   * Lengthens the running sandbox session's timeout by the duration given,
   * which Vercel takes from a second up and refuses past the account's
   * maximum lifetime; answers the lifetime it then stands at.
   */
  readonly extendTimeout: (
    sandboxSessionId: string,
    durationMs: number,
  ) => Effect.Effect<SessionLifetime, SandboxUnavailable>;
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
  /** One page of the project's sandboxes whose names start with the prefix, by name, from the cursor a page before answered. */
  readonly listNamedPage: (
    prefix: string,
    cursor: string | undefined,
  ) => Effect.Effect<SandboxPage, SandboxUnavailable>;
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
  /**
   * Whether the snapshot named still stands: false where Vercel answers it
   * not found (404) or gone (410), or names it deleted or failed.
   */
  readonly snapshotExists: (snapshotId: string) => Effect.Effect<boolean, SandboxUnavailable>;
  /** Sets the timeout the named sandbox's next sessions open with; the running session keeps its own. */
  readonly updateTimeout: (
    name: string,
    timeoutMs: number,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Sets the snapshot retention of the named sandbox. Note that Vercel
   * applies it at once to the snapshots the sandbox holds, evicting all but
   * the newest `count` by when they were made, whichever the sandbox resumes
   * from, and leaves the expiry of each one it keeps as it was.
   */
  readonly updateRetention: (
    name: string,
    retention: SnapshotRetention,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** The newest snapshot the named sandbox made, deleted or not; none where it made none. */
  readonly newestSnapshot: (
    name: string,
  ) => Effect.Effect<ListedSnapshot | undefined, SandboxUnavailable>;
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
  /** A command's exit code, null while it runs, or gone where Vercel no longer knows the command or its session. */
  readonly commandExit: (
    sandboxSessionId: string,
    commandId: string,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  /**
   * What a command that exited printed on stderr, the tail kept, every value
   * named in `secrets` and every token-shaped run redacted, for a log; none
   * where Vercel has none or did not answer in time.
   */
  readonly commandStderrTail: (
    sandboxSessionId: string,
    commandId: string,
    secrets?: readonly string[],
  ) => Effect.Effect<string | undefined>;
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
  timeout: Schema.optional(Schema.Number),
  keepLastSnapshots: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        count: Schema.Number,
        expiration: Schema.optional(Schema.Number),
        deleteEvicted: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});

/** A session's answer, a lookup's or an extension's: the session and its lifetime. */
const SessionSchema = Schema.Struct({
  session: Schema.Struct({
    status: Schema.String,
    timeout: Schema.Number,
    createdAt: Schema.Number,
    startedAt: Schema.optional(Schema.Number),
  }),
});

/** A snapshot's answer: the snapshot taken. */
const SnapshotTakenSchema = Schema.Struct({ snapshot: Schema.Struct({ id: Schema.String }) });

/** A page of a sandbox's snapshots, the newest first as asked. */
const SnapshotsListedSchema = Schema.Struct({
  snapshots: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
});

/** A snapshot lookup's answer: where the snapshot stands. */
const SnapshotFoundSchema = Schema.Struct({
  snapshot: Schema.Struct({ id: Schema.String, status: Schema.String }),
});

/** The statuses Vercel names a snapshot by once nothing can open from it. */
const SNAPSHOT_UNUSABLE: ReadonlySet<string> = new Set(["deleted", "failed"]);

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

/** Vercel's answer to a call it refused: its error's code and message. */
const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
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
const readSnapshotFound = readEither(SnapshotFoundSchema, { excess: EXCESS_KEYS.DROP });
const readSnapshotsListed = readEither(SnapshotsListedSchema, { excess: EXCESS_KEYS.DROP });
const readSession = readEither(SessionSchema, { excess: EXCESS_KEYS.DROP });
const readErrorAnswer = readEither(ErrorAnswerSchema, { excess: EXCESS_KEYS.DROP });

/** The most characters a failure's detail keeps, so one log line stays one line's worth. */
const DETAIL_CHARS = 300;

/** What a 2xx answer this module could not read is detailed as. */
const UNREADABLE_DETAIL = "an answer that could not be read";

/**
 * The statuses Vercel answers a passing refusal with, which the SDK's 3.8.0
 * client tries again, and the waits between tries: 200 milliseconds, doubled
 * each time, three tries more at most.
 */
const PASSING = {
  STATUSES: new Set([429, 502, 503, 504]),
  FIRST_WAIT: Duration.millis(200),
  RETRIES: 3,
} as const;

const PASSING_RETRY = Schedule.max([
  Schedule.exponential(PASSING.FIRST_WAIT),
  Schedule.recurs(PASSING.RETRIES),
]);

/**
 * A run of characters shaped like a credential: twenty or more of a token's
 * alphabet unbroken, which a bearer, a provider key, a JWT, and an env value
 * Luke sent all are, and Vercel's prose, codes, and a URL's slashed path
 * segments mostly are not.
 */
const TOKEN_SHAPED = /[A-Za-z0-9._~+-]{20,}=*/gu;

/** An error code as Vercel writes one: lowercase words joined by underscores. */
const ERROR_CODE = /^[a-z]+(?:_[a-z]+){0,7}$/u;

/** What a token-shaped run of a detail reads as. */
const REDACTED_DETAIL = "[redacted]";

/**
 * The text cut to `DETAIL_CHARS` and to one line, every token-shaped run
 * redacted first. Note that a detail is redacted by shape rather than by the
 * values sent, because Vercel or a cause may echo any of them back, and a
 * detail reaches the logs.
 */
function capped(text: string): string {
  return clipped(text.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim());
}

/** How much of a dead command's stderr a log keeps: its end, where the reason it died is written. */
const STDERR_TAIL_CHARS = 600;

/** A stderr's tail as a log keeps it: every value named in `secrets`, whatever its shape, then every token-shaped run redacted, then its last `STDERR_TAIL_CHARS` on one line. */
function stderrTail(stderr: string, secrets: readonly string[]): string {
  const named = secrets
    .filter((secret) => secret.length > 0)
    .reduce((said, secret) => said.split(secret).join(REDACTED_DETAIL), stderr);
  const said = named.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim();
  return said.length > STDERR_TAIL_CHARS ? `…${said.slice(-STDERR_TAIL_CHARS)}` : said;
}

/** A line cut to `DETAIL_CHARS`. */
function clipped(line: string): string {
  return line.length > DETAIL_CHARS ? `${line.slice(0, DETAIL_CHARS - 1)}…` : line;
}

/** How many causes deep a failure's detail reads, as a transport error wraps fetch's, which wraps the socket's. */
const CAUSE_DEPTH = 3;

/** A cause as a failure's detail: its name and message, and those of the causes under it, never anything else it holds. */
function causeDetail(cause: unknown): string {
  const said: string[] = [];
  let at: unknown = cause;
  while (at instanceof Error && said.length < CAUSE_DEPTH) {
    said.push(`${at.name}: ${at.message}`);
    at = at.cause;
  }
  return capped(said.length === 0 ? typeof cause : said.join(" <- "));
}

/** Vercel's error code and message from a refusal's text, where it wrote them. */
function errorDetail(text: string): string | undefined {
  const read = readErrorAnswer(jsonOf(text));
  if (Result.isFailure(read)) return undefined;
  const { code, message } = read.success.error;
  // Note that a code shaped as Vercel's are is kept whole, because one such as
  // `unsupported_media_type` is token-shaped by length and names the refusal.
  const named = code !== undefined && ERROR_CODE.test(code) ? code : undefined;
  const said = [named === undefined ? code : undefined, message].filter(
    (each): each is string => each !== undefined && each.trim() !== "",
  );
  const rest = said.length === 0 ? undefined : capped(said.join(": "));
  if (named === undefined) return rest;
  return rest === undefined ? named : clipped(`${named}: ${rest}`);
}

/** An answer as the failure it is: the call, its status, and Vercel's own words, or that a 2xx could not be read. */
function refused(
  call: SandboxCall,
  answered: { readonly status: number; readonly text: string },
): SandboxUnavailable {
  const detail =
    errorDetail(answered.text) ?? (succeeded(answered.status) ? UNREADABLE_DETAIL : undefined);
  return new SandboxUnavailable({
    call,
    status: answered.status,
    ...(detail === undefined ? undefined : { detail }),
  });
}

/** The call tried again where Vercel answered a passing refusal; any other failure answers at once. */
function retryingPassing<A>(
  effect: Effect.Effect<A, SandboxUnavailable>,
): Effect.Effect<A, SandboxUnavailable> {
  return Effect.retry(effect, {
    schedule: PASSING_RETRY,
    while: (failure) => failure.status !== undefined && PASSING.STATUSES.has(failure.status),
  });
}

/** A session's answer as its lifetime, counted from its start, or from its creation where it names no start yet. */
function lifetimeOf(text: string): SessionLifetime | undefined {
  const read = readSession(jsonOf(text));
  if (Result.isFailure(read)) return undefined;
  const { status, timeout, createdAt, startedAt } = read.success.session;
  return { status, startedAt: startedAt ?? createdAt, timeoutMs: timeout };
}

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

/** One call as the client answers it: its status and its body's text, or unavailable, with why, where it never answered. */
function callApi(
  client: HttpClient.HttpClient,
  call: SandboxCall,
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
    Effect.mapError((cause) => new SandboxUnavailable({ call, detail: causeDetail(cause) })),
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
    /** The token's headers and claims for the call given, which a failure to read them names. */
    const credentials = (call: SandboxCall) =>
      Effect.gen(function* () {
        const token = yield* Effect.tryPromise({
          try: readToken,
          catch: (cause) => new SandboxUnavailable({ call, detail: causeDetail(cause) }),
        });
        const claims = claimsOf(token);
        if (claims === undefined) {
          return yield* new SandboxUnavailable({ call, detail: "a token naming no project" });
        }
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
          const asked = yield* credentials(SANDBOX_CALL.LIST);
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // The API's own filter syntax, one `key:value` pair.
            tags: `${SESSION_TAG}:${sessionId}`,
          });
          const listed = yield* callApi(
            client,
            SANDBOX_CALL.LIST,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readListed(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* refused(SANDBOX_CALL.LIST, listed);
          }
          return page.success.sandboxes.toSorted(
            (first, second) => (second.createdAt ?? 0) - (first.createdAt ?? 0),
          );
        }),
      listRunning: (cursor, order) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.LIST);
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // Note that the API takes a status filter only under a sort by creation, and `sortOrder` is `asc` or `desc`, `desc` where left out; its cursor is opaque, the `pagination.next` of the page before (https://vercel.com/docs/rest-api/sandboxes/list-sandboxes).
            sortBy: "createdAt",
            sortOrder: order,
            status: RUNNING_STATUS,
            ...(cursor === undefined ? undefined : { cursor }),
          });
          const listed = yield* callApi(
            client,
            SANDBOX_CALL.LIST,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readRunning(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* refused(SANDBOX_CALL.LIST, listed);
          }
          return {
            sandboxes: page.success.sandboxes,
            next: page.success.pagination?.next ?? undefined,
          };
        }),
      resume: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.GET);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            resume: "true",
          });
          const found = yield* callApi(
            client,
            SANDBOX_CALL.GET,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const read = readFound(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.GET, found);
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
          const asked = yield* credentials(SANDBOX_CALL.STOP);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/stop`,
            asked.teamId,
          );
          // Note that the stop is sent as JSON though it asks nothing, because Vercel answers 415 to a
          // POST with no JSON content type, as `@vercel/sandbox` sends every call.
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({}),
          );
          const stopped = yield* callApi(client, SANDBOX_CALL.STOP, request);
          if (!succeeded(stopped.status) && stopped.status !== NOT_FOUND_STATUS) {
            return yield* refused(SANDBOX_CALL.STOP, stopped);
          }
        }),
      deleteSandbox: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.DELETE);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            deleteOrphanSnapshots: "true",
          });
          const deleted = yield* callApi(
            client,
            SANDBOX_CALL.DELETE,
            HttpClientRequest.delete(url, { headers: asked.headers }),
          );
          if (!succeeded(deleted.status) && deleted.status !== NOT_FOUND_STATUS) {
            return yield* refused(SANDBOX_CALL.DELETE, deleted);
          }
        }),
      run: (sandboxSessionId, ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.CMD);
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
          const ran = yield* callApi(client, SANDBOX_CALL.CMD, request);
          const run = commandRunOf(ran.text);
          if (!succeeded(ran.status) || run === undefined) {
            return yield* refused(SANDBOX_CALL.CMD, ran);
          }
          return run;
        }),
      openInteractive: (sandboxSessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.INTERACTIVE);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/interactive`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({}),
          );
          const minted = yield* callApi(client, SANDBOX_CALL.INTERACTIVE, request);
          const read = readInteractive(jsonOf(minted.text));
          if (!succeeded(minted.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.INTERACTIVE, minted);
          }
          if (!isSandboxShellAddress(read.success.url)) {
            yield* Effect.logWarning("a minted PTY address was not on Vercel's sandbox domain");
            return yield* new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE });
          }
          return { url: read.success.url, token: Redacted.make(read.success.token) };
        }),
      getSession: (sandboxSessionId) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.SESSION);
          const url = apiUrl(`/sessions/${encodeURIComponent(sandboxSessionId)}`, asked.teamId);
          const found = yield* callApi(
            client,
            SANDBOX_CALL.SESSION,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          if (found.status === NOT_FOUND_STATUS) return undefined;
          const lifetime = lifetimeOf(found.text);
          if (!succeeded(found.status) || lifetime === undefined) {
            return yield* refused(SANDBOX_CALL.SESSION, found);
          }
          return lifetime;
        }),
      extendTimeout: (sandboxSessionId, durationMs) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.EXTEND);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/extend-timeout`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ duration: durationMs }),
          );
          const extended = yield* callApi(client, SANDBOX_CALL.EXTEND, request);
          const lifetime = lifetimeOf(extended.text);
          if (!succeeded(extended.status) || lifetime === undefined) {
            return yield* refused(SANDBOX_CALL.EXTEND, extended);
          }
          return lifetime;
        }),
      updateNetworkPolicy: (sandboxSessionId, policy) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.NETWORK_POLICY);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/network-policy`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe(policy),
          );
          const updated = yield* callApi(client, SANDBOX_CALL.NETWORK_POLICY, request);
          if (!succeeded(updated.status)) {
            return yield* refused(SANDBOX_CALL.NETWORK_POLICY, updated);
          }
        }),
      create: (ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.CREATE);
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
          const created = yield* callApi(client, SANDBOX_CALL.CREATE, request);
          const read = readCreated(jsonOf(created.text));
          if (!succeeded(created.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.CREATE, created);
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
          const asked = yield* credentials(SANDBOX_CALL.GET);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
            resume: "false",
          });
          const found = yield* callApi(
            client,
            SANDBOX_CALL.GET,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          if (found.status === NOT_FOUND_STATUS) return undefined;
          const read = readFound(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.GET, found);
          }
          const { sandbox, session } = read.success;
          // The session's own status is the live one; the sandbox's record of it can lag.
          return session === undefined || session.id !== sandbox.currentSessionId
            ? sandbox
            : { ...sandbox, status: session.status ?? sandbox.status };
        }),
      listNamedPage: (prefix, cursor) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.LIST);
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // Note that the API takes a name prefix only under a sort by name, and refuses it with a 400 otherwise.
            sortBy: "name",
            namePrefix: prefix,
            ...(cursor === undefined ? undefined : { cursor }),
          });
          const listed = yield* callApi(
            client,
            SANDBOX_CALL.LIST,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readRunning(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* refused(SANDBOX_CALL.LIST, listed);
          }
          return {
            sandboxes: page.success.sandboxes,
            next: page.success.pagination?.next ?? undefined,
          };
        }),
      listNamed: (prefix) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.LIST);
          const url = apiUrl("", asked.teamId, {
            project: asked.projectId,
            limit: String(SANDBOX_API.PAGE),
            // Note that the API takes a name prefix only under a sort by name, and refuses it with a 400 otherwise.
            sortBy: "name",
            namePrefix: prefix,
          });
          const listed = yield* callApi(
            client,
            SANDBOX_CALL.LIST,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const page = readListed(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(page)) {
            return yield* refused(SANDBOX_CALL.LIST, listed);
          }
          return page.success.sandboxes;
        }),
      createFromImage: (ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.CREATE);
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
          const created = yield* callApi(client, SANDBOX_CALL.CREATE, request);
          const read = readCreated(jsonOf(created.text));
          if (!succeeded(created.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.CREATE, created);
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
          const asked = yield* credentials(SANDBOX_CALL.SNAPSHOT);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/snapshot`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ expiration: 0 }),
          );
          const taken = yield* callApi(client, SANDBOX_CALL.SNAPSHOT, request);
          const read = readSnapshot(jsonOf(taken.text));
          if (!succeeded(taken.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.SNAPSHOT, taken);
          }
          return read.success.snapshot.id;
        }),
      snapshotExists: (snapshotId) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.SNAPSHOT_LOOKUP);
          const url = apiUrl(`/snapshots/${encodeURIComponent(snapshotId)}`, asked.teamId);
          const found = yield* callApi(
            client,
            SANDBOX_CALL.SNAPSHOT_LOOKUP,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          if (found.status === NOT_FOUND_STATUS || found.status === SNAPSHOT_GONE_STATUS) {
            return false;
          }
          const read = readSnapshotFound(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.SNAPSHOT_LOOKUP, found);
          }
          return !SNAPSHOT_UNUSABLE.has(read.success.snapshot.status);
        }),
      updateTimeout: (name, timeoutMs) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.TIMEOUT);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
          });
          const request = HttpClientRequest.patch(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ timeout: timeoutMs }),
          );
          const updated = yield* callApi(client, SANDBOX_CALL.TIMEOUT, request);
          if (!succeeded(updated.status)) {
            return yield* refused(SANDBOX_CALL.TIMEOUT, updated);
          }
        }),
      updateRetention: (name, retention) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.RETENTION);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
          });
          const request = HttpClientRequest.patch(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ keepLastSnapshots: retention }),
          );
          const updated = yield* callApi(client, SANDBOX_CALL.RETENTION, request);
          if (!succeeded(updated.status)) {
            return yield* refused(SANDBOX_CALL.RETENTION, updated);
          }
        }),
      newestSnapshot: (name) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.SNAPSHOT_LIST);
          // Vercel's documented "List snapshots": one sandbox's by its name, by creation, newest first.
          const url = apiUrl("/snapshots", asked.teamId, {
            project: asked.projectId,
            name,
            limit: "1",
            sortOrder: LIST_ORDER.NEWEST_FIRST,
          });
          const listed = yield* callApi(
            client,
            SANDBOX_CALL.SNAPSHOT_LIST,
            HttpClientRequest.get(url, { headers: asked.headers }),
          );
          const read = readSnapshotsListed(jsonOf(listed.text));
          if (!succeeded(listed.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.SNAPSHOT_LIST, listed);
          }
          const [newest] = read.success.snapshots;
          return newest === undefined
            ? undefined
            : { id: newest.id, usable: !SNAPSHOT_UNUSABLE.has(newest.status) };
        }),
      updateTags: (name, tags) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.TAGS);
          const url = apiUrl(`/${encodeURIComponent(name)}`, asked.teamId, {
            projectId: asked.projectId,
          });
          const request = HttpClientRequest.patch(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ tags }),
          );
          const updated = yield* callApi(client, SANDBOX_CALL.TAGS, request);
          if (!succeeded(updated.status)) {
            return yield* refused(SANDBOX_CALL.TAGS, updated);
          }
        }),
      writeFiles: (sandboxSessionId, files) =>
        Effect.gen(function* () {
          const archive = tarOf(files);
          if (archive === undefined)
            return yield* new SandboxUnavailable({ call: SANDBOX_CALL.FS_WRITE });
          const asked = yield* credentials(SANDBOX_CALL.FS_WRITE);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/fs/write`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, {
            headers: { ...asked.headers, "x-cwd": "/" },
          }).pipe(HttpClientRequest.bodyUint8Array(archive, "application/gzip"));
          const written = yield* callApi(client, SANDBOX_CALL.FS_WRITE, request);
          if (!succeeded(written.status)) {
            return yield* refused(SANDBOX_CALL.FS_WRITE, written);
          }
        }),
      start: (sandboxSessionId, ask) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.CMD);
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
          // Note that a start Vercel refused in passing is tried again, as the SDK's 3.8.0 client
          // tries it, though a 502 or a 504 may stand for a start that went through.
          return yield* retryingPassing(
            Effect.flatMap(callApi(client, SANDBOX_CALL.CMD, request), (started) => {
              const read = readCommand(jsonOf(started.text));
              return succeeded(started.status) && Result.isSuccess(read)
                ? Effect.succeed(read.success.command.id)
                : Effect.fail(refused(SANDBOX_CALL.CMD, started));
            }),
          );
        }),
      writeStdin: (sandboxSessionId, commandId, text) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.STDIN);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}/stdin`,
            asked.teamId,
          );
          // A write Vercel refused in passing is tried again, which the offset makes safe.
          const post = (body: object) =>
            retryingPassing(
              Effect.flatMap(
                callApi(
                  client,
                  SANDBOX_CALL.STDIN,
                  HttpClientRequest.post(url, { headers: asked.headers }).pipe(
                    HttpClientRequest.bodyJsonUnsafe(body),
                  ),
                ),
                (answered) => {
                  const read = readStdin(jsonOf(answered.text));
                  return succeeded(answered.status) && Result.isSuccess(read)
                    ? Effect.succeed(read.success.bytesWritten)
                    : Effect.fail(refused(SANDBOX_CALL.STDIN, answered));
                },
              ),
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
          const asked = yield* credentials(SANDBOX_CALL.CMD);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}`,
            asked.teamId,
          );
          // Note that the read waits for the exit, as the SDK's 3.8.0 `getCommand` with `wait` does,
          // because Vercel records an exit only once such a read has seen it.
          url.searchParams.set("wait", "true");
          const waited = yield* callApi(
            client,
            SANDBOX_CALL.CMD,
            HttpClientRequest.get(url, { headers: asked.headers }),
          ).pipe(Effect.timeoutOption(SANDBOX_API.EXIT_WAIT));
          if (Option.isNone(waited)) return null;
          const found = waited.value;
          if (found.status === NOT_FOUND_STATUS) return COMMAND_GONE;
          const read = readCommand(jsonOf(found.text));
          if (!succeeded(found.status) || Result.isFailure(read)) {
            return yield* refused(SANDBOX_CALL.CMD, found);
          }
          return read.success.command.exitCode;
        }),
      commandStderrTail: (sandboxSessionId, commandId, secrets = []) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.LOGS);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}/logs`,
            asked.teamId,
          );
          const read = yield* callApi(
            client,
            SANDBOX_CALL.LOGS,
            HttpClientRequest.get(url, { headers: asked.headers }),
          ).pipe(Effect.timeoutOption(SANDBOX_API.EXIT_WAIT));
          if (Option.isNone(read) || !succeeded(read.value.status)) return undefined;
          let stderr = "";
          for (const line of read.value.text.split("\n")) {
            if (line.trim() === "") continue;
            const each = readCommandLine(jsonOf(line));
            if (
              Result.isSuccess(each) &&
              "stream" in each.success &&
              each.success.stream === "stderr"
            ) {
              stderr += String(each.success.data);
            }
          }
          return stderr === "" ? undefined : stderrTail(stderr, secrets);
        }).pipe(Effect.orElseSucceed(() => undefined)),
      kill: (sandboxSessionId, commandId) =>
        Effect.gen(function* () {
          const asked = yield* credentials(SANDBOX_CALL.KILL);
          const url = apiUrl(
            `/sessions/${encodeURIComponent(sandboxSessionId)}/cmd/${encodeURIComponent(commandId)}/kill`,
            asked.teamId,
          );
          const request = HttpClientRequest.post(url, { headers: asked.headers }).pipe(
            HttpClientRequest.bodyJsonUnsafe({ signal: SIGTERM }),
          );
          const killed = yield* callApi(client, SANDBOX_CALL.KILL, request);
          if (!succeeded(killed.status) && killed.status !== NOT_FOUND_STATUS) {
            return yield* refused(SANDBOX_CALL.KILL, killed);
          }
        }),
    };
  });
}
