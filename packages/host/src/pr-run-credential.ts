import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { Duration, Effect, Redacted, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { PlatformError } from "effect/PlatformError";

/**
 * pr-run-credential.ts -- the token a pull request is fetched with, handed to Git through a credential helper that reads it from a private socket, for the length of one fetch.
 *
 * The token never rides in an argument, an environment variable, a URL, a
 * file, or Git's configuration. The host listens on a Unix socket in a
 * folder only this user may open; the helper Git is told of, by flags on
 * the one fetch's command line, is this app's own runtime run as Node, which
 * connects to the socket, hands it Git's request, and copies the answer to
 * Git on its standard output. The host answers only a request for
 * `https://github.com/<owner>/<name>.git`, the one repository the token is
 * for, so a redirect or a URL rewrite that sends Git anywhere else asks in
 * vain. The socket is closed and its folder removed when the scope that
 * opened it closes, which is before anything the pull request holds runs.
 *
 * The helper needs the app's runtime to run as Node (`ELECTRON_RUN_AS_NODE`),
 * which Electron allows unless that fuse is turned off; a build that turns it
 * off must hand Git another way to reach the socket.
 */

/** The program the helper runs as Node, and what its environment adds to tell it so. */
export interface CredentialHelperRuntime {
  readonly path: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** The most bytes a request on the socket may carry; Git's is a few short lines. */
const MAX_REQUEST_BYTES = 8 * 1024;

/** The account name GitHub takes an installation token under. */
const TOKEN_USERNAME = "x-access-token";

/** What the helper runs: connect to the socket named first, send it stdin, copy its answer to stdout. */
const HELPER_SCRIPT = [
  'const s = require("node:net").connect(process.argv[1]);',
  "process.stdin.pipe(s);",
  "s.pipe(process.stdout);",
  's.on("error", () => process.exit(0));',
].join(" ");

/** A word quoted for the POSIX shell Git runs a helper under. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Git's credential request read as its keys and values; a key given twice keeps its last. */
function credentialRequest(text: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1));
  }
  return fields;
}

/** Whether the request is for the one repository, over HTTPS on GitHub, and nothing else. */
export function credentialAsked(text: string, repository: string): boolean {
  const fields = credentialRequest(text);
  return (
    fields.get("protocol") === "https" &&
    fields.get("host")?.toLowerCase() === "github.com" &&
    fields.get("path")?.toLowerCase() === `${repository.toLowerCase()}.git`
  );
}

/** One connection read whole and answered with the token where it asks for the repository, with nothing otherwise. */
function answerConnection(socket: Socket, repository: string, token: Redacted.Redacted<string>) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  socket.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      socket.destroy();
      return;
    }
    chunks.push(chunk);
  });
  socket.on("end", () => {
    const asked = credentialAsked(Buffer.concat(chunks).toString("utf8"), repository);
    if (!asked) {
      socket.end();
      return;
    }
    socket.end(`username=${TOKEN_USERNAME}\npassword=${Redacted.value(token)}\n\n`);
  });
  socket.on("error", () => socket.destroy());
}

/** The server listening on the socket path, closed with every connection as the scope closes. */
function listening(socketPath: string, repository: string, token: Redacted.Redacted<string>) {
  return Effect.acquireRelease(
    Effect.callback<{ server: Server; sockets: Set<Socket> }, Error>((resume) => {
      const sockets = new Set<Socket>();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        answerConnection(socket, repository, token);
      });
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(socketPath, () => resume(Effect.succeed({ server, sockets })));
    }),
    ({ server, sockets }) =>
      Effect.sync(() => {
        for (const socket of sockets) socket.destroy();
        server.close();
      }),
  );
}

/**
 * The token served on a private socket for as long as the scope stands,
 * answered as the flags a Git fetch is run with to ask for it: inherited
 * helpers cleared, this one named, and the repository's path sent with each
 * request so the host can hold it to the one repository.
 */
export function servedCredential(
  runtime: CredentialHelperRuntime,
  repository: string,
  token: Redacted.Redacted<string>,
): Effect.Effect<readonly string[], PlatformError | Error, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // Note that mkdtemp makes the folder readable by this user alone, so no one else can reach the socket in it.
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: "luke-git-" });
    const socketPath = path.join(folder, "s");
    yield* listening(socketPath, repository, token);
    const environment = Object.entries(runtime.environment)
      .map(([name, value]) => `${name}=${shellQuoted(value)}`)
      .join(" ");
    const helper = [
      "!f() {",
      'test "$1" = get || exit 0;',
      `${environment} ${shellQuoted(runtime.path)} -e ${shellQuoted(HELPER_SCRIPT)} ${shellQuoted(socketPath)};`,
      "}; f",
    ].join(" ");
    return [
      "-c",
      "credential.helper=",
      "-c",
      `credential.helper=${helper}`,
      "-c",
      "credential.useHttpPath=true",
    ];
  });
}

/** Where GitHub takes an installation token back. */
const GITHUB_REVOKE_TOKEN_URL = "https://api.github.com/installation/token";

/** How long a revoke is waited on before it is let go; the token lapses on its own within the hour. */
const REVOKE_TIMEOUT = Duration.seconds(5);

/**
 * The installation token given back to GitHub, so it is good for nothing
 * once its fetch is done; best effort, since the token lapses on its own
 * within the hour, and never failing. Nothing of the answer is read.
 */
export function revokeInstallationToken(token: Redacted.Redacted<string>): Effect.Effect<void> {
  const request = HttpClientRequest.delete(GITHUB_REVOKE_TOKEN_URL).pipe(
    HttpClientRequest.bearerToken(Redacted.value(token)),
    HttpClientRequest.setHeaders({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    }),
  );
  return Effect.flatMap(HttpClient.HttpClient, (client) => client.execute(request)).pipe(
    Effect.timeout(REVOKE_TIMEOUT),
    Effect.scoped,
    Effect.ignore,
    Effect.provide(FetchHttpClient.layer),
  );
}
