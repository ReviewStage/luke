/**
 * vercel-sandbox-api.ts -- every call we make of Vercel Sandbox, through `@vercel/sandbox`, under the deployment's own OIDC token.
 *
 * eve opens and drives each session's sandbox through the SDK it bundles,
 * and hands our own code no handle to it. What we ask of a sandbox
 * outside an eve tool — a retired session's sandboxes deleted, a sandbox no
 * terminal holds stopped, a developer's resume, a short command for a
 * terminal's list, a terminal's PTY, the GitHub credential at its firewall,
 * a native harness's sandbox opened and its runner started, our template of
 * that sandbox's image, a repository's base drive and the sandbox that
 * fills it — it asks here, of the SDK at the version the
 * catalog pins, which loads in a function's bundle. The SDK tries a 429, a
 * 5xx, and a failure to connect again before it answers (a 429 waits out
 * Vercel's `Retry-After` up to 20 seconds), so nothing here tries again.
 *
 * Every call goes under the token we read and the `fetch` `SandboxFetch`
 * names: a call on a sandbox by name, a list, a create, and a snapshot's
 * lookup through the SDK's statics, and the calls on a running session, and
 * on a command in it, through the session the documented way reaches it
 * (`Sandbox.get` by the sandbox's name, without resuming it, then
 * `currentSession`), looked up once and held for one operation's calls and
 * polls (`session`). The firewall's policy write alone still names a
 * session by its id (`sessionHandle`), since the firewall's record keeps no
 * sandbox's name; its handle resolves the deployment's token through the
 * SDK's own OIDC read and sends on `globalThis.fetch`.
 *
 * Every sandbox eve opens carries its session's id as a tag, so a session's
 * sandbox is found by the tag alone; a session has one, so the first page is
 * all of them. What is sent is a tag, a name, and the argv of a command we
 * wrote; what a failure carries is the call that failed, its status, and
 * Vercel's own error code and message, or the cause's where Vercel never
 * answered, every token-shaped run of it redacted, and never what was sent.
 * A deployment without an OIDC token answers every call as unavailable.
 */

import { readEither } from "@repo/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  APIError,
  type Command,
  Drive,
  Sandbox,
  type NetworkPolicy as SdkNetworkPolicy,
  Session,
  Snapshot,
  StreamError,
} from "@vercel/sandbox";
import { Context, Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { EXCESS_KEYS, unparsedWire } from "../core.js";
import { jsonOf } from "../http/http-effect.js";

/** The tag eve sets on every session's sandbox, its value the session's id; a sandbox we open ourselves carries it too. */
export const SESSION_TAG = "sessionId";

/** The statuses Vercel names a sandbox by that we read: up in `running`, which the list of running sandboxes filters on. */
export const SANDBOX_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  SNAPSHOTTING: "snapshotting",
} as const;

/** The statuses a sandbox is up in, or on its way up. */
export const UP_STATUSES: ReadonlySet<string> = new Set([
  SANDBOX_STATUS.PENDING,
  SANDBOX_STATUS.RUNNING,
]);

/** The policy with no credential on it: eve's default, the open internet. */
export const OPEN_INTERNET_POLICY = { mode: "allow-all" } as const;

/** Vercel's answer for a sandbox, session, or snapshot already gone. */
export const NOT_FOUND_STATUS = 404;

/**
 * Vercel's answer for a resume or a create whose snapshot is gone: expired
 * past `CODER.SANDBOX_SNAPSHOTS`'s expiration, or deleted, its body naming
 * `snapshot_not_found`, as the SDK's own check reads it. Note that Vercel
 * answers the same status for a call to a stopped sandbox
 * (`sandbox_stopped`), which a resume mends, so the code is what says the
 * snapshot is gone.
 */
const SNAPSHOT_GONE = { STATUS: 410, CODE: "snapshot_not_found" } as const;

/** Vercel's answer for a create whose name another sandbox already holds. */
const NAME_TAKEN_STATUS = 409;

/**
 * Vercel's answer for a call to a session that is stopping, or being
 * snapshotted, under it, and the codes its body names: what a resume of the
 * sandbox mends, as the SDK's own `withResume` reads it.
 */
const SESSION_ENDING = {
  STATUS: 422,
  CODES: new Set(["sandbox_stopping", "sandbox_snapshotting"]),
} as const;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

const SANDBOX_API = {
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
  DRIVE_GET: "drive-get",
  DRIVE_CREATE: "drive-create",
  DRIVE_DELETE: "drive-delete",
} as const;

export type SandboxCall = (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL];

/** What a create does where its name is already taken: joins the sandbox holding it, or refuses with Vercel's 409. */
export const NAME_TAKEN = { JOIN: "join", REFUSE: "refuse" } as const;

export type NameTaken = (typeof NAME_TAKEN)[keyof typeof NAME_TAKEN];

/**
 * Vercel could not be asked, or did not confirm what was asked: the call
 * that failed, the status where Vercel answered one, its error code where it
 * named one, and what went wrong in a line, Vercel's own error code and
 * message or the cause's where it never answered. None of it is anything
 * we sent.
 */
export class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly call?: SandboxCall;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
}> {
  override get message(): string {
    const asked = this.call === undefined ? "Vercel Sandbox" : `Vercel Sandbox ${this.call}`;
    const answer =
      this.status === undefined ? `${asked} was unavailable` : `${asked} answered ${this.status}`;
    return this.detail === undefined ? answer : `${answer}: ${this.detail}`;
  }
}

/** Whether a call failed because the session it named was stopping, or being snapshotted, under it: one a resume of its sandbox mends. */
export function sessionEnding(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SESSION_ENDING.STATUS &&
    failure.code !== undefined &&
    SESSION_ENDING.CODES.has(failure.code)
  );
}

/** Whether a resume or a create failed because the snapshot it opens from is gone. */
export function snapshotGone(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SNAPSHOT_GONE.STATUS &&
    failure.code === SNAPSHOT_GONE.CODE
  );
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
  /** How many of its snapshots Vercel keeps and for how long; none where none was set, which keeps every one. */
  readonly keepLastSnapshots?: SnapshotRetention | undefined;
}

/** A sandbox a create or a resume answered: Vercel opens it ready, so it always names the session it runs. */
export interface OpenedSandbox extends ListedSandbox {
  readonly currentSessionId: string;
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

/** A request header a rule matches: its name, and its value exactly (`@vercel/sandbox`'s `NetworkPolicyKeyValueMatcher`). */
interface HeaderMatch {
  readonly key: { readonly exact: string };
  readonly value: { readonly exact: string };
}

/**
 * One rule on a host: the headers the firewall sets on the way out, on every
 * request, or on those that match every condition its `match` names: the
 * path, and each header named at its value.
 */
export interface NetworkRule {
  readonly match?: {
    readonly path?: { readonly startsWith: string } | { readonly exact: string };
    readonly headers?: readonly HeaderMatch[];
  };
  readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
}

/**
 * A sandbox session's network policy: the open internet with nothing set,
 * or every host open and, on the hosts named, the rules that set headers on
 * the way out.
 */
export type NetworkPolicy =
  | { readonly mode: "allow-all" }
  | { readonly allow: Readonly<Record<string, readonly NetworkRule[]>> };

/** The argv of a command we wrote, where it runs, and the variables it is handed beside the sandbox's own. */
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
 * sudoers must honor (`agent-runtime/sandbox-image.ts`).
 */
interface DetachedCommandAsk extends CommandAsk {
  readonly sudo: boolean;
}

/**
 * A sandbox opened from a snapshot: its name, its tags, how long it may run
 * and how large, how many of its snapshots Vercel keeps, and what a name
 * another sandbox already holds does.
 */
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
  readonly whenNameTaken: NameTaken;
  /** The drives mounted read-write, each by its name at the absolute path it is keyed by. */
  readonly mounts?: Readonly<Record<string, string>>;
  /** Whether its filesystem is restored at its next session, and snapshotted at each stop for that; so where unsaid. */
  readonly persistent?: boolean;
}

/** A drive as a lookup names it: its name, and the sandbox it is mounted read-write in, where one holds it. */
interface ListedDrive {
  readonly name: string;
  readonly currentSandboxName?: string | undefined;
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

/** A sandbox's session as a caller names it: the sandbox's name, and the id of the session it means. */
export interface SessionRef {
  readonly name: string;
  readonly sessionId: string;
}

/** The calls on one sandbox session, made through the one handle an operation holds (`VercelSandboxApi`'s `session`). */
export interface SandboxSessionApi {
  /** The session's lifetime as the lookup found it; none where the sandbox no longer runs it. */
  readonly lifetime: SessionLifetime | undefined;
  /** Runs a command in the session and waits for its end. */
  readonly run: (ask: CommandAsk) => Effect.Effect<CommandRun, SandboxUnavailable>;
  /** Mints a connection to the running session's PTY; a session not running is unavailable, and nothing is resumed. */
  readonly openInteractive: () => Effect.Effect<InteractiveShell, SandboxUnavailable>;
  /** Stops the session, keeping its filesystem; one already gone counts as stopped. */
  readonly stop: () => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Lengthens the running session's timeout by the duration given, which
   * Vercel takes from a second up and refuses past the account's maximum
   * lifetime.
   */
  readonly extendTimeout: (durationMs: number) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Snapshots the running session, which stops it, answering the snapshot's
   * id. The snapshot expires `expiresAfter` its last use, or never where that
   * is infinite. Note that an expiration asked here wins over the sandbox's
   * own `keepLastSnapshots`, so a snapshot that must lapse on its own says
   * when. A session that is no longer running is refused, so of two
   * snapshots asked at once only the first is taken.
   */
  readonly snapshot: (expiresAfter: Duration.Duration) => Effect.Effect<string, SandboxUnavailable>;
  /** Writes the files into the running sandbox session, as the sandbox's default user. */
  readonly writeFiles: (files: readonly SandboxFile[]) => Effect.Effect<void, SandboxUnavailable>;
  /** Starts a detached command with its stdin held open; answers the command's id. */
  readonly start: (ask: DetachedCommandAsk) => Effect.Effect<string, SandboxUnavailable>;
  /** Appends the text to a detached command's stdin, after whatever it already took. */
  readonly writeStdin: (commandId: string, text: string) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * A command's exit code, null while it runs, or gone where Vercel no longer
   * knows the command or its session. The read waits for the exit for at most
   * `within` (`EXIT_WAIT` unless the caller names longer), so a caller that
   * waits on a command's end names how long rather than reading it again.
   */
  readonly commandExit: (
    commandId: string,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  /**
   * What a command that exited printed on stderr, the tail kept, every value
   * named in `secrets` and every token-shaped run redacted, for a log; none
   * where it printed nothing there, and unavailable where Vercel refused or
   * did not answer within `EXIT_WAIT`.
   */
  readonly commandStderrTail: (
    commandId: string,
    secrets?: readonly string[],
  ) => Effect.Effect<string | undefined, SandboxUnavailable>;
  /** Ends a command with SIGTERM; one already gone counts as ended. */
  readonly kill: (commandId: string) => Effect.Effect<void, SandboxUnavailable>;
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
  readonly resume: (name: string) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  /** Deletes the named sandbox with the snapshots no other sandbox uses; one already gone counts as deleted. */
  readonly deleteSandbox: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * The sandbox session named, as one operation holds it for its calls and
   * polls: the sandbox looked up once by its name, without resuming it. A
   * session that is no longer the sandbox's, or a sandbox gone, answers each
   * call as Vercel answers a session it no longer holds.
   */
  readonly session: (ref: SessionRef) => Effect.Effect<SandboxSessionApi, SandboxUnavailable>;
  /**
   * Sets the running sandbox session's network policy whole; every writer of
   * ours goes through `sandbox-firewall.ts`, which composes it from what
   * stands. Note that this one call is still made by the session's id alone
   * (`sessionHandle`), because the firewall's record keeps no sandbox's name.
   */
  readonly updateNetworkPolicy: (
    sandboxSessionId: string,
    policy: NetworkPolicy,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Opens a sandbox from the snapshot named, persistent unless it says not,
   * on the open internet; answers it with the session it runs. Where the name is taken,
   * `whenNameTaken` joins the sandbox holding it, resumed, or refuses with
   * Vercel's 409, which is what makes a name a lock.
   */
  readonly create: (ask: SandboxCreate) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
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
  ) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  /**
   * Whether the snapshot named still stands: false where Vercel answers it
   * not found (404) or gone (410), or names it deleted or failed.
   */
  readonly snapshotExists: (snapshotId: string) => Effect.Effect<boolean, SandboxUnavailable>;
  /** Sets the timeout the named sandbox's next sessions open with; a running session it would lengthen is lengthened with it, one it would shorten keeps its own. */
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
  /** The drive under the name; none where there is none. */
  readonly getDrive: (name: string) => Effect.Effect<ListedDrive | undefined, SandboxUnavailable>;
  /** The drive under the name, created in the sandboxes' region where there is none. */
  readonly getOrCreateDrive: (name: string) => Effect.Effect<ListedDrive, SandboxUnavailable>;
  /** Deletes the drive under the name with all it holds; one already gone is no failure. */
  readonly deleteDrive: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  /** Replaces the named sandbox's tags whole. */
  readonly updateTags: (
    name: string,
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

/**
 * The `fetch` the SDK sends on: the platform's own, and a suite's fake of
 * Vercel where a test provides one. Note that the default looks
 * `globalThis.fetch` up at each request rather than once, because a
 * reference keeps the default it first computed for the process's life. The
 * firewall's policy write by id sends on `globalThis.fetch` whatever this
 * names, since the SDK builds that handle's client itself (`sessionHandle`).
 */
export const SandboxFetch = Context.Reference<typeof globalThis.fetch>(
  "@repo/service/SandboxFetch",
  { defaultValue: () => (input, init) => globalThis.fetch(input, init) },
);

/** The OIDC token's claims the API is asked under: the project and team it names. */
const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

/** Vercel's answer to a call it refused: its error's code and message. */
const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

/** The statuses Vercel names a snapshot by once nothing can open from it. */
const SNAPSHOT_UNUSABLE: ReadonlySet<string> = new Set(["deleted", "failed"]);

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
const readErrorAnswer = readEither(ErrorAnswerSchema, { excess: EXCESS_KEYS.DROP });

/** The most characters a failure's detail keeps, so one log line stays one line's worth. */
const DETAIL_CHARS = 300;

/** What a 2xx answer the SDK could not read is detailed as. */
const UNREADABLE_DETAIL = "an answer that could not be read";

/**
 * A run of characters shaped like a credential: twenty or more of a token's
 * alphabet unbroken, which a bearer, a provider key, a JWT, and an env value
 * we sent all are, and Vercel's prose, codes, and a URL's slashed path
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
 * values sent, because Vercel, the SDK, or a cause may echo any of them
 * back, and a detail reaches the logs.
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

/** Vercel's error code in an answer's body, where it names one shaped as Vercel's are. */
function errorCode(text: string): string | undefined {
  const read = readErrorAnswer(jsonOf(text));
  if (Result.isFailure(read)) return undefined;
  const { code } = read.success.error;
  return code !== undefined && ERROR_CODE.test(code) ? code : undefined;
}

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

/** An answer as the failure it is: the call, its status and code, and Vercel's own words, or that a 2xx could not be read. */
function refused(
  call: SandboxCall,
  answered: { readonly status: number; readonly text: string },
): SandboxUnavailable {
  const detail =
    errorDetail(answered.text) ?? (succeeded(answered.status) ? UNREADABLE_DETAIL : undefined);
  const code = errorCode(answered.text);
  return new SandboxUnavailable({
    call,
    status: answered.status,
    ...(code === undefined ? undefined : { code }),
    ...(detail === undefined ? undefined : { detail }),
  });
}

/**
 * What `@vercel/sandbox` threw as the failure it is: an `APIError` read as
 * Vercel's answer is, by its status and its body's text, never the SDK's own
 * message, which may quote the answer; a stream's error by its code and
 * message; and anything else as the cause. Note that the SDK has already
 * tried a 429, a 5xx, and a failure to connect again by then.
 */
function sdkFailure(call: SandboxCall, cause: unknown): SandboxUnavailable {
  if (cause instanceof APIError) {
    return refused(call, { status: cause.response.status, text: cause.text ?? "" });
  }
  if (cause instanceof StreamError) {
    return new SandboxUnavailable({
      call,
      ...(ERROR_CODE.test(cause.code) ? { code: cause.code } : undefined),
      detail: capped(cause.message),
    });
  }
  return new SandboxUnavailable({ call, detail: causeDetail(cause) });
}

/** One SDK call as an effect, its failure read as the call's; interrupting it aborts the SDK's request. */
function sdkCall<A>(
  call: SandboxCall,
  run: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, SandboxUnavailable> {
  return Effect.tryPromise({ try: run, catch: (cause) => sdkFailure(call, cause) });
}

/** Whether a failure is Vercel's answer that what was named is already gone. */
function isGone(failure: SandboxUnavailable): boolean {
  return failure.status === NOT_FOUND_STATUS;
}

/** The SDK's own name for its network policy, from ours: the open internet by name, and every rule copied, since the SDK takes them as mutable arrays. */
function sdkPolicyOf(policy: NetworkPolicy): SdkNetworkPolicy {
  if ("mode" in policy) return policy.mode;
  return {
    allow: Object.fromEntries(
      Object.entries(policy.allow).map(([host, rules]) => [
        host,
        rules.map((rule) => ({
          ...(rule.match === undefined
            ? undefined
            : {
                match: {
                  ...(rule.match.path === undefined ? undefined : { path: rule.match.path }),
                  ...(rule.match.headers === undefined
                    ? undefined
                    : { headers: [...rule.match.headers] }),
                },
              }),
          transform: rule.transform.map((each) => ({ headers: { ...each.headers } })),
        })),
      ]),
    ),
  };
}

/** Drives mounted read-write as `@vercel/sandbox`'s create takes them. */
function driveMounts(mounts: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(mounts).map(([path, drive]) => [path, { drive, mode: "read-write" as const }]),
  );
}

/** A drive as a lookup answers it. */
function listedDrive(drive: Drive): ListedDrive {
  return { name: drive.name, currentSandboxName: drive.currentSandboxName };
}

/** A sandbox as the SDK's list names it. */
type ListedMetadata = Awaited<ReturnType<typeof Sandbox.list>>["sandboxes"][number];

/** A listed sandbox as we read it. */
function listedOf(listed: ListedMetadata): ListedSandbox {
  return {
    name: listed.name,
    status: listed.status,
    currentSessionId: listed.currentSessionId,
    tags: listed.tags,
    currentSnapshotId: listed.currentSnapshotId,
    createdAt: listed.createdAt,
    timeout: listed.timeout,
    keepLastSnapshots: listed.keepLastSnapshots,
  };
}

/** A sandbox the SDK answered whole, as we read it: the session it holds is the one running now, whatever the sandbox's own record lags. */
function openedOf(sandbox: Sandbox): OpenedSandbox {
  const session = sandbox.currentSession();
  return {
    name: sandbox.name,
    status: session.status,
    currentSessionId: session.sessionId,
    tags: sandbox.tags,
    currentSnapshotId: sandbox.currentSnapshotId,
    createdAt: sandbox.createdAt.getTime(),
    timeout: sandbox.timeout,
    keepLastSnapshots: sandbox.keepLastSnapshots,
  };
}

/** A session as the SDK's `Session` holds what it read of one. */
type SessionSnapshot = Extract<
  ConstructorParameters<typeof Session>[0],
  { snapshot: unknown }
>["snapshot"];

/**
 * What a session's handle holds beside its id: nothing the calls we make of
 * it read, since each sends the id alone. Note that `cwd` is where the SDK
 * resolves a relative path a file write names, and every path we write is
 * absolute.
 */
const UNREAD_SESSION: Omit<SessionSnapshot, "id"> = {
  memory: 0,
  vcpus: 0,
  region: "",
  timeout: 0,
  status: SANDBOX_STATUS.RUNNING,
  requestedAt: 0,
  createdAt: 0,
  cwd: "/",
  updatedAt: 0,
};

/**
 * The SDK's handle on a sandbox session we know by its id alone, built from
 * the SDK's exported `Session` without a call, for the firewall's policy
 * write, whose record keeps no sandbox's name. Note that every other call
 * reaches a session the documented way (`Sandbox.get`, then
 * `currentSession`), and that this handle resolves the deployment's token
 * through the SDK's own OIDC read and sends on `globalThis.fetch`.
 */
function sessionHandle(sandboxSessionId: string): Session {
  return new Session({ routes: [], snapshot: { ...UNREAD_SESSION, id: sandboxSessionId } });
}

/**
 * The fetch given, sending a list with Vercel's own filter to running
 * sandboxes. Note that the filter is added here, because the SDK's list
 * forwards no status, and the sweeps read a bounded number of pages of the
 * running sandboxes, which stopped ones listed beside them would crowd out
 * (https://vercel.com/docs/rest-api/sandboxes/list-sandboxes takes `status`
 * under a sort by creation).
 */
function runningOnly(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    url.searchParams.set("status", SANDBOX_STATUS.RUNNING);
    return fetch(url, init);
  };
}

/** What a call on a session its sandbox no longer runs answers: Vercel's not-found, as it answers a session it no longer holds. */
function sessionEnded(call: SandboxCall): SandboxUnavailable {
  return new SandboxUnavailable({ call, status: NOT_FOUND_STATUS, detail: "the session ended" });
}

/**
 * The calls on a sandbox's session through the SDK's handle on it, where the
 * sandbox still runs it, holding each command it starts or reads for the
 * operation's later calls on it, so a launch's start, stdin, and kill look
 * nothing up again.
 */
function sessionCallsOf(current: Option.Option<Session>): SandboxSessionApi {
  const commands = new Map<string, Command>();
  const lifetime = Option.match(current, {
    onNone: () => undefined,
    onSome: (session): SessionLifetime => ({
      status: session.status,
      startedAt: (session.startedAt ?? session.createdAt).getTime(),
      timeoutMs: session.timeout,
    }),
  });
  const on = <A>(
    call: SandboxCall,
    run: (session: Session, signal: AbortSignal) => Promise<A>,
  ): Effect.Effect<A, SandboxUnavailable> =>
    Option.match(current, {
      onNone: () => Effect.fail(sessionEnded(call)),
      onSome: (session) => sdkCall(call, (signal) => run(session, signal)),
    });
  const held = (command: Command) =>
    Effect.sync(() => {
      commands.set(command.cmdId, command);
    });
  const onCommand = <A>(
    call: SandboxCall,
    commandId: string,
    run: (command: Command, signal: AbortSignal) => Promise<A>,
  ) =>
    Effect.suspend(() => {
      const known = commands.get(commandId);
      return known === undefined
        ? Effect.tap(
            on(call, (session, signal) => session.getCommand(commandId, { signal })),
            held,
          )
        : Effect.succeed(known);
    }).pipe(Effect.flatMap((command) => sdkCall(call, (signal) => run(command, signal))));
  return {
    lifetime,
    run: (ask) =>
      on(SANDBOX_CALL.CMD, async (session, signal) => {
        const finished = await session.runCommand({
          cmd: ask.command,
          args: [...ask.args],
          ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
          ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
          signal,
        });
        return {
          exitCode: finished.exitCode,
          stdout: await finished.stdout(),
          stderr: await finished.stderr(),
        };
      }),
    openInteractive: () =>
      Effect.gen(function* () {
        // Note that the session's own call is made, never the sandbox's, because the sandbox's resumes a stopped sandbox to open it.
        const minted = yield* on(SANDBOX_CALL.INTERACTIVE, (session, signal) =>
          session.openInteractive({ signal }),
        );
        if (!isSandboxShellAddress(minted.url)) {
          yield* Effect.logWarning("a minted PTY address was not on Vercel's sandbox domain");
          return yield* new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE });
        }
        return { url: minted.url, token: Redacted.make(minted.token) };
      }),
    stop: () =>
      on(SANDBOX_CALL.STOP, (session, signal) => session.stop({ signal })).pipe(
        Effect.asVoid,
        Effect.catchIf(isGone, () => Effect.void),
      ),
    extendTimeout: (durationMs) =>
      on(SANDBOX_CALL.EXTEND, (session, signal) => session.extendTimeout(durationMs, { signal })),
    snapshot: (expiresAfter) =>
      on(SANDBOX_CALL.SNAPSHOT, async (session, signal) => {
        // Vercel's create-a-snapshot takes 0 for a snapshot that never expires.
        const expiration = Duration.isFinite(expiresAfter) ? Duration.toMillis(expiresAfter) : 0;
        return (await session.snapshot({ expiration, signal })).snapshotId;
      }),
    writeFiles: (files) =>
      on(SANDBOX_CALL.FS_WRITE, (session, signal) =>
        session.writeFiles(
          files.map((file) => ({ path: file.path, content: file.contents, mode: file.mode })),
          { signal },
        ),
      ),
    start: (ask) =>
      on(SANDBOX_CALL.CMD, (session, signal) =>
        session.runCommand({
          cmd: ask.command,
          args: [...ask.args],
          ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
          env: { ...ask.env },
          sudo: ask.sudo,
          detached: true,
          stdin: true,
          signal,
        }),
      ).pipe(
        Effect.tap(held),
        Effect.map((command) => command.cmdId),
      ),
    writeStdin: (commandId, text) =>
      // Note that the SDK asks where the stdin stands first and writes from there, so a write it tries again is never taken twice.
      onCommand(SANDBOX_CALL.STDIN, commandId, (command, signal) =>
        command.writeStdin(text, { abortSignal: signal }),
      ),
    commandExit: (commandId, within = SANDBOX_API.EXIT_WAIT) =>
      onCommand(SANDBOX_CALL.CMD, commandId, async (command, signal) => {
        // Note that the read waits for the exit, because Vercel records an exit only once such a read has seen it.
        const finished = await command.wait({ signal });
        return finished.exitCode;
      }).pipe(
        Effect.timeoutOption(within),
        Effect.map((exit): CommandExit => (Option.isNone(exit) ? null : exit.value)),
        Effect.catchIf(isGone, () => Effect.succeed<CommandExit>(COMMAND_GONE)),
        // Note that a wait Vercel ended before the command did answers it with no exit, which the SDK cannot read as a finished command.
        Effect.catchIf(
          (failure) => failure.status !== undefined && succeeded(failure.status),
          () => Effect.succeed<CommandExit>(null),
        ),
      ),
    commandStderrTail: (commandId, secrets = []) =>
      onCommand(SANDBOX_CALL.LOGS, commandId, (command, signal) => command.stderr({ signal })).pipe(
        Effect.timeoutOption(SANDBOX_API.EXIT_WAIT),
        Effect.flatMap((stderr) =>
          Option.isNone(stderr)
            ? Effect.fail(
                new SandboxUnavailable({ call: SANDBOX_CALL.LOGS, detail: "no answer in time" }),
              )
            : Effect.succeed(stderr.value === "" ? undefined : stderrTail(stderr.value, secrets)),
        ),
      ),
    kill: (commandId) =>
      onCommand(SANDBOX_CALL.KILL, commandId, (command, signal) =>
        command.kill("SIGTERM", { abortSignal: signal }),
      ).pipe(Effect.catchIf(isGone, () => Effect.void)),
  };
}

/**
 * The session named, looked up at its first use and held for every later
 * one: what an operation hands its calls where none of them is the one
 * place to look it up first. A lookup that fails is not held, so the next
 * call asks again.
 */
export function sessionOnFirstUse(
  api: VercelSandboxApi,
  ref: SessionRef,
): Effect.Effect<SandboxSessionApi, SandboxUnavailable> {
  let held: SandboxSessionApi | undefined;
  return Effect.suspend(() =>
    held === undefined
      ? Effect.tap(api.session(ref), (session) =>
          Effect.sync(() => {
            held = session;
          }),
        )
      : Effect.succeed(held),
  );
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

/** The API under the token the reader hands, read afresh for each call, sending its static calls on the `SandboxFetch` it is built under. */
export function vercelSandboxApi(readToken: OidcTokenRead): Effect.Effect<VercelSandboxApi> {
  return Effect.map(Effect.service(SandboxFetch), (fetch) => {
    /**
     * The token's credentials for the call given, which a failure to read
     * them names. Note that every call reads them, a session's too, because
     * a deployment without a token must answer unavailable rather than fall
     * into the SDK's own sign-in for a developer's terminal.
     */
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
        return { token, ...claims, fetch };
      });

    /** A call of the SDK's statics, under the credentials and the fetch they are made with. */
    const asked = <A>(
      call: SandboxCall,
      run: (
        signal: AbortSignal,
        under: Effect.Success<ReturnType<typeof credentials>>,
      ) => Promise<A>,
    ) =>
      Effect.flatMap(credentials(call), (under) => sdkCall(call, (signal) => run(signal, under)));

    /** The firewall's policy write on the running session named, through its handle by id (`sessionHandle`). */
    const onSessionById = <A>(
      call: SandboxCall,
      sandboxSessionId: string,
      run: (session: Session, signal: AbortSignal) => Promise<A>,
    ) =>
      Effect.andThen(
        credentials(call),
        sdkCall(call, (signal) => run(sessionHandle(sandboxSessionId), signal)),
      );

    /** The named sandbox as it stands, without resuming it. */
    const found = (call: SandboxCall, name: string) =>
      asked(call, (signal, under) => Sandbox.get({ ...under, name, resume: false, signal }));

    /** The named sandbox's configuration updated, without resuming it. */
    const updated = (call: SandboxCall, name: string, update: Parameters<Sandbox["update"]>[0]) =>
      asked(call, async (signal, under) => {
        const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
        await sandbox.update(update, { signal });
      });

    const resume = (name: string) =>
      Effect.map(
        asked(SANDBOX_CALL.GET, (signal, under) =>
          Sandbox.get({ ...under, name, resume: true, signal }),
        ),
        openedOf,
      );

    return {
      listTagged: (sessionId) =>
        Effect.map(
          asked(SANDBOX_CALL.LIST, (signal, under) =>
            Sandbox.list({
              ...under,
              limit: SANDBOX_API.PAGE,
              tags: { [SESSION_TAG]: sessionId },
              signal,
            }),
          ),
          (page) =>
            page.sandboxes
              .map(listedOf)
              .toSorted((first, second) => (second.createdAt ?? 0) - (first.createdAt ?? 0)),
        ),
      listRunning: (cursor, order) =>
        Effect.map(
          asked(SANDBOX_CALL.LIST, (signal, under) =>
            Sandbox.list({
              ...under,
              fetch: runningOnly(under.fetch),
              limit: SANDBOX_API.PAGE,
              // Note that the API takes a status filter only under a sort by creation; its cursor is opaque, the `pagination.next` of the page before.
              sortBy: "createdAt",
              sortOrder: order,
              ...(cursor === undefined ? undefined : { cursor }),
              signal,
            }),
          ),
          (page) => ({
            sandboxes: page.sandboxes.map(listedOf),
            next: page.pagination.next ?? undefined,
          }),
        ),
      resume,
      deleteSandbox: (name) =>
        asked(SANDBOX_CALL.DELETE, async (signal, under) => {
          // Note that the lookup asks no resume, because a sandbox on its way out is never woken to be deleted.
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          await sandbox.delete({ deleteOrphanSnapshots: true, signal });
        }).pipe(Effect.catchIf(isGone, () => Effect.void)),
      session: (ref) =>
        found(SANDBOX_CALL.SESSION, ref.name).pipe(
          Effect.map((sandbox) => {
            const current = sandbox.currentSession();
            return current.sessionId === ref.sessionId
              ? Option.some(current)
              : Option.none<Session>();
          }),
          Effect.catchIf(isGone, () => Effect.succeed(Option.none<Session>())),
          Effect.map(sessionCallsOf),
        ),
      updateNetworkPolicy: (sandboxSessionId, policy) =>
        onSessionById(SANDBOX_CALL.NETWORK_POLICY, sandboxSessionId, (session, signal) =>
          session.update({ networkPolicy: sdkPolicyOf(policy) }, { signal }),
        ),
      create: (ask) =>
        asked(SANDBOX_CALL.CREATE, (signal, under) =>
          Sandbox.create({
            ...under,
            source: { type: "snapshot", snapshotId: ask.snapshotId },
            name: ask.name,
            persistent: ask.persistent ?? true,
            ...(ask.mounts === undefined ? undefined : { mounts: driveMounts(ask.mounts) }),
            tags: { ...ask.tags },
            timeout: ask.timeoutMs,
            resources: { vcpus: ask.vcpus },
            keepLastSnapshots: { ...ask.keepLastSnapshots },
            env: { ...ask.env },
            networkPolicy: sdkPolicyOf(OPEN_INTERNET_POLICY),
            signal,
          }),
        ).pipe(
          Effect.map(openedOf),
          // Note that a joining create meets its name taken where the SDK tried again a create whose first answer was lost, so the sandbox holding it is the one this opened.
          Effect.catchIf(
            (failure) =>
              ask.whenNameTaken === NAME_TAKEN.JOIN && failure.status === NAME_TAKEN_STATUS,
            () => resume(ask.name),
          ),
        ),
      getNamed: (name) =>
        found(SANDBOX_CALL.GET, name).pipe(
          Effect.map((sandbox): ListedSandbox | undefined => openedOf(sandbox)),
          Effect.catchIf(isGone, () => Effect.succeed(undefined)),
        ),
      listNamedPage: (prefix, cursor) =>
        Effect.map(
          asked(SANDBOX_CALL.LIST, (signal, under) =>
            Sandbox.list({
              ...under,
              limit: SANDBOX_API.PAGE,
              // Note that the API takes a name prefix only under a sort by name, and refuses it with a 400 otherwise.
              sortBy: "name",
              namePrefix: prefix,
              ...(cursor === undefined ? undefined : { cursor }),
              signal,
            }),
          ),
          (page) => ({
            sandboxes: page.sandboxes.map(listedOf),
            next: page.pagination.next ?? undefined,
          }),
        ),
      listNamed: (prefix) =>
        Effect.map(
          asked(SANDBOX_CALL.LIST, (signal, under) =>
            Sandbox.list({
              ...under,
              limit: SANDBOX_API.PAGE,
              // Note that the API takes a name prefix only under a sort by name, and refuses it with a 400 otherwise.
              sortBy: "name",
              namePrefix: prefix,
              signal,
            }),
          ),
          (page) => page.sandboxes.map(listedOf),
        ),
      createFromImage: (ask) =>
        Effect.map(
          asked(SANDBOX_CALL.CREATE, (signal, under) =>
            Sandbox.create({
              ...under,
              image: ask.image,
              name: ask.name,
              persistent: true,
              tags: { ...ask.tags },
              timeout: ask.timeoutMs,
              resources: { vcpus: ask.vcpus },
              networkPolicy: sdkPolicyOf(OPEN_INTERNET_POLICY),
              signal,
            }),
          ),
          openedOf,
        ),
      snapshotExists: (snapshotId) =>
        asked(SANDBOX_CALL.SNAPSHOT_LOOKUP, (signal, under) =>
          Snapshot.get({ ...under, snapshotId, signal }),
        ).pipe(
          Effect.map((snapshot) => !SNAPSHOT_UNUSABLE.has(snapshot.status)),
          Effect.catchIf(
            (failure) => isGone(failure) || failure.status === SNAPSHOT_GONE.STATUS,
            () => Effect.succeed(false),
          ),
        ),
      updateTimeout: (name, timeoutMs) =>
        updated(SANDBOX_CALL.TIMEOUT, name, { timeout: timeoutMs }),
      updateRetention: (name, { count, expiration, deleteEvicted }) =>
        updated(SANDBOX_CALL.RETENTION, name, {
          keepLastSnapshots: {
            count,
            ...(expiration === undefined ? undefined : { expiration }),
            ...(deleteEvicted === undefined ? undefined : { deleteEvicted }),
          },
        }),
      newestSnapshot: (name) =>
        Effect.map(
          // Vercel's documented "List snapshots": one sandbox's by its name, by creation, newest first.
          asked(SANDBOX_CALL.SNAPSHOT_LIST, (signal, under) =>
            Snapshot.list({ ...under, name, limit: 1, sortOrder: LIST_ORDER.NEWEST_FIRST, signal }),
          ),
          (page) => {
            const [newest] = page.snapshots;
            return newest === undefined
              ? undefined
              : { id: newest.id, usable: !SNAPSHOT_UNUSABLE.has(newest.status) };
          },
        ),
      updateTags: (name, tags) => updated(SANDBOX_CALL.TAGS, name, { tags: { ...tags } }),
      getDrive: (name) =>
        asked(SANDBOX_CALL.DRIVE_GET, (signal, under) =>
          Drive.get({ ...under, name, signal }),
        ).pipe(
          Effect.map((drive): ListedDrive | undefined => listedDrive(drive)),
          Effect.catchIf(isGone, () => Effect.succeed(undefined)),
        ),
      getOrCreateDrive: (name) =>
        // Note that the drive takes Vercel's default region, as every sandbox we create does, since a mount must match it.
        Effect.map(
          asked(SANDBOX_CALL.DRIVE_CREATE, (signal, under) =>
            Drive.getOrCreate({ ...under, name, signal }),
          ),
          listedDrive,
        ),
      deleteDrive: (name) =>
        asked(SANDBOX_CALL.DRIVE_DELETE, async (signal, under) => {
          const drive = await Drive.get({ ...under, name, signal });
          await drive.delete({ signal });
        }).pipe(Effect.catchIf(isGone, () => Effect.void)),
    };
  });
}
