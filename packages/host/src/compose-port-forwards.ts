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

export interface LoopbackConnection {
  readonly received: Stream.Stream<Uint8Array>;
  write(bytes: Uint8Array): Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export type ListenOnLoopback = (
  port: number,
) => Effect.Effect<Stream.Stream<LoopbackConnection> | undefined, never, Scope.Scope>;

export const PORT_FORWARD = {
  LOOK_EVERY: Duration.seconds(3),
  LOCAL_PORT_TRIES: 20,
} as const;

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
  readonly reset: Effect.Effect<void>;
}

interface Tunnel {
  readonly socket: TerminalSocket;
  readonly channels: Map<number, LoopbackConnection>;
  nextChannel: number;
}

interface Forward {
  readonly port: number;
  readonly localPort: number | undefined;
  readonly scope: Scope.Closeable;
  tunnel: Deferred.Deferred<Tunnel | undefined> | undefined;
  connected: boolean;
}

interface Forwarding {
  readonly agentId: string;
  readonly scope: Scope.Closeable;
  running: boolean;
  readonly forwards: Map<number, Forward>;
}

const readFrame = readEither(Schema.fromJsonString(tunnelFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});

function frameText(frame: TunnelFrame): string {
  return JSON.stringify(
    frame.type === TUNNEL_FRAME.DATA ? { ...frame, data: Base64.encode(frame.data) } : frame,
  );
}

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

    const heard = (tunnel: Tunnel, text: string) => {
      const frame = Result.getOrUndefined(readFrame(unparsedWire(text)));
      const connection = frame === undefined ? undefined : tunnel.channels.get(frame.channel);
      if (frame === undefined || connection === undefined) return Effect.void;
      if (frame.type === TUNNEL_FRAME.DATA) return connection.write(frame.data);
      if (frame.type !== TUNNEL_FRAME.CLOSE) return Effect.void;
      tunnel.channels.delete(frame.channel);
      return connection.close;
    };

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
        if (tunnel.channels.delete(channel)) yield* send({ type: TUNNEL_FRAME.CLOSE, channel });
      });

    const listened = (port: number) =>
      Effect.gen(function* () {
        const last = Math.min(port + PORT_FORWARD.LOCAL_PORT_TRIES - 1, FORWARD_PORT.MAX);
        for (let localPort = port; localPort <= last; localPort++) {
          const accepted = yield* listen(localPort);
          if (accepted !== undefined) return { localPort, accepted };
        }
        return undefined;
      });

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

    const look = (current: Forwarding) =>
      Effect.gen(function* () {
        const answer = yield* Effect.provideService(
          client.list(current.agentId),
          HttpClient.HttpClient,
          http,
        );
        if (answer === undefined) return;
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
