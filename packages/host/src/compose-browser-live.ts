/**
 * compose-browser-live.ts -- a cloud Browser tab's live view, on the window's behalf: each view a panel attached held open on the service's live relay under the account's credential, its text frames carried each way.
 *
 * The desktop's panel draws the view and decides when to open it again
 * (`@luke/panel`'s `cloud-browser-live.ts`); this only carries the socket,
 * because the bearer is the host's and never the page's. An attached view
 * is a connection main named, held here on one fiber until the panel lets
 * it go or the socket closes: the fiber opens the relay socket
 * (`browser-live-wire.ts`) under the account's credential
 * (`relay-credential.ts`), a bearer renewed once on a refusal, hands up
 * each text frame the service sent as a
 * `BROWSER_LIVE_MESSAGE` event named by that connection, and its close, last,
 * as `BROWSER_LIVE_CLOSED`, with its code; a socket that never opened closes
 * as a browser's would, abnormally. What the panel sends before the socket
 * opens is held for it, up to a bound. Nothing the page shows is read here
 * beyond its connection's id, kept, logged, or counted: each frame is handed
 * to the event and let go (root `AGENTS.md`'s cloud browser line). Composed
 * beside the terminals (`compose-terminals.ts`), whose socket it opens with.
 */

import { webSocketOrigin } from "@luke/features";
import {
  BROWSER_LIVE_ABNORMAL_CLOSE,
  browserLiveConnectionParamsSchema,
  browserLiveConnectParamsSchema,
  browserLivePath,
  browserLiveSendParamsSchema,
} from "@luke/features/browser-live-acts";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodHandler,
  invalid,
  RefusedRefusal,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberMap, Result, Stream } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import type { HostKernel } from "./host-kernel.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

/** The most text frames a view holds for a socket still opening; past it the panel's newest are let go. */
const HELD_WHILE_OPENING = 32;

export interface BrowserLiveDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  openSocket: OpenTerminalSocket;
}

/** The live view's methods, and the reset a sign-out runs, which lets every view go. */
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

/** One attached view: its socket once open, and what the panel sent before it was. */
interface Connection {
  socket: TerminalSocket | undefined;
  readonly held: string[];
}

/** The live view's table over its seams, every connection's fiber held in `fibers`. */
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

  /** One view's socket, from its open until it closes; the panel letting it go interrupts it, which closes it. */
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
        const read = readEither(browserLiveConnectParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("opening a live view names the connection, the task, and the tab");
        }
        if (!gate()) return yield* Effect.fail(new RefusedRefusal({ message: "signed out" }));
        const { connectionId, taskId, tabId } = read.success;
        if (socketOrigin === undefined) {
          return yield* Effect.fail(new RefusedRefusal({ message: "no live view is served" }));
        }
        const connection: Connection = { socket: undefined, held: [] };
        connections.set(connectionId, connection);
        const address = `${socketOrigin}${browserLivePath({ taskId, tabId })}`;
        yield* FiberMap.run(fibers, connectionId, session(connectionId, connection, address));
        return {};
      }),
    [GATEWAY_METHOD.BROWSER_LIVE_SEND]: (params) =>
      Effect.gen(function* () {
        const read = readEither(browserLiveSendParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("sending names the connection and the text");
        const { connectionId, text } = read.success;
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
        const read = readEither(browserLiveConnectionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("closing a live view names the connection");
        connections.delete(read.success.connectionId);
        yield* FiberMap.remove(fibers, read.success.connectionId);
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
