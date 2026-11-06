import { webSocketOrigin } from "@repo/features";
import {
  BROWSER_LIVE_ABNORMAL_CLOSE,
  browserLiveConnectionParamsSchema,
  browserLiveConnectParamsSchema,
  browserLivePath,
  browserLiveSendParamsSchema,
} from "@repo/features/browser-live-acts";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodHandler,
  RefusedRefusal,
  readParams,
} from "@repo/gateway";
import { Effect, FiberMap, Stream } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import type { HostKernel } from "./host-kernel.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

const HELD_WHILE_OPENING = 32;

export interface BrowserLiveDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  openSocket: OpenTerminalSocket;
}

export interface BrowserLiveConcern {
  readonly methods: Readonly<
    Record<
      | typeof GATEWAY_METHOD.BROWSER_LIVE_CONNECT
      | typeof GATEWAY_METHOD.BROWSER_LIVE_SEND
      | typeof GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT,
      GatewayMethodHandler
    >
  >;
  readonly reset: Effect.Effect<void>;
}

interface Connection {
  socket: TerminalSocket | undefined;
  readonly held: string[];
}

export function browserLiveConcern(
  dependencies: BrowserLiveDependencies,
  fibers: FiberMap.FiberMap<string>,
): BrowserLiveConcern {
  const { kernel, account, openSocket } = dependencies;
  const connections = new Map<string, Connection>();
  const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  const closed = (connectionId: string, code: number) =>
    Effect.sync(() => {
      connections.delete(connectionId);
      kernel.emit(GATEWAY_EVENT.BROWSER_LIVE_CLOSED, carried({ connectionId, code }));
    });

  const session = (connectionId: string, connection: Connection, address: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const opening = yield* openedUnderCredential(account.credential, openSocket, address);
        if (!("socket" in opening)) return yield* closed(connectionId, BROWSER_LIVE_ABNORMAL_CLOSE);
        const { socket } = opening;
        connection.socket = socket;
        for (const text of connection.held.splice(0)) yield* socket.send({ text });
        let code: number | undefined;
        yield* Stream.runForEach(socket.arrivals, (arrival) => {
          if ("close" in arrival) code = arrival.close;
          if (!("text" in arrival)) return Effect.void;
          return Effect.sync(() =>
            kernel.emit(
              GATEWAY_EVENT.BROWSER_LIVE_MESSAGE,
              carried({ connectionId, text: arrival.text }),
            ),
          );
        });
        yield* closed(connectionId, code ?? BROWSER_LIVE_ABNORMAL_CLOSE);
      }),
    );

  const methods: BrowserLiveConcern["methods"] = {
    [GATEWAY_METHOD.BROWSER_LIVE_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          browserLiveConnectParamsSchema,
          params,
          "opening a live view names the connection, the agent, and the tab",
        );
        if (!gate()) return yield* Effect.fail(new RefusedRefusal({ message: "signed out" }));
        const { connectionId, agentId, tabId } = read;
        if (socketOrigin === undefined) {
          return yield* Effect.fail(new RefusedRefusal({ message: "no live view is served" }));
        }
        const connection: Connection = { socket: undefined, held: [] };
        connections.set(connectionId, connection);
        const address = `${socketOrigin}${browserLivePath({ agentId, tabId })}`;
        yield* FiberMap.run(fibers, connectionId, session(connectionId, connection, address));
        return {};
      }),
    [GATEWAY_METHOD.BROWSER_LIVE_SEND]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          browserLiveSendParamsSchema,
          params,
          "sending names the connection and the text",
        );
        const { connectionId, text } = read;
        const connection = connections.get(connectionId);
        if (connection === undefined) return {};
        if (connection.socket !== undefined) {
          yield* connection.socket.send({ text });
        } else if (connection.held.length < HELD_WHILE_OPENING) {
          connection.held.push(text);
        }
        return {};
      }),
    [GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          browserLiveConnectionParamsSchema,
          params,
          "closing a live view names the connection",
        );
        connections.delete(read.connectionId);
        yield* FiberMap.remove(fibers, read.connectionId);
        return {};
      }),
  };

  const reset = Effect.gen(function* () {
    const ended = [...connections.keys()];
    connections.clear();
    yield* FiberMap.clear(fibers);
    for (const connectionId of ended) {
      kernel.emit(
        GATEWAY_EVENT.BROWSER_LIVE_CLOSED,
        carried({ connectionId, code: BROWSER_LIVE_ABNORMAL_CLOSE }),
      );
    }
  });

  return { methods, reset };
}
