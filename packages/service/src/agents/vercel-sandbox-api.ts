import { readEither } from "@repo/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  APIError,
  type Command,
  Drive,
  Sandbox,
  type NetworkPolicy as SdkNetworkPolicy,
  type Session,
  StreamError,
} from "@vercel/sandbox";
import { Context, Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { EXCESS_KEYS, unparsedWire } from "../core.js";
import { jsonOf } from "../http/http-effect.js";

export const SESSION_TAG = "sessionId";

export const SANDBOX_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  SNAPSHOTTING: "snapshotting",
} as const;

export const UP_STATUSES: ReadonlySet<string> = new Set([
  SANDBOX_STATUS.PENDING,
  SANDBOX_STATUS.RUNNING,
]);

export const OPEN_INTERNET_POLICY = { mode: "allow-all" } as const;

export const NOT_FOUND_STATUS = 404;

export const IMAGE_NOT_READY = "image_not_ready";

const SNAPSHOT_GONE_STATUS = 410;

const NAME_TAKEN_STATUS = 409;

const SNAPSHOT_GONE_CODE = "snapshot_not_found";

const SESSION_ENDING = {
  STATUS: 422,
  CODES: new Set(["sandbox_stopping", "sandbox_snapshotting"]),
} as const;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

const SANDBOX_API = {
  PAGE: 50,
  EXIT_WAIT: Duration.seconds(2),
} as const;

export const COMMAND_GONE = "gone";

export type CommandExit = number | null | typeof COMMAND_GONE;

export const SANDBOX_CALL = {
  CREATE: "create",
  FS_WRITE: "fs/write",
  CMD: "cmd",
  STDIN: "stdin",
  LOGS: "logs",
  KILL: "kill",
  TAGS: "tags",
  GET: "get",
  LIST: "list",
  DELETE: "delete",
  STOP: "stop",
  SESSION: "session",
  EXTEND: "extend",
  NETWORK_POLICY: "network-policy",
  INTERACTIVE: "interactive",
  SNAPSHOT: "snapshot",
  DRIVE_GET: "drive-get",
  DRIVE_CREATE: "drive-create",
  DRIVE_FORK: "drive-fork",
  DRIVE_DELETE: "drive-delete",
  USER: "user",
} as const;

export type SandboxCall = (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL];

export const NAME_TAKEN = { JOIN: "join", REFUSE: "refuse" } as const;

export type NameTaken = (typeof NAME_TAKEN)[keyof typeof NAME_TAKEN];

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

export function sessionEnding(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SESSION_ENDING.STATUS &&
    failure.code !== undefined &&
    SESSION_ENDING.CODES.has(failure.code)
  );
}

export function snapshotGone(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SNAPSHOT_GONE_STATUS &&
    failure.code === SNAPSHOT_GONE_CODE
  );
}

export interface ListedSandbox {
  readonly name: string;
  readonly status?: string | undefined;
  readonly currentSessionId?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
  readonly currentSnapshotId?: string | undefined;
  readonly createdAt?: number | undefined;
  readonly timeout?: number | undefined;
  readonly expiresAt?: number | undefined;
  readonly keepLastSnapshots?: SnapshotRetention | undefined;
}

export interface OpenedSandbox extends ListedSandbox {
  readonly currentSessionId: string;
}

interface SnapshotRetention {
  readonly count: number;
  readonly expiration?: number | undefined;
  readonly deleteEvicted?: boolean | undefined;
}

export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface InteractiveShell {
  readonly url: string;
  readonly token: Redacted.Redacted;
}

interface HeaderMatch {
  readonly key: { readonly exact: string };
  readonly value: { readonly exact: string };
}

export interface NetworkRule {
  readonly match?: {
    readonly path?: { readonly startsWith: string } | { readonly exact: string };
    readonly headers?: readonly HeaderMatch[];
  };
  readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
}

export type NetworkPolicy =
  | { readonly mode: "allow-all" }
  | { readonly allow: Readonly<Record<string, readonly NetworkRule[]>> };

export interface CommandAsk {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface DetachedCommandAsk extends CommandAsk {
  readonly sudo: boolean;
}

interface SandboxCreate {
  readonly name: string;
  readonly image: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly vcpus: number;
  readonly keepLastSnapshots: {
    readonly count: number;
    readonly expiration?: number;
    readonly deleteEvicted: boolean;
  };
  readonly env: Readonly<Record<string, string>>;
  readonly whenNameTaken: NameTaken;
  readonly mounts?: Readonly<Record<string, string>>;
  readonly persistent?: boolean;
}

interface ListedDrive {
  readonly name: string;
  readonly currentSandboxName?: string | undefined;
}

export interface SandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly mode: number;
}

export const LIST_ORDER = { OLDEST_FIRST: "asc", NEWEST_FIRST: "desc" } as const;

export type ListOrder = (typeof LIST_ORDER)[keyof typeof LIST_ORDER];

interface SandboxPage {
  readonly sandboxes: readonly ListedSandbox[];
  readonly next: string | undefined;
}

export interface SessionRef {
  readonly name: string;
  readonly sessionId: string;
}

export interface SandboxSessionApi {
  readonly run: (ask: CommandAsk) => Effect.Effect<CommandRun, SandboxUnavailable>;
  readonly openInteractive: () => Effect.Effect<InteractiveShell, SandboxUnavailable>;
  readonly stop: () => Effect.Effect<void, SandboxUnavailable>;
  readonly extendTimeout: (durationMs: number) => Effect.Effect<void, SandboxUnavailable>;
  readonly snapshot: (expiresAfter: Duration.Duration) => Effect.Effect<string, SandboxUnavailable>;
  readonly writeFiles: (files: readonly SandboxFile[]) => Effect.Effect<void, SandboxUnavailable>;
  readonly updateNetworkPolicy: (policy: NetworkPolicy) => Effect.Effect<void, SandboxUnavailable>;
  readonly start: (ask: DetachedCommandAsk) => Effect.Effect<string, SandboxUnavailable>;
  readonly writeStdin: (commandId: string, text: string) => Effect.Effect<void, SandboxUnavailable>;
  readonly commandExit: (
    commandId: string,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  readonly commandStderrTail: (
    commandId: string,
    secrets?: readonly string[],
  ) => Effect.Effect<string | undefined, SandboxUnavailable>;
  readonly kill: (commandId: string) => Effect.Effect<void, SandboxUnavailable>;
}

export interface VercelSandboxApi {
  readonly listTagged: (
    sessionId: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
  readonly listRunning: (
    cursor: string | undefined,
    order: ListOrder,
  ) => Effect.Effect<SandboxPage, SandboxUnavailable>;
  readonly resume: (name: string) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  readonly deleteSandbox: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  readonly session: (ref: SessionRef) => Effect.Effect<SandboxSessionApi, SandboxUnavailable>;
  readonly create: (ask: SandboxCreate) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  readonly createUser: (
    name: string,
    username: string,
    homeFolders: readonly string[],
  ) => Effect.Effect<void, SandboxUnavailable>;
  readonly startAsUser: (
    name: string,
    username: string,
    ask: CommandAsk,
  ) => Effect.Effect<string, SandboxUnavailable>;
  readonly getNamed: (name: string) => Effect.Effect<ListedSandbox | undefined, SandboxUnavailable>;
  readonly getDrive: (name: string) => Effect.Effect<ListedDrive | undefined, SandboxUnavailable>;
  readonly getOrCreateDrive: (name: string) => Effect.Effect<ListedDrive, SandboxUnavailable>;
  readonly forkDrive: (
    source: string,
    name: string,
  ) => Effect.Effect<ListedDrive, SandboxUnavailable>;
  readonly deleteDrive: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  readonly updateTags: (
    name: string,
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

export const SandboxFetch = Context.Reference<typeof globalThis.fetch>(
  "@repo/service/SandboxFetch",
  { defaultValue: () => (input, init) => globalThis.fetch(input, init) },
);

const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

const SANDBOX_SHELL_ADDRESS = {
  HOST_SUFFIX: ".vercel.run",
  PROTOCOLS: new Set(["wss:", "https:"]),
} as const;

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

const DETAIL_CHARS = 300;

const UNREADABLE_DETAIL = "an answer that could not be read";

const TOKEN_SHAPED = /[A-Za-z0-9._~+-]{20,}=*/gu;

const ERROR_CODE = /^[a-z]+(?:_[a-z]+){0,7}$/u;

const REDACTED_DETAIL = "[redacted]";

function capped(text: string): string {
  return clipped(text.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim());
}

const STDERR_TAIL_CHARS = 600;

function stderrTail(stderr: string, secrets: readonly string[]): string {
  const named = secrets
    .filter((secret) => secret.length > 0)
    .reduce((said, secret) => said.split(secret).join(REDACTED_DETAIL), stderr);
  const said = named.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim();
  return said.length > STDERR_TAIL_CHARS ? `…${said.slice(-STDERR_TAIL_CHARS)}` : said;
}

function clipped(line: string): string {
  return line.length > DETAIL_CHARS ? `${line.slice(0, DETAIL_CHARS - 1)}…` : line;
}

const CAUSE_DEPTH = 3;

function causeDetail(cause: unknown): string {
  const said: string[] = [];
  let at: unknown = cause;
  while (at instanceof Error && said.length < CAUSE_DEPTH) {
    said.push(`${at.name}: ${at.message}`);
    at = at.cause;
  }
  return capped(said.length === 0 ? typeof cause : said.join(" <- "));
}

function errorDetail(text: string): string | undefined {
  const read = readErrorAnswer(jsonOf(text));
  if (Result.isFailure(read)) return undefined;
  const { code, message } = read.success.error;
  const named = code !== undefined && ERROR_CODE.test(code) ? code : undefined;
  const said = [named === undefined ? code : undefined, message].filter(
    (each): each is string => each !== undefined && each.trim() !== "",
  );
  const rest = said.length === 0 ? undefined : capped(said.join(": "));
  if (named === undefined) return rest;
  return rest === undefined ? named : clipped(`${named}: ${rest}`);
}

function errorCode(text: string): string | undefined {
  const read = readErrorAnswer(jsonOf(text));
  if (Result.isFailure(read)) return undefined;
  const { code } = read.success.error;
  return code !== undefined && ERROR_CODE.test(code) ? code : undefined;
}

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

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

function sdkCall<A>(
  call: SandboxCall,
  run: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, SandboxUnavailable> {
  return Effect.tryPromise({ try: run, catch: (cause) => sdkFailure(call, cause) });
}

function isGone(failure: SandboxUnavailable): boolean {
  return failure.status === NOT_FOUND_STATUS;
}

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

function driveMounts(mounts: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(mounts).map(([path, drive]) => [path, { drive, mode: "read-write" as const }]),
  );
}

function listedDrive(drive: Drive): ListedDrive {
  return { name: drive.name, currentSandboxName: drive.currentSandboxName };
}

type ListedMetadata = Awaited<ReturnType<typeof Sandbox.list>>["sandboxes"][number];

function listedOf(listed: ListedMetadata): ListedSandbox {
  return {
    name: listed.name,
    status: listed.status,
    currentSessionId: listed.currentSessionId,
    tags: listed.tags,
    currentSnapshotId: listed.currentSnapshotId,
    createdAt: listed.createdAt,
    timeout: listed.timeout,
    expiresAt: listed.expiresAt,
    keepLastSnapshots: listed.keepLastSnapshots,
  };
}

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
    expiresAt: sandbox.expiresAt?.getTime(),
    keepLastSnapshots: sandbox.keepLastSnapshots,
  };
}

function runningOnly(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    url.searchParams.set("status", SANDBOX_STATUS.RUNNING);
    return fetch(url, init);
  };
}

function sessionEnded(call: SandboxCall): SandboxUnavailable {
  return new SandboxUnavailable({ call, status: NOT_FOUND_STATUS, detail: "the session ended" });
}

function sessionCallsOf(current: Option.Option<Session>): SandboxSessionApi {
  const commands = new Map<string, Command>();
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
    updateNetworkPolicy: (policy) =>
      on(SANDBOX_CALL.NETWORK_POLICY, (session, signal) =>
        session.update({ networkPolicy: sdkPolicyOf(policy) }, { signal }),
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
      onCommand(SANDBOX_CALL.STDIN, commandId, (command, signal) =>
        command.writeStdin(text, { abortSignal: signal }),
      ),
    commandExit: (commandId, within = SANDBOX_API.EXIT_WAIT) =>
      onCommand(SANDBOX_CALL.CMD, commandId, async (command, signal) => {
        const finished = await command.wait({ signal });
        return finished.exitCode;
      }).pipe(
        Effect.timeoutOption(within),
        Effect.map((exit): CommandExit => (Option.isNone(exit) ? null : exit.value)),
        Effect.catchIf(isGone, () => Effect.succeed<CommandExit>(COMMAND_GONE)),
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

export type OidcTokenRead = () => Promise<string>;

export const deploymentOidcToken: OidcTokenRead = () => getVercelOidcToken();

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

export function vercelSandboxApi(readToken: OidcTokenRead): Effect.Effect<VercelSandboxApi> {
  return Effect.map(Effect.service(SandboxFetch), (fetch) => {
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

    const asked = <A>(
      call: SandboxCall,
      run: (
        signal: AbortSignal,
        under: Effect.Success<ReturnType<typeof credentials>>,
      ) => Promise<A>,
    ) =>
      Effect.flatMap(credentials(call), (under) => sdkCall(call, (signal) => run(signal, under)));

    const found = (call: SandboxCall, name: string) =>
      asked(call, (signal, under) => Sandbox.get({ ...under, name, resume: false, signal }));

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
      create: (ask) =>
        asked(SANDBOX_CALL.CREATE, (signal, under) =>
          Sandbox.create({
            ...under,
            image: ask.image,
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
          Effect.catchIf(
            (failure) =>
              ask.whenNameTaken === NAME_TAKEN.JOIN && failure.status === NAME_TAKEN_STATUS,
            () => resume(ask.name),
          ),
        ),
      createUser: (name, username, homeFolders) =>
        asked(SANDBOX_CALL.USER, async (signal, under) => {
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          const user = await sandbox.createUser(username, { signal });
          const { group } = await sandbox.getDefaultUser({ signal });
          await sandbox.addUserToGroup(username, group, { signal });
          for (const folder of homeFolders) await user.mkDir(folder, { signal });
          const closed = await user.runCommand("chmod", ["700", user.homeDir], { signal });
          if (closed.exitCode !== 0) throw new Error(`${user.homeDir} could not be closed`);
        }),
      startAsUser: (name, username, ask) =>
        asked(SANDBOX_CALL.CMD, async (signal, under) => {
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          const command = await sandbox.asUser(username).runCommand({
            cmd: ask.command,
            args: [...ask.args],
            ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
            ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
            detached: true,
            stdin: true,
            signal,
          });
          return command.cmdId;
        }),
      getNamed: (name) =>
        found(SANDBOX_CALL.GET, name).pipe(
          Effect.map((sandbox): ListedSandbox | undefined => openedOf(sandbox)),
          Effect.catchIf(isGone, () => Effect.succeed(undefined)),
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
        Effect.map(
          asked(SANDBOX_CALL.DRIVE_CREATE, (signal, under) =>
            Drive.getOrCreate({ ...under, name, signal }),
          ),
          listedDrive,
        ),
      forkDrive: (source, name) =>
        Effect.map(
          asked(SANDBOX_CALL.DRIVE_FORK, async (signal, under) => {
            const drive = await Drive.get({ ...under, name: source, signal });
            return drive.fork({ name, signal });
          }),
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
