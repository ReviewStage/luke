import {
  TERMINAL_PORT_MESSAGE,
  type TerminalPortOutbound,
  type TerminalPortTicket,
  terminalPortInboundSchema,
} from "@repo/features/terminal-acts";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import { TERMINAL_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPortFor } from "./base.js";
import type { PlatformActProcedures } from "./index.js";

type TerminalActKind = (typeof TERMINAL_ACT_KIND)[keyof typeof TERMINAL_ACT_KIND];

export interface HostTerminalPort {
  post(message: TerminalPortOutbound): void;
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

export interface TerminalPortSeam<Sender> {
  open(sender: Sender, ticket: TerminalPortTicket): HostTerminalPort;
  whenGone(sender: Sender, then: () => void): void;
}

export interface TerminalActsDependencies<Sender> {
  host: Pick<
    HostOperator,
    | "terminalList"
    | "terminalCreate"
    | "terminalRename"
    | "terminalKill"
    | "terminalResume"
    | "terminalConnect"
    | "terminalInput"
    | "terminalResize"
    | "terminalAck"
    | "terminalDisconnect"
    | "onTerminalOutput"
    | "onTerminalState"
  >;
  ports: TerminalPortSeam<Sender>;
  createId: () => string;
  fork: (effect: Effect.Effect<void>) => void;
}

interface Attached {
  readonly connectionId: string;
  readonly port: HostTerminalPort;
}

const readInbound = readEither(terminalPortInboundSchema);

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

function answeredOr<Answer, E>(
  answer: Effect.Effect<Answer | undefined>,
  refused: () => E,
): Effect.Effect<Answer, E> {
  return Effect.flatMap(answer, (value) =>
    value === undefined ? Effect.fail(refused()) : Effect.succeed(value),
  );
}

export function terminalProcedures<Sender>(
  dependencies: TerminalActsDependencies<Sender>,
): Pick<PlatformActProcedures<Sender>, TerminalActKind> {
  const { host, ports, createId, fork } = dependencies;
  const terminalPort = actPortFor<Sender>();
  const panels = new Map<Sender, Map<string, Map<string, Attached>>>();
  const byConnection = new Map<string, HostTerminalPort>();

  host.onTerminalOutput(({ connectionId, data }) => {
    byConnection.get(connectionId)?.post({ type: TERMINAL_PORT_MESSAGE.OUTPUT, data });
  });
  host.onTerminalState(({ connectionId, state, code }) => {
    byConnection.get(connectionId)?.post({
      type: TERMINAL_PORT_MESSAGE.STATE,
      state,
      ...(code === undefined ? undefined : { code }),
    });
  });

  const release = (attached: Attached) =>
    Effect.suspend(() => {
      attached.port.close();
      byConnection.delete(attached.connectionId);
      return host.terminalDisconnect({ connectionId: attached.connectionId });
    });

  const heard = (connectionId: string, message: WireBoundaryInput): Effect.Effect<void> => {
    const read = readInbound(unparsedWire(message));
    if (Result.isFailure(read)) return Effect.void;
    const inbound = read.success;
    if (inbound.type === TERMINAL_PORT_MESSAGE.INPUT) {
      return host.terminalInput({ connectionId, data: inbound.data });
    }
    if (inbound.type === TERMINAL_PORT_MESSAGE.RESIZE) {
      return host.terminalResize({ connectionId, cols: inbound.cols, rows: inbound.rows });
    }
    return host.terminalAck({ connectionId, bytes: inbound.bytes });
  };

  const attachedOf = (sender: Sender, agentId: string) => {
    let agents = panels.get(sender);
    if (agents === undefined) {
      const fresh = new Map<string, Map<string, Attached>>();
      agents = fresh;
      panels.set(sender, fresh);
      ports.whenGone(sender, () => {
        panels.delete(sender);
        const all = [...fresh.values()].flatMap((shells) => [...shells.values()]);
        fork(Effect.forEach(all, release, { discard: true }));
      });
    }
    const held = agents.get(agentId);
    if (held !== undefined) return held;
    const shells = new Map<string, Attached>();
    agents.set(agentId, shells);
    return shells;
  };

  return {
    [TERMINAL_ACT_KIND.TERMINAL_LIST]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* answeredOr(host.terminalList(input), () => errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_CREATE]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_CREATE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* answeredOr(host.terminalCreate(input), () => errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_RENAME]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_RENAME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* answeredOr(host.terminalRename(input), () => errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_KILL]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_KILL].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* answeredOr(host.terminalKill(input), () => errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_RESUME]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_RESUME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* answeredOr(host.terminalResume(input), () => errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_ATTACH]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_ATTACH].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const sender = context.actor.sender;
        const held = attachedOf(sender, input.agentId);
        const earlier = held.get(input.terminalId);
        if (earlier !== undefined) {
          held.delete(input.terminalId);
          yield* release(earlier);
        }
        const connectionId = createId();
        const port = ports.open(sender, { agentId: input.agentId, terminalId: input.terminalId });
        const attached = { connectionId, port };
        held.set(input.terminalId, attached);
        byConnection.set(connectionId, port);
        port.onMessage((message) => fork(heard(connectionId, message)));
        const taken = yield* host.terminalConnect({ connectionId, ...input });
        if (taken) return;
        if (held.get(input.terminalId) === attached) held.delete(input.terminalId);
        yield* release(attached);
        return yield* Effect.fail(errors.REFUSED());
      },
    ),
    [TERMINAL_ACT_KIND.TERMINAL_DETACH]: terminalPort[TERMINAL_ACT_KIND.TERMINAL_DETACH].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const held = panels.get(context.actor.sender)?.get(input.agentId);
        const attached = held?.get(input.terminalId);
        if (held === undefined || attached === undefined) return;
        held.delete(input.terminalId);
        yield* release(attached);
      },
    ),
  };
}
