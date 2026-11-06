import {
  type HostedTerminalClient,
  TERMINAL_UNANSWERED,
  type TerminalUnanswered,
  terminalRelayAddress,
  webSocketOrigin,
} from "@repo/features";
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
} from "@repo/features/terminal-view";
import {
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
  terminalRelayServiceFrameSchema,
} from "@repo/features/terminal-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, RefusedRefusal, readParams } from "@repo/gateway";
import { unparsedWire, type WireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import {
  Data,
  Duration,
  Effect,
  FiberMap,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import { type BrowserLiveConcern, browserLiveConcern } from "./compose-browser-live.js";
import type { Composer } from "./composer.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

export type TerminalSocketArrival =
  | { readonly bytes: Uint8Array }
  | { readonly text: string }
  | { readonly close: number };

export type TerminalSocketFrame = { readonly bytes: Uint8Array } | { readonly text: string };

export interface TerminalSocket {
  readonly arrivals: Stream.Stream<TerminalSocketArrival>;
  send(frame: TerminalSocketFrame): Effect.Effect<void>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
}

export type TerminalSocketOpening =
  | { readonly socket: TerminalSocket }
  | { readonly refused: number }
  | { readonly unreachable: true };

export type OpenTerminalSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Effect.Effect<TerminalSocketOpening, never, Scope.Scope>;

export const TERMINAL_RECONNECT = {
  FIRST: Duration.millis(500),
  LONGEST: Duration.seconds(10),
  STARTING_EVERY: Duration.seconds(5),
} as const;

export type TerminalClient = Pick<
  HostedTerminalClient,
  "list" | "create" | "rename" | "kill" | "resume"
>;

export interface TerminalsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  client: TerminalClient;
  openSocket: OpenTerminalSocket;
}

export interface TerminalsComposer extends Composer {
  readonly reset: Effect.Effect<void>;
}

type ShellMethods = Omit<
  PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.TERMINALS>,
  keyof BrowserLiveConcern["methods"]
>;

const SERVER_ERROR_STATUS = 500;

const NOT_FOUND_STATUS = 404;

const RECONNECT_BACKOFF = Schedule.exponential(TERMINAL_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, TERMINAL_RECONNECT.LONGEST)),
  ),
);

const ENDED_BY_CLOSE: ReadonlyMap<number, TerminalConnection> = new Map([
  [TERMINAL_RELAY_CLOSE.IDLE, TERMINAL_CONNECTION.IDLE],
  [TERMINAL_RELAY_CLOSE.STOPPED, TERMINAL_CONNECTION.STOPPED],
  [TERMINAL_RELAY_CLOSE.GONE, TERMINAL_CONNECTION.GONE],
  [TERMINAL_RELAY_CLOSE.EXITED, TERMINAL_CONNECTION.EXITED],
]);

const SOCKET_ENDING = {
  ENDED: "ended",
  DROPPED: "dropped",
} as const;

type SocketEnding = (typeof SOCKET_ENDING)[keyof typeof SOCKET_ENDING];

class RelayDropped extends Data.TaggedError("RelayDropped") {}

class SandboxStarting extends Data.TaggedError("SandboxStarting") {}

interface Connection {
  readonly connectionId: string;
  readonly agentId: string;
  readonly terminalId: string;
  cols: number;
  rows: number;
  socket: TerminalSocket | undefined;
  unacked: number;
  paused: boolean;
  typedWhileAway: Uint8Array[];
}

const TYPED_WHILE_AWAY_MAX_BYTES = 64 * 1024;

const readServiceFrame = readEither(Schema.fromJsonString(terminalRelayServiceFrameSchema));

function serviceFrame(text: string) {
  return Result.getOrUndefined(readServiceFrame(unparsedWire(text)));
}

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
    const views = browserLiveConcern(dependencies, yield* FiberMap.make<string>());
    const terminals = composed(dependencies, fibers, yield* HttpClient.HttpClient);
    return {
      methods: { ...terminals.methods, ...views.methods },
      lifetime: terminals.lifetime,
      reset: Effect.andThen(terminals.reset, views.reset),
    };
  });
}

function composed(
  dependencies: TerminalsDependencies,
  fibers: FiberMap.FiberMap<string>,
  http: HttpClient.HttpClient,
): Omit<TerminalsComposer, "methods"> & { readonly methods: ShellMethods } {
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

  const opened = (address: string) =>
    openedUnderCredential(account.credential, openSocket, address);

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
          const ended =
            opening.refused === NOT_FOUND_STATUS
              ? TERMINAL_CONNECTION.UNAVAILABLE
              : TERMINAL_CONNECTION.GONE;
          yield* tell(connection, ended);
          return SOCKET_ENDING.ENDED;
        }
        const { socket } = opening;
        Object.assign(connection, { socket, unacked: 0, paused: false });
        if (connection.cols !== openedAt.cols || connection.rows !== openedAt.rows) {
          yield* socket.send({ text: resizeFrame(connection) });
        }
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

  const run = (connection: Connection) =>
    Effect.asVoid(FiberMap.run(fibers, connection.connectionId, session(connection)));

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

  const named = (connectionId: string) => connections.get(connectionId);

  const encoder = new TextEncoder();

  const methods: ShellMethods = {
    [GATEWAY_METHOD.TERMINALS_LIST]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          terminalAgentParamsSchema,
          params,
          "listing an agent's shells names the agent",
        );
        return yield* asked(client.list(agentId));
      }),
    [GATEWAY_METHOD.TERMINALS_CREATE]: (params) =>
      Effect.gen(function* () {
        const { agentId, title } = yield* readParams(
          terminalCreateParamsSchema,
          params,
          "starting a shell names the agent, and its name where it has one",
        );
        return yield* asked(client.create(agentId, title));
      }),
    [GATEWAY_METHOD.TERMINALS_RENAME]: (params) =>
      Effect.gen(function* () {
        const { agentId, terminalId, title } = yield* readParams(
          terminalRenameParamsSchema,
          params,
          "renaming a shell names the agent, the shell, and its name",
        );
        return yield* asked(client.rename(agentId, terminalId, title));
      }),
    [GATEWAY_METHOD.TERMINALS_KILL]: (params) =>
      Effect.gen(function* () {
        const { agentId, terminalId } = yield* readParams(
          terminalShellParamsSchema,
          params,
          "ending a shell names the agent and the shell",
        );
        return yield* asked(client.kill(agentId, terminalId));
      }),
    [GATEWAY_METHOD.TERMINALS_RESUME]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          terminalAgentParamsSchema,
          params,
          "resuming a sandbox names the agent",
        );
        return yield* asked(client.resume(agentId));
      }),
    [GATEWAY_METHOD.TERMINALS_CONNECT]: (params) =>
      Effect.gen(function* () {
        const ask = yield* readParams(
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
        const { connectionId, data } = yield* readParams(
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
        if (!(yield* FiberMap.has(fibers, connectionId))) return {};
        const held = connection.typedWhileAway.reduce((sum, typed) => sum + typed.length, 0);
        if (held + bytes.length <= TYPED_WHILE_AWAY_MAX_BYTES)
          connection.typedWhileAway.push(bytes);
        return {};
      }),
    [GATEWAY_METHOD.TERMINALS_RESIZE]: (params) =>
      Effect.gen(function* () {
        const { connectionId, cols, rows } = yield* readParams(
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
        const { connectionId, bytes } = yield* readParams(
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
        const { connectionId } = yield* readParams(
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
