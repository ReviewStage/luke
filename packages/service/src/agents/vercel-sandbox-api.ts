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
 * `updateNetworkPolicy` when it moves), directly rather than through the SDK,
 * because
 * the SDK bundled into a function fails it as it loads and carries a dozen
 * Node modules these calls never use.
 *
 * Every sandbox eve opens carries its session's id as a tag, so a session's
 * sandbox is found by the tag alone; a session has one, so the first page is
 * all of them. What is sent is a tag, a name, and the argv of a command Luke
 * wrote; what a failure carries is its status alone. A deployment without an
 * OIDC token answers every call as unavailable.
 */

import { readEither } from "@luke/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { Data, Effect, Redacted, Result, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";

/** The tag eve sets on every session's sandbox, its value the session's id. */
const SESSION_TAG = "sessionId";

/** Vercel's answer for a sandbox or session already gone. */
const NOT_FOUND_STATUS = 404;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

const SANDBOX_API = {
  ORIGIN: "https://vercel.com",
  PATH: "/api/v2/sandboxes",
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

/** A sandbox as a list or a lookup names it: its name, where it stands, and the session it runs while up. */
export interface ListedSandbox {
  readonly name: string;
  readonly status?: string | undefined;
  readonly currentSessionId?: string | undefined;
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

/** A sandbox session's network policy as the API takes it: every host open, and on the hosts named, headers the firewall sets on the way out. */
interface NetworkPolicy {
  readonly allow: Readonly<
    Record<
      string,
      readonly {
        readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
      }[]
    >
  >;
}

/** The argv of a command Luke wrote, and where it runs. */
export interface CommandAsk {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface VercelSandboxApi {
  /** Every sandbox carrying the session's tag. */
  readonly listTagged: (
    sessionId: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
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
  /** Sets the running sandbox session's network policy whole. */
  readonly updateNetworkPolicy: (
    sandboxSessionId: string,
    policy: NetworkPolicy,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

/** The OIDC token's claims the API is asked under: the project and team it names. */
const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

const ListedSandboxSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.optional(Schema.String),
  currentSessionId: Schema.optional(Schema.String),
});

/** A page of the sandboxes listed under a tag. */
const ListedSandboxesSchema = Schema.Struct({ sandboxes: Schema.Array(ListedSandboxSchema) });

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
const readFound = readEither(FoundSandboxSchema, { excess: EXCESS_KEYS.DROP });
const readCommandLine = readEither(CommandLineSchema, { excess: EXCESS_KEYS.DROP });

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
    };
  });
}
