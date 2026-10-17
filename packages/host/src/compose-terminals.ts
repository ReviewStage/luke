import {
  type HostedTerminalClient,
  TERMINAL_UNANSWERED,
  type TerminalUnanswered,
  terminalRelayAddress,
  webSocketOrigin,
} from "@luke/features";
import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  type TerminalConnection,
  terminalAckParamsSchema,
  terminalAgentParamsSchema,
  terminalConnectionParamsSchema,
  terminalConnectParamsSchema,
  terminalCreateParamsSchema,
  terminalInputParamsSchema,
  terminalRenameParamsSchema,
  terminalResizeParamsSchema,
  terminalShellParamsSchema,
} from "@luke/features/terminal-view";
import {
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
  terminalRelayServiceFrameSchema,
} from "@luke/features/terminal-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  RefusedRefusal,
} from "@luke/gateway";
import { type UnparsedWireValue, unparsedWire, type WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Data,
  Duration,
  Effect,
  FiberMap,
  Result,
  Schedule,
  type Schema,
  type Scope,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-terminals.ts -- a coding agent's terminals, on the window's behalf: its shells listed, started, named, and ended, its sandbox resumed, and each shell a panel attached held open on the service's relay.
 *
 * The REST calls are one service call each, answered whole. An attached
 * shell is a connection the desktop named, held here on one fiber for as
 * long as the tab wants it: the fiber opens the relay socket under the
 * account's bearer, hands up what the shell printed as `TERMINAL_OUTPUT`
 * events named by that connection, and says how the connection stands as
 * `TERMINAL_STATE` events. A socket that dropped — a sleep, a network
 * change, the relay function's bound — is opened again on its own, after a
 * wait that doubles to ten seconds and starts over once the shell attaches;
 * one whose agent has not opened its sandbox is asked after every five
 * seconds; and one the relay ended as idle, stopped, gone, or exited, or
 * one the deployment serves no relay for, stays ended until the tab
 * attaches again. A wake after the Mac slept cuts every
 * wait short. Output is paced to what the tab has drawn: past
 * `PAUSE_ABOVE_BYTES` unacked the socket is no longer read, so the relay
 * backs up rather than this process. Nothing a shell printed is kept here,
 * logged, or counted: it is handed to the event and let go.
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

/** How long a connection waits before it opens its socket again. */
export const TERMINAL_RECONNECT = {
  /** The first wait after a drop, doubling on each drop before the shell attaches again. */
  FIRST: Duration.millis(500),
  /** The longest wait after a drop. */
  LONGEST: Duration.seconds(10),
  /** The wait between asks while the agent has not opened its sandbox. */
  STARTING_EVERY: Duration.seconds(5),
} as const;

/** The service's side of the terminals, as this concern asks it. */
export type TerminalClient = Pick<
  HostedTerminalClient,
  "list" | "create" | "rename" | "kill" | "resume"
>;

export interface TerminalsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "token">;
  client: TerminalClient;
  openSocket: OpenTerminalSocket;
}

export interface TerminalsComposer extends Composer {
  /** Every connection ended, as a sign-out ends them; each tab hears it idle, so a key press attaches again. */
  readonly reset: Effect.Effect<void>;
}

/** The status of an upgrade a server refused for want of itself rather than the ask: it may answer the next one. */
const SERVER_ERROR_STATUS = 500;

/** The status of an upgrade to a path the deployment does not serve, which the relay never answers of an agent or shell. */
const NOT_FOUND_STATUS = 404;

const RECONNECT_BACKOFF = Schedule.exponential(TERMINAL_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, TERMINAL_RECONNECT.LONGEST)),
  ),
);

/** The states a relay's close ends a connection in, by its code; any other close is a drop. */
const ENDED_BY_CLOSE: ReadonlyMap<number, TerminalConnection> = new Map([
  [TERMINAL_RELAY_CLOSE.IDLE, TERMINAL_CONNECTION.IDLE],
  [TERMINAL_RELAY_CLOSE.STOPPED, TERMINAL_CONNECTION.STOPPED],
  [TERMINAL_RELAY_CLOSE.GONE, TERMINAL_CONNECTION.GONE],
  [TERMINAL_RELAY_CLOSE.EXITED, TERMINAL_CONNECTION.EXITED],
]);

/** How one socket's life ended, where the connection does not try again on its own schedule. */
const SOCKET_ENDING = {
  /** The connection is over until the tab attaches again. */
  ENDED: "ended",
  /** The shell had attached, and the socket dropped: the connection opens again, its wait started over. */
  DROPPED: "dropped",
} as const;

type SocketEnding = (typeof SOCKET_ENDING)[keyof typeof SOCKET_ENDING];

/** The socket dropped, or never opened, before the shell attached. */
class RelayDropped extends Data.TaggedError("RelayDropped") {}

/** The agent has not opened its sandbox yet. */
class SandboxStarting extends Data.TaggedError("SandboxStarting") {}

/** One attached shell, as the desktop named it and as it stands. */
interface Connection {
  readonly connectionId: string;
  readonly agentId: string;
  readonly terminalId: string;
  cols: number;
  rows: number;
  /** The socket the shell is attached on; none while the connection opens or waits. */
  socket: TerminalSocket | undefined;
  /** Bytes handed up that the tab has not acked. */
  unacked: number;
  paused: boolean;
  /** What was typed while the connection was reopening, in order, for the socket that attaches next. */
  typedWhileAway: Uint8Array[];
}

/** The most typing a reopening connection holds for its next socket; typing past it is let go, as a terminal far behind would. */
const TYPED_WHILE_AWAY_MAX_BYTES = 64 * 1024;

const readServiceFrame = readEither(terminalRelayServiceFrameSchema);

/** A text frame as the relay's own, or nothing where it is not JSON this build reads. */
function serviceFrame(text: string) {
  try {
    const parsed: UnparsedWireValue = unparsedWire(JSON.parse(text));
    return Result.getOrUndefined(readServiceFrame(parsed));
  } catch {
    return undefined;
  }
}

/** The relay's resize frame for a connection's size as it stands. */
function resizeFrame(connection: Pick<Connection, "cols" | "rows">): string {
  return JSON.stringify({
    type: TERMINAL_RELAY_FRAME.RESIZE,
    cols: connection.cols,
    rows: connection.rows,
  });
}

export function composeTerminals(
  dependencies: TerminalsDependencies,
): Effect.Effect<TerminalsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>();
    return composed(dependencies, fibers, yield* HttpClient.HttpClient);
  });
}

/** The composer's table and its connections, built over its seams, the map every connection's fiber is held in, and the host's HTTP client. */
function composed(
  dependencies: TerminalsDependencies,
  fibers: FiberMap.FiberMap<string>,
  http: HttpClient.HttpClient,
): TerminalsComposer {
  const { kernel, account, client, openSocket } = dependencies;
  const connections = new Map<string, Connection>();
  const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  const tell = (connection: Connection, state: TerminalConnection, code?: number) =>
    Effect.sync(() =>
      kernel.emit(
        GATEWAY_EVENT.TERMINAL_STATE,
        carried({
          connectionId: connection.connectionId,
          state,
          ...(code === undefined ? undefined : { code }),
        }),
      ),
    );

  /** A shell's bytes handed up, and the socket paused once the tab has fallen far enough behind. */
  const output = (connection: Connection, socket: TerminalSocket, bytes: Uint8Array) =>
    Effect.gen(function* () {
      kernel.emit(
        GATEWAY_EVENT.TERMINAL_OUTPUT,
        carried({ connectionId: connection.connectionId, data: Base64.encode(bytes) }),
      );
      connection.unacked += bytes.length;
      if (connection.paused || connection.unacked <= TERMINAL_FLOW.PAUSE_ABOVE_BYTES) return;
      connection.paused = true;
      yield* socket.pause;
    });

  /** The relay socket opened under the account's bearer; a refusal of it is renewed once, on a bearer that changed. */
  const opened = (address: string) =>
    Effect.gen(function* () {
      const bearer = yield* account.token.readAccessToken();
      if (bearer === undefined) return { refused: 401 } satisfies TerminalSocketOpening;
      const opening = yield* openSocket(address, { authorization: `Bearer ${bearer}` });
      if (!("refused" in opening) || opening.refused !== 401) return opening;
      yield* Effect.ignore(account.token.refreshAccount());
      const renewed = yield* account.token.readAccessToken();
      if (renewed === undefined || renewed === bearer) return opening;
      return yield* openSocket(address, { authorization: `Bearer ${renewed}` });
    });

  /**
   * One socket's life: opened, read until it closes, and its close read as
   * how the connection stands. A drop before the shell attached fails, for
   * the backoff to wait on; one after it answers dropped, so the wait starts
   * over; an agent with no sandbox yet fails as starting.
   */
  const attempt = (connection: Connection) =>
    Effect.scoped(
      Effect.gen(function* () {
        const drop = Effect.andThen(
          tell(connection, TERMINAL_CONNECTION.RECONNECTING),
          Effect.fail(new RelayDropped()),
        );
        if (socketOrigin === undefined) {
          yield* tell(connection, TERMINAL_CONNECTION.GONE);
          return SOCKET_ENDING.ENDED;
        }
        const openedAt = { cols: connection.cols, rows: connection.rows };
        const address = terminalRelayAddress(socketOrigin, { ...connection, ...openedAt });
        const opening = yield* opened(address);
        if ("unreachable" in opening) return yield* drop;
        if ("refused" in opening) {
          if (opening.refused >= SERVER_ERROR_STATUS) return yield* drop;
          // A relay this deployment does not serve is said as such, never as a shell gone, which would close the tab.
          const ended =
            opening.refused === NOT_FOUND_STATUS
              ? TERMINAL_CONNECTION.UNAVAILABLE
              : TERMINAL_CONNECTION.GONE;
          yield* tell(connection, ended);
          return SOCKET_ENDING.ENDED;
        }
        const { socket } = opening;
        Object.assign(connection, { socket, unacked: 0, paused: false });
        // A resize while the socket opened reached no socket, so the size the address carried is set right now.
        if (connection.cols !== openedAt.cols || connection.rows !== openedAt.rows) {
          yield* socket.send({ text: resizeFrame(connection) });
        }
        // Note that only this socket is let go here, because a wake may already have opened the next one.
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (connection.socket === socket) connection.socket = undefined;
          }),
        );
        let attached = false;
        let exitCode: number | undefined;
        let closeCode: number | undefined;
        yield* Stream.runForEach(socket.arrivals, (arrival) => {
          if ("close" in arrival) {
            closeCode = arrival.close;
            return Effect.void;
          }
          if ("bytes" in arrival) return output(connection, socket, arrival.bytes);
          const frame = serviceFrame(arrival.text);
          if (frame?.type === TERMINAL_RELAY_FRAME.EXITED) exitCode = frame.code;
          if (frame?.type !== TERMINAL_RELAY_FRAME.ATTACHED) return Effect.void;
          attached = true;
          // What was typed while the socket was away reaches the shell first, in the order it was typed.
          const typed = connection.typedWhileAway.splice(0);
          return Effect.andThen(
            tell(connection, TERMINAL_CONNECTION.ATTACHED),
            Effect.forEach(typed, (bytes) => socket.send({ bytes }), { discard: true }),
          );
        });
        const ended = closeCode === undefined ? undefined : ENDED_BY_CLOSE.get(closeCode);
        if (ended !== undefined) {
          yield* tell(
            connection,
            ended,
            ended === TERMINAL_CONNECTION.EXITED ? exitCode : undefined,
          );
          return SOCKET_ENDING.ENDED;
        }
        if (closeCode === TERMINAL_RELAY_CLOSE.STARTING) {
          yield* tell(connection, TERMINAL_CONNECTION.STARTING);
          return yield* Effect.fail(new SandboxStarting());
        }
        if (!attached) return yield* drop;
        yield* tell(connection, TERMINAL_CONNECTION.RECONNECTING);
        return SOCKET_ENDING.DROPPED;
      }),
    );

  /** A connection's whole life, from its first open until the relay ends it or the tab lets it go. */
  const session = (connection: Connection) =>
    Effect.gen(function* () {
      yield* tell(connection, TERMINAL_CONNECTION.CONNECTING);
      yield* attempt(connection).pipe(
        Effect.retry({
          schedule: Schedule.spaced(TERMINAL_RECONNECT.STARTING_EVERY),
          while: (failure) => failure._tag === "SandboxStarting",
        }),
        Effect.retry({
          schedule: RECONNECT_BACKOFF,
          while: (failure) => failure._tag === "RelayDropped",
        }),
        Effect.repeat({
          schedule: Schedule.spaced(TERMINAL_RECONNECT.FIRST),
          while: (ending: SocketEnding) => ending === SOCKET_ENDING.DROPPED,
        }),
        Effect.ignore,
      );
    });

  /** The connection's fiber started, or started over, in the map under its id. */
  const run = (connection: Connection) =>
    Effect.asVoid(FiberMap.run(fibers, connection.connectionId, session(connection)));

  /** The service asked behind the gate, over the host's own HTTP client; an answer it could not give is the call's refusal. */
  const asked = <Answer extends object>(
    call: Effect.Effect<Answer | TerminalUnanswered, never, HttpClient.HttpClient>,
  ): Effect.Effect<WireValue, RefusedRefusal> =>
    Effect.gen(function* () {
      if (!gate()) return yield* Effect.fail(new RefusedRefusal({ message: "signed out" }));
      const answer = yield* Effect.provideService(call, HttpClient.HttpClient, http);
      if (answer === TERMINAL_UNANSWERED) {
        return yield* Effect.fail(new RefusedRefusal({ message: "the service did not answer" }));
      }
      return carried(answer);
    });

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  /** The connection a call names, where it stands. */
  const named = (connectionId: string) => connections.get(connectionId);

  const encoder = new TextEncoder();

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.TERMINALS_LIST]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          terminalAgentParamsSchema,
          params,
          "listing an agent's shells names the agent",
        );
        return yield* asked(client.list(agentId));
      }),
    [GATEWAY_METHOD.TERMINALS_CREATE]: (params) =>
      Effect.gen(function* () {
        const { agentId, title } = yield* read(
          terminalCreateParamsSchema,
          params,
          "starting a shell names the agent, and its name where it has one",
        );
        return yield* asked(client.create(agentId, title));
      }),
    [GATEWAY_METHOD.TERMINALS_RENAME]: (params) =>
      Effect.gen(function* () {
        const { agentId, terminalId, title } = yield* read(
          terminalRenameParamsSchema,
          params,
          "renaming a shell names the agent, the shell, and its name",
        );
        return yield* asked(client.rename(agentId, terminalId, title));
      }),
    [GATEWAY_METHOD.TERMINALS_KILL]: (params) =>
      Effect.gen(function* () {
        const { agentId, terminalId } = yield* read(
          terminalShellParamsSchema,
          params,
          "ending a shell names the agent and the shell",
        );
        return yield* asked(client.kill(agentId, terminalId));
      }),
    [GATEWAY_METHOD.TERMINALS_RESUME]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          terminalAgentParamsSchema,
          params,
          "resuming a sandbox names the agent",
        );
        return yield* asked(client.resume(agentId));
      }),
    [GATEWAY_METHOD.TERMINALS_CONNECT]: (params) =>
      Effect.gen(function* () {
        const ask = yield* read(
          terminalConnectParamsSchema,
          params,
          "attaching a shell names the connection, the agent, the shell, and the terminal's size",
        );
        if (!gate()) return yield* Effect.fail(new RefusedRefusal({ message: "signed out" }));
        const connection: Connection = {
          ...ask,
          socket: undefined,
          unacked: 0,
          paused: false,
          typedWhileAway: [],
        };
        connections.set(ask.connectionId, connection);
        yield* run(connection);
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_INPUT]: (params) =>
      Effect.gen(function* () {
        const { connectionId, data } = yield* read(
          terminalInputParamsSchema,
          params,
          "typing names the connection and what was typed",
        );
        const connection = named(connectionId);
        if (connection === undefined) return {};
        const bytes = encoder.encode(data);
        if (connection.socket !== undefined) {
          yield* connection.socket.send({ bytes });
          return {};
        }
        // Note that typing on a connection that ended is let go, because the tab attaches again on a key press; one still reopening holds it.
        if (!(yield* FiberMap.has(fibers, connectionId))) return {};
        const held = connection.typedWhileAway.reduce((sum, typed) => sum + typed.length, 0);
        if (held + bytes.length <= TYPED_WHILE_AWAY_MAX_BYTES)
          connection.typedWhileAway.push(bytes);
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_RESIZE]: (params) =>
      Effect.gen(function* () {
        const { connectionId, cols, rows } = yield* read(
          terminalResizeParamsSchema,
          params,
          "a resize names the connection and the terminal's size",
        );
        const connection = named(connectionId);
        if (connection === undefined) return {};
        Object.assign(connection, { cols, rows });
        if (connection.socket !== undefined) {
          yield* connection.socket.send({ text: resizeFrame(connection) });
        }
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_ACK]: (params) =>
      Effect.gen(function* () {
        const { connectionId, bytes } = yield* read(
          terminalAckParamsSchema,
          params,
          "an ack names the connection and the bytes written",
        );
        const connection = named(connectionId);
        if (connection === undefined) return {};
        connection.unacked = Math.max(0, connection.unacked - bytes);
        if (!connection.paused || connection.unacked >= TERMINAL_FLOW.RESUME_BELOW_BYTES) return {};
        connection.paused = false;
        if (connection.socket !== undefined) yield* connection.socket.resume;
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const { connectionId } = yield* read(
          terminalConnectionParamsSchema,
          params,
          "detaching names the connection",
        );
        connections.delete(connectionId);
        yield* FiberMap.remove(fibers, connectionId);
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_WAKE]: () =>
      Effect.gen(function* () {
        // A connection still standing after a sleep may be waiting out a backoff, or on a socket the sleep killed without a word: each opens again now.
        for (const connection of connections.values()) {
          if (yield* FiberMap.has(fibers, connection.connectionId)) yield* run(connection);
        }
        return {};
      }),
  };

  const reset = Effect.gen(function* () {
    const ended = [...connections.values()];
    connections.clear();
    yield* FiberMap.clear(fibers);
    for (const connection of ended) yield* tell(connection, TERMINAL_CONNECTION.IDLE);
  });

  return { methods, lifetime: Effect.void, reset };
}
