import { readEither } from "@repo/wire/effect";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Redacted,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { HttpClient } from "effect/http";
import { WebSocket } from "ws";
import { EXCESS_KEYS } from "../core.js";
import { jsonOf } from "../http/http-effect.js";
import { voiceSocket } from "../http/socket.js";
import type { RelayFrame, RelaySocket } from "../terminal/relay.js";
import { type InteractiveShell, SandboxUnavailable } from "./vercel-sandbox-api.js";

const PTY_CONNECT = {
  OPEN_TIMEOUT: Duration.seconds(10),
  HEALTH_RETRIES: 5,
  HEALTH_SPACING: Duration.millis(100),
} as const;

const PtyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readPtyExit = readEither(PtyExitSchema, { excess: EXCESS_KEYS.DROP });

export function ptyLinesOf(frames: Stream.Stream<RelayFrame>): Stream.Stream<string> {
  const decoder = new TextDecoder();
  return frames.pipe(
    Stream.takeWhile(
      (frame) => "bytes" in frame || Result.isFailure(readPtyExit(jsonOf(frame.text))),
    ),
    Stream.map((frame) =>
      "bytes" in frame ? decoder.decode(frame.bytes, { stream: true }) : frame.text,
    ),
    Stream.splitLines,
  );
}

export function connectPty(
  shell: InteractiveShell,
  client: HttpClient.HttpClient,
): Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope> {
  return Effect.gen(function* () {
    const address = new URL(shell.url);
    const health = new URL("/health", `https://${address.host}`);
    yield* client.get(health).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.void
          : Effect.fail(new SandboxUnavailable({ status: response.status })),
      ),
      Effect.scoped,
      Effect.retry({
        schedule: Schedule.spaced(PTY_CONNECT.HEALTH_SPACING),
        times: PTY_CONNECT.HEALTH_RETRIES,
      }),
      Effect.mapError(() => new SandboxUnavailable({})),
    );
    address.searchParams.set("token", Redacted.value(shell.token));
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(address)),
      (open) => Effect.sync(() => open.close()),
    );
    yield* Effect.callback<void, SandboxUnavailable>((resume) => {
      socket.once("open", () => resume(Effect.void));
      socket.once("error", () => resume(Effect.fail(new SandboxUnavailable({}))));
    }).pipe(
      Effect.timeoutOrElse({
        duration: PTY_CONNECT.OPEN_TIMEOUT,
        orElse: () => Effect.fail(new SandboxUnavailable({})),
      }),
    );
    return yield* voiceSocket(socket);
  });
}

export interface SandboxPtyService {
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
}

export class SandboxPty extends Context.Service<SandboxPty, SandboxPtyService>()("SandboxPty") {}

/** @public */
export const sandboxPtyLayer: Layer.Layer<SandboxPty, never, HttpClient.HttpClient> = Layer.effect(
  SandboxPty,
  Effect.map(HttpClient.HttpClient, (client) => ({
    connect: (shell: InteractiveShell) => connectPty(shell, client),
  })),
);
