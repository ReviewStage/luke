import { CODEX_MAC_PIN, CODEX_PIN } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Path, Schema, Stream } from "effect";
import { Hex } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcess } from "effect/process";

/**
 * local-agent-codex.ts -- Codex for this Mac's local agents: the pinned build found where the app ships one, or fetched once, checked, and kept in the app's own folder; and whether Codex on this Mac holds a sign-in of its own.
 *
 * The build is the cloud's Codex release (`@luke/agent-runner/pins`'
 * `CODEX_PIN`), as npm's macOS arm64 package of it (`CODEX_MAC_PIN`). One
 * resolver answers its binary whichever way it came: the copy the app
 * ships, where it ships one, or the one kept under the state root, fetched
 * the first time it is asked for. A fetch keeps nothing unless the archive's
 * SHA-256 is the pin's, extracts only the pinned members into a folder of
 * its own beside the kept one, and moves it into place whole with a mark
 * written last, so a fetch cut off leaves nothing that is ever run.
 *
 * The sign-in is read as app-server documents it
 * (https://learn.chatgpt.com/docs/app-server, Authentication): the binary
 * started as `codex app-server` under the developer's own variables and
 * never `CODEX_HOME` of Luke's, so it reads the user's default, asked
 * `account/read` without a refresh, and ended. A managed ChatGPT login or an
 * API key `codex login` stored is a sign-in; no account is none; a Codex
 * that does not answer in time says nothing either way. Nothing it answers
 * beyond whether there is an account is kept, and no token is ever in it.
 */

const CODEX_FETCH = {
  /** How long the archive, a little over a hundred megabytes, may take to arrive. */
  TIMEOUT: Duration.minutes(10),
  /** Where under the state root the kept build stands, one folder per release. */
  FOLDER: ["agent-tools", "codex"],
  /** The mark written once the build is checked and in place. */
  MARK: ".verified",
} as const;

/** How long Codex has to answer `account/read`. */
const SIGN_IN_TIMEOUT = Duration.seconds(20);

const HTTP_OK = 200;

/** The JSON-RPC lines the sign-in read writes: Codex's handshake, then the read without a refresh. */
const SIGN_IN_LINES = [
  {
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "Luke", title: "Luke", version: "host" }, capabilities: null },
  },
  { method: "initialized" },
  { id: 2, method: "account/read", params: { refreshToken: false } },
];

/** The id the read's answer comes back under. */
const READ_ID = 2;

/** The answer to the read, as far as it is read: whether Codex holds an account. */
const AccountAnswerSchema = Schema.Struct({
  id: Schema.Literal(READ_ID),
  result: Schema.Struct({ account: Schema.NullOr(Schema.Unknown) }),
});

const decodeAccountAnswer = Schema.decodeUnknownResult(Schema.fromJsonString(AccountAnswerSchema));

/** Where the kept build stands under the state root, for this release. */
function keptFolder(path: Path.Path, stateRoot: string): string {
  return path.join(stateRoot, ...CODEX_FETCH.FOLDER, CODEX_PIN.VERSION);
}

/**
 * The archive fetched, checked against the pin, and its members kept under
 * `folder`, moved into place whole and marked; fails where any step does.
 */
const fetchCodex = Effect.fnUntraced(function* (folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .get(CODEX_MAC_PIN.ARCHIVE)
    .pipe(Effect.timeout(CODEX_FETCH.TIMEOUT));
  if (response.status !== HTTP_OK) return yield* Effect.fail("fetch refused");
  // Note that the archive is read into a buffer of the pin's size and no larger, so an answer
  // longer than the pinned archive is refused as it arrives rather than held whole.
  const archive = new Uint8Array(CODEX_MAC_PIN.BYTES);
  const received = yield* response.stream.pipe(
    Stream.runFoldEffect(
      () => 0,
      (filled, chunk: Uint8Array) =>
        filled + chunk.length > archive.length
          ? Effect.fail("too large")
          : Effect.sync(() => {
              archive.set(chunk, filled);
              return filled + chunk.length;
            }),
    ),
  );
  if (received !== archive.length) return yield* Effect.fail("short");
  const digest = yield* Effect.tryPromise(() => crypto.subtle.digest("SHA-256", archive));
  // Note that nothing of an archive whose digest is not the pin's is written anywhere.
  if (Hex.encode(new Uint8Array(digest)) !== CODEX_MAC_PIN.SHA256) {
    return yield* Effect.fail("checksum");
  }
  const parent = path.dirname(folder);
  yield* fileSystem.makeDirectory(parent, { recursive: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fileSystem.makeTempDirectoryScoped({
        directory: parent,
        prefix: ".codex-",
      });
      const saved = path.join(staging, "codex.tgz");
      yield* fileSystem.writeFile(saved, archive);
      const members = CODEX_MAC_PIN.MEMBERS.map(
        (member: string) => `${CODEX_MAC_PIN.ROOT}/${member}`,
      );
      const code = yield* Effect.flatMap(
        ChildProcess.make("/usr/bin/tar", ["-xzf", saved, "-C", staging, ...members], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
        (handle) => handle.exitCode,
      );
      if (Number(code) !== 0) return yield* Effect.fail("extract");
      yield* fileSystem.remove(folder, { recursive: true, force: true });
      yield* fileSystem.rename(path.join(staging, CODEX_MAC_PIN.ROOT), folder);
    }),
  );
  yield* fileSystem.writeFileString(
    path.join(folder, CODEX_FETCH.MARK),
    `${CODEX_MAC_PIN.SHA256}\n`,
  );
});

/**
 * Codex's binary for this Mac's local agents: `bundled` where the app ships
 * one and it stands there, the kept build where it was checked and marked,
 * and otherwise the build fetched now; none where it cannot be had, which
 * the caller asks again later.
 */
export const localAgentCodex = Effect.fnUntraced(function* (
  stateRoot: string,
  bundled: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  if (bundled !== undefined && (yield* exists(bundled))) return Option.some(bundled);
  const folder = keptFolder(path, stateRoot);
  const binary = path.join(folder, CODEX_MAC_PIN.BINARY);
  const kept = (yield* exists(path.join(folder, CODEX_FETCH.MARK))) && (yield* exists(binary));
  if (kept) return Option.some(binary);
  return yield* fetchCodex(folder).pipe(
    Effect.as(Option.some(binary)),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
});

/**
 * Whether Codex at `executable` holds a sign-in of its own under the user's
 * default `CODEX_HOME`, asked under `env` alone; none where it did not say.
 */
export const localCodexSignedIn = Effect.fnUntraced(function* (
  executable: string,
  env: Readonly<Record<string, string>>,
) {
  const encoder = new TextEncoder();
  const lines = SIGN_IN_LINES.map((line) => encoder.encode(`${JSON.stringify(line)}\n`));
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(executable, ["app-server", "--listen", "stdio://"], {
        env,
        extendEnv: false,
        // Note that stdin stays open until the answer is read, since app-server ends with it.
        stdin: { stream: Stream.fromIterable(lines), endOnDone: false },
        stderr: "ignore",
      });
      const answer = yield* handle.stdout.pipe(
        Stream.decodeText,
        Stream.splitLines,
        Stream.filterMap((line) => decodeAccountAnswer(line)),
        Stream.runHead,
      );
      return Option.map(answer, (read) => read.result.account !== null);
    }),
  ).pipe(
    Effect.timeoutOption(SIGN_IN_TIMEOUT),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<boolean>()),
  );
});
