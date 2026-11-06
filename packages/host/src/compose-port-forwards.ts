/**
 * compose-port-forwards.ts -- a coding agent's cloud ports forwarded to this Mac's `127.0.0.1`, on the window's behalf: forwarding read and turned on or off for one agent at a time, a loopback listener kept for each port the service detects, and each connection it accepts carried over the service's tunnel.
 *
 * How the forwarded agent's forwarding stands is told to the windows as
 * `PORT_FORWARDS_CHANGED` each time it moves, which the client lays in app
 * state (`portForwarding`); nothing reads it on a timer of its own.
 *
 * Turning forwarding on reads the agent's listening ports every few seconds
 * for as long as it is on, forwarding what already listens; nothing is
 * started or woken in the sandbox on its behalf, and a stopped sandbox reads
 * as not running until it runs; once a sandbox seen running stops,
 * forwarding is turned off, so it waits on no agent whose ports are gone.
 * Each port read is listened on at `127.0.0.1` (the
 * `ListenOnLoopback` seam the desktop's launch hands over `node:net`), on
 * the same port where it is free and on the next free one where it is not;
 * a port no longer read is let go, its connections with it. Turning it on
 * for another agent turns it off for the first.
 *
 * A port's tunnel is one relay socket (`sandbox-tunnel-wire.ts`) opened
 * under the account's credential (`relay-credential.ts`) when the first
 * connection is accepted, every later connection a channel on it. A socket
 * that closes, idle, the sandbox stopped, or the relay function's bound,
 * closes the connections it carried; the listener stays, and the next
 * connection it accepts opens the socket again. That lazy open is the whole
 * of reconnecting: nothing is retried on a schedule. No byte a connection
 * carries is read beyond its channel's frame, kept, logged, or counted.
 */

import { type HostedAgentPortsClient, portForwardAddress, webSocketOrigin } from "@repo/features";
import {
  PORT_FORWARD_STATE,
  type PortForwarding,
  type PortForwardingAnswer,
  portForwardSetParamsSchema,
} from "@repo/features/port-forward-acts";
import {
  FORWARD_PORT,
  TUNNEL_FRAME,
  type TunnelFrame,
  tunnelFrameSchema,
} from "@repo/features/sandbox-tunnel-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, RefusedRefusal, readParams } from "@repo/gateway";
import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Deferred, Duration, Effect, Exit, Result, Schedule, Schema, Scope, Stream } from "effect";
import { Base64 } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import type { Composer } from "./composer.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

/** One TCP connection a loopback listener accepted. */
export interface LoopbackConnection {
  /** What the connection's far side sent, ending once it closes. */
  readonly received: Stream.Stream<Uint8Array>;
  write(bytes: Uint8Array): Effect.Effect<void>;
  /** Ends the connection once what was written is flushed. */
  readonly close: Effect.Effect<void>;
}

/** Listens on this Mac's `127.0.0.1` at the port given for the scope's life: the connections it accepts, or nothing where the port is taken. */
export type ListenOnLoopback = (
  port: number,
) => Effect.Effect<Stream.Stream<LoopbackConnection> | undefined, never, Scope.Scope>;

export const PORT_FORWARD = {
  /** How often the forwarded agent's listening ports are read while forwarding is on. */
  LOOK_EVERY: Duration.seconds(3),
  /** How many local ports, from the sandbox's own up, are tried before a port is given up. */
  LOCAL_PORT_TRIES: 20,
} as const;

/** The service's side of the forward, as this concern asks it. */
type PortForwardClient = Pick<HostedAgentPortsClient, "list">;

export interface PortForwardsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  client: PortForwardClient;
  openSocket: OpenTerminalSocket;
  listen: ListenOnLoopback;
}

export interface PortForwardsComposer extends Composer {
  /** Forwarding turned off, as a sign-out turns it off. */
  readonly reset: Effect.Effect<void>;
}

/** One port's open tunnel: its socket, and the connections it carries, by channel. */
interface Tunnel {
  readonly socket: TerminalSocket;
  readonly channels: Map<number, LoopbackConnection>;
  nextChannel: number;
}

/** One port forwarded: the local port it is listened on, if any, and its tunnel, open or opening, where it has one. */
interface Forward {
  readonly port: number;
  readonly localPort: number | undefined;
  readonly scope: Scope.Closeable;
  tunnel: Deferred.Deferred<Tunnel | undefined> | undefined;
  connected: boolean;
}

/** The one agent forwarded, everything it began in its scope. */
interface Forwarding {
  readonly agentId: string;
  readonly scope: Scope.Closeable;
  running: boolean;
  readonly forwards: Map<number, Forward>;
}

const readFrame = readEither(Schema.fromJsonString(tunnelFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});

/** A channel frame as the text the relay reads, its bytes base64-encoded. */
function frameText(frame: TunnelFrame): string {
  return JSON.stringify(
    frame.type === TUNNEL_FRAME.DATA ? { ...frame, data: Base64.encode(frame.data) } : frame,
  );
}

/** What an agent forwarding is off for answers. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

export function composePortForwards(
  dependencies: PortForwardsDependencies,
): Effect.Effect<PortForwardsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const { kernel, account, client, openSocket, listen } = dependencies;
    const lifetimeScope = yield* Effect.scope;
    const http = yield* HttpClient.HttpClient;
    const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    let forwarding: Forwarding | undefined;
    let toldText = JSON.stringify(null);

    /** How the forwarded agent's forwarding stands, told to the windows where it moved since it was last told. */
    const tell = Effect.sync(() => {
      const told: PortForwarding =
        forwarding === undefined
          ? null
          : { agentId: forwarding.agentId, ...standing(forwarding.agentId) };
      const text = JSON.stringify(told);
      if (text === toldText) return;
      toldText = text;
      kernel.emit(GATEWAY_EVENT.PORT_FORWARDS_CHANGED, carried(told));
    });

    /** A text frame the relay sent: a channel's bytes written to its connection, or its close ending it. */
    const heard = (tunnel: Tunnel, text: string) => {
      const frame = Result.getOrUndefined(readFrame(unparsedWire(text)));
      const connection = frame === undefined ? undefined : tunnel.channels.get(frame.channel);
      if (frame === undefined || connection === undefined) return Effect.void;
      if (frame.type === TUNNEL_FRAME.DATA) return connection.write(frame.data);
      if (frame.type !== TUNNEL_FRAME.CLOSE) return Effect.void;
      tunnel.channels.delete(frame.channel);
      return connection.close;
    };

    /** One port's socket from its open until it closes, every connection it carried closed with it. */
    const tunneled = (
      agentId: string,
      forward: Forward,
      opened: Deferred.Deferred<Tunnel | undefined>,
    ) => {
      let tunnel: Tunnel | undefined;
      const ended = Effect.suspend(() => {
        forward.tunnel = undefined;
        forward.connected = false;
        const held = [...(tunnel?.channels.values() ?? [])];
        tunnel?.channels.clear();
        return Effect.andThen(
          Deferred.succeed(opened, undefined),
          Effect.andThen(
            Effect.forEach(held, (connection) => connection.close, { discard: true }),
            tell,
          ),
        );
      });
      const open = Effect.gen(function* () {
        if (socketOrigin === undefined) return;
        const address = portForwardAddress(socketOrigin, { agentId, port: forward.port });
        const opening = yield* openedUnderCredential(account.credential, openSocket, address);
        if (!("socket" in opening)) return;
        const standing: Tunnel = { socket: opening.socket, channels: new Map(), nextChannel: 0 };
        tunnel = standing;
        forward.connected = true;
        yield* tell;
        yield* Deferred.succeed(opened, standing);
        yield* Stream.runForEach(opening.socket.arrivals, (arrival) =>
          "text" in arrival ? heard(standing, arrival.text) : Effect.void,
        );
      });
      return Effect.ensuring(Effect.scoped(open), ended);
    };

    /** The port's tunnel: the one open or opening, or one opened now; nothing where it would not open. */
    const tunnelOf = (agentId: string, forward: Forward) =>
      Effect.suspend(() => {
        if (forward.tunnel !== undefined) return Deferred.await(forward.tunnel);
        const opened = Deferred.makeUnsafe<Tunnel | undefined>();
        forward.tunnel = opened;
        return Effect.andThen(
          Effect.forkIn(tunneled(agentId, forward, opened), forward.scope),
          Deferred.await(opened),
        );
      });

    /** One accepted connection carried on a channel of its port's tunnel until either side ends it. */
    const carry = (agentId: string, forward: Forward, connection: LoopbackConnection) =>
      Effect.gen(function* () {
        const tunnel = yield* tunnelOf(agentId, forward);
        if (tunnel === undefined) return yield* connection.close;
        const channel = tunnel.nextChannel++;
        tunnel.channels.set(channel, connection);
        const send = (frame: TunnelFrame) => tunnel.socket.send({ text: frameText(frame) });
        yield* send({ type: TUNNEL_FRAME.OPEN, channel });
        yield* Stream.runForEach(connection.received, (data) =>
          tunnel.channels.has(channel)
            ? send({ type: TUNNEL_FRAME.DATA, channel, data })
            : Effect.void,
        );
        // Note that a channel the relay closed first is gone already, so nothing more is said of it.
        if (tunnel.channels.delete(channel)) yield* send({ type: TUNNEL_FRAME.CLOSE, channel });
      });

    /** The first local port from the sandbox's own up that listens, and what it accepts; nothing where none of them is free. */
    const listened = (port: number) =>
      Effect.gen(function* () {
        const last = Math.min(port + PORT_FORWARD.LOCAL_PORT_TRIES - 1, FORWARD_PORT.MAX);
        for (let localPort = port; localPort <= last; localPort++) {
          const accepted = yield* listen(localPort);
          if (accepted !== undefined) return { localPort, accepted };
        }
        return undefined;
      });

    /** One port forwarded in a scope of its own under the agent's: its listener, and a fiber for each connection it accepts. */
    const forwarded = (current: Forwarding, port: number) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(current.scope);
        const bound = yield* Scope.provide(listened(port), scope);
        const forward: Forward = {
          port,
          localPort: bound?.localPort,
          scope,
          tunnel: undefined,
          connected: false,
        };
        if (bound !== undefined) {
          yield* Effect.forkIn(
            Stream.runForEach(bound.accepted, (connection) =>
              Effect.forkIn(carry(current.agentId, forward, connection), scope),
            ),
            scope,
          );
        }
        return forward;
      });

    /** One read of the agent's ports, the forwards made to follow it: each port read forwarded, and each no longer read let go. */
    const look = (current: Forwarding) =>
      Effect.gen(function* () {
        const answer = yield* Effect.provideService(
          client.list(current.agentId),
          HttpClient.HttpClient,
          http,
        );
        if (answer === undefined) return;
        // Note that a sandbox seen running and now stopped ends the forward, so the next agent may take the ports, and the release is forked because it closes the scope this read runs in.
        if (current.running && !answer.running) {
          yield* Effect.forkIn(released(current), lifetimeScope);
          return;
        }
        current.running = answer.running;
        const read = new Set(answer.ports);
        for (const [port, forward] of current.forwards) {
          if (read.has(port)) continue;
          current.forwards.delete(port);
          yield* Scope.close(forward.scope, Exit.void);
        }
        for (const port of answer.ports) {
          if (!current.forwards.has(port))
            current.forwards.set(port, yield* forwarded(current, port));
        }
        yield* tell;
      });

    const turnOff = Effect.suspend(() => {
      const ending = forwarding;
      forwarding = undefined;
      return ending === undefined
        ? Effect.void
        : Effect.andThen(Scope.close(ending.scope, Exit.void), tell);
    });

    /** Forwarding let go for the agent it was on, unless another agent has taken it since. */
    const released = (current: Forwarding) =>
      Effect.suspend(() => (forwarding === current ? turnOff : Effect.void));

    /** Forwarding started for the agent, and whichever agent was forwarded before let go. */
    const turnOn = (agentId: string) =>
      Effect.gen(function* () {
        if (forwarding?.agentId === agentId) return;
        yield* turnOff;
        const current: Forwarding = {
          agentId,
          scope: yield* Scope.fork(lifetimeScope),
          running: false,
          forwards: new Map(),
        };
        forwarding = current;
        yield* tell;
        yield* Effect.forkIn(
          Effect.repeat(look(current), Schedule.spaced(PORT_FORWARD.LOOK_EVERY)),
          current.scope,
        );
      });

    /** How the agent's forwarding stands, its ports the lowest first. */
    const standing = (agentId: string): PortForwardingAnswer => {
      if (forwarding?.agentId !== agentId) return OFF;
      const forwards = [...forwarding.forwards.values()].sort((a, b) => a.port - b.port);
      return {
        on: true,
        running: forwarding.running,
        ports: forwards.map((forward) => {
          if (forward.localPort === undefined) {
            return { port: forward.port, state: PORT_FORWARD_STATE.UNAVAILABLE };
          }
          const state = forward.connected
            ? PORT_FORWARD_STATE.CONNECTED
            : PORT_FORWARD_STATE.LISTENING;
          return { port: forward.port, localPort: forward.localPort, state };
        }),
      };
    };

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.PORT_FORWARDS> = {
      [GATEWAY_METHOD.PORT_FORWARDS_SET]: (params) =>
        Effect.gen(function* () {
          const { agentId, on } = yield* readParams(
            portForwardSetParamsSchema,
            params,
            "turning forwarding names the agent, and whether it is on",
          );
          if (!on) {
            if (forwarding?.agentId === agentId) yield* turnOff;
            return carried(standing(agentId));
          }
          if (!gate()) return yield* Effect.fail(new RefusedRefusal({ message: "signed out" }));
          yield* turnOn(agentId);
          return carried(standing(agentId));
        }),
    };

    return { methods, lifetime: Effect.void, reset: turnOff };
  });
}
