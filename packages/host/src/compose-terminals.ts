import { Effect, FiberMap, type Scope, type Stream } from "effect";
import type { AccountComposer } from "./compose-account.js";
import { browserLiveConcern } from "./compose-browser-live.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-terminals.ts -- the terminals concern: the relay socket every live channel to the service opens over, and a cloud Browser tab's live view carried on it.
 *
 * The socket is the platform's (`TerminalSocket`): the desktop opens it from
 * Node with the account's bearer, a browser tab from the page under its
 * cookie. Opened under the account's credential (`relay-credential.ts`), it
 * carries each live read (`live-socket.ts`), each cloud agent's mirror
 * (`compose-mirrors.ts`), and the live view (`compose-browser-live.ts`),
 * whose methods this concern answers. A cloud agent's Terminal tab no longer
 * opens one: its shells run on this Mac, in the agent's mirror.
 */

/** What one relay socket hands up: a binary frame's bytes, a text frame, or the close code that ended it, last. */
export type TerminalSocketArrival =
  | { readonly bytes: Uint8Array }
  | { readonly text: string }
  | { readonly close: number };

/** What the host sends on a relay socket: typed bytes, or a text frame. */
export type TerminalSocketFrame = { readonly bytes: Uint8Array } | { readonly text: string };

/** An open relay socket: what arrives on it, ending with its close, and what the host does with it. */
export interface TerminalSocket {
  readonly arrivals: Stream.Stream<TerminalSocketArrival>;
  send(frame: TerminalSocketFrame): Effect.Effect<void>;
  /** Stops reading the network until `resume`, so the far side holds what it has not sent. */
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
}

/** How an open ended: the socket, the status the upgrade was refused with, or nothing that answered. */
export type TerminalSocketOpening =
  | { readonly socket: TerminalSocket }
  | { readonly refused: number }
  | { readonly unreachable: true };

/** Opens one relay socket with the handshake headers given; the scope's close closes it. */
export type OpenTerminalSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Effect.Effect<TerminalSocketOpening, never, Scope.Scope>;

export interface TerminalsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  openSocket: OpenTerminalSocket;
}

export interface TerminalsComposer extends Composer {
  /** Every live view ended, as a sign-out ends them. */
  readonly reset: Effect.Effect<void>;
}

export function composeTerminals(
  dependencies: TerminalsDependencies,
): Effect.Effect<TerminalsComposer, never, Scope.Scope> {
  return Effect.gen(function* () {
    const views = browserLiveConcern(dependencies, yield* FiberMap.make<string>());
    return { methods: views.methods, lifetime: Effect.void, reset: views.reset };
  });
}
