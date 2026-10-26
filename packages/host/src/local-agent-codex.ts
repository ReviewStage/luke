import { Duration, Effect, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/**
 * local-agent-codex.ts -- whether Codex on this Mac holds a sign-in of its own, which a local Codex agent there runs on in place of the account's credential.
 *
 * The Codex asked is the one the Mac had through its pin
 * (`local-agent-tools.ts`, `@luke/agent-runner/pins`' `CODEX_MAC_PIN`). The
 * sign-in is read as app-server documents it
 * (https://learn.chatgpt.com/docs/app-server, Authentication): the binary
 * started as `codex app-server` under the developer's own variables and
 * never `CODEX_HOME` of Luke's, so it reads the user's default, asked
 * `account/read` without a refresh, and ended. A managed ChatGPT login or an
 * API key `codex login` stored is a sign-in; no account is none; a Codex
 * that does not answer in time says nothing either way. Nothing it answers
 * beyond whether there is an account is kept, and no token is ever in it.
 */

/** How long Codex has to answer `account/read`. */
const SIGN_IN_TIMEOUT = Duration.seconds(20);

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
