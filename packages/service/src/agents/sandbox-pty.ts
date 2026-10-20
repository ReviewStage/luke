/**
 * sandbox-pty.ts -- a sandbox session's PTY reached by WebSocket: the socket opened under its minted token once its server answers healthy.
 *
 * The terminal relay pipes a developer's shell over it, and the agent's
 * browser carries its DevTools protocol over it (`browser/agent-browser.ts`),
 * so the sandbox exposes no port of its own for either. The token is set on
 * the address at the moment of the open and goes nowhere else.
 */

import { Context, Duration, Effect, Layer, Redacted, Schedule, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { WebSocket } from "ws";
import type { RelaySocket } from "../terminal/relay.js";
import { voiceSocket } from "../voice/socket.js";
import { type InteractiveShell, SandboxUnavailable } from "./vercel-sandbox-api.js";

const PTY_CONNECT = {
  /** How long the PTY's socket may take to open. */
  OPEN_TIMEOUT: Duration.seconds(10),
  /** How many times the PTY server's health is asked before the socket opens, as Vercel's own CLI asks it. */
  HEALTH_RETRIES: 5,
  HEALTH_SPACING: Duration.millis(100),
} as const;

/** The PTY's socket opened under its minted token, once its server answers healthy, for the scope it is opened in. */
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
  /** Opens the PTY's socket for the caller's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
}

export class SandboxPty extends Context.Service<SandboxPty, SandboxPtyService>()("SandboxPty") {}

/** The PTY as the deployment reaches it, over the runtime's HTTP client and `ws`. @public */
export const sandboxPtyLayer: Layer.Layer<SandboxPty, never, HttpClient.HttpClient> = Layer.effect(
  SandboxPty,
  Effect.map(HttpClient.HttpClient, (client) => ({
    connect: (shell: InteractiveShell) => connectPty(shell, client),
  })),
);
