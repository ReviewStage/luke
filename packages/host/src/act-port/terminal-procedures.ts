/**
 * terminal-procedures.ts -- the Terminal tab's acts, answered on the act port by whichever shell runs the host: a coding agent's shells listed, started, named, ended, attached, and detached, and its sandbox resumed.
 *
 * The acts carry ids, sizes, and names alone. An attach mints a connection
 * for the asking panel and that one shell, opens a channel, and posts the
 * channel's other end to that panel alone; what the shell prints arrives as
 * the host's events for that connection and is posted on the host's end,
 * and what the panel types, resizes, and acks arrives on it and goes to the
 * host named by the same connection. Nothing a shell prints is read here
 * beyond its connection's id, kept, logged, or written to app state: it
 * passes from the host's event to the one port and is let go. The panel
 * closing a port detaches its shell, and a panel whose page is gone has
 * every port it held closed and every connection let go. Only a panel draws a Terminal tab, so every procedure
 * refuses any other window. How a channel reaches a page is the
 * platform's (`TerminalPortSeam`): the desktop posts it from main through the
 * preload, and a browser tab, whose host runs in the page, posts it to itself.
 */

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

/** The host's end of one attached shell's channel. */
export interface HostTerminalPort {
  post(message: TerminalPortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  /** Calls `then` once the panel's end closes, which is its detach. */
  onClose(then: () => void): void;
  close(): void;
}

/** How the host reaches a panel's page for its ports, `Sender` being the platform's own handle on the window. */
export interface TerminalPortSeam<Sender> {
  /** A fresh channel: the host's end, with the other end already posted to the panel under the ticket. */
  open(sender: Sender, ticket: TerminalPortTicket): HostTerminalPort;
  /** Calls `then` once, when the panel's page is gone. */
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
    | "terminalShown"
    | "terminalDisconnect"
    | "onTerminalOutput"
    | "onTerminalState"
  >;
  ports: TerminalPortSeam<Sender>;
  /** A fresh connection id. */
  createId: () => string;
  /** Forks what a port's message asks of the host, from the port's own callback, on the platform's runtime. */
  fork: (effect: Effect.Effect<void>) => void;
}

const readInbound = readEither(terminalPortInboundSchema);

/** The refusal a window that draws no Terminal tab hears, in its kind's own words, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** The host's answer, or the kind's own refusal where the host had none. */
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
  /** Each panel's attached shells, by the connection the host names its events by. */
  const panels = new Map<Sender, Map<string, HostTerminalPort>>();
  /** Every attached shell, by connection. */
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

  /** One attached shell let go: its port closed and its connection ended at the host. */
  const release = (connectionId: string) =>
    Effect.suspend(() => {
      byConnection.get(connectionId)?.close();
      byConnection.delete(connectionId);
      return host.terminalDisconnect({ connectionId });
    });

  /** What the panel sent on one connection's port, read and handed to the host; anything else is dropped. */
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
    if (inbound.type === TERMINAL_PORT_MESSAGE.SHOWN) return host.terminalShown({ connectionId });
    return host.terminalAck({ connectionId, bytes: inbound.bytes });
  };

  /** The panel's attached shells, its page's end watched for the first time it attaches any. */
  const attachedOf = (sender: Sender) => {
    const held = panels.get(sender);
    if (held !== undefined) return held;
    const fresh = new Map<string, HostTerminalPort>();
    panels.set(sender, fresh);
    ports.whenGone(sender, () => {
      panels.delete(sender);
      fork(Effect.forEach([...fresh.keys()], release, { discard: true }));
    });
    return fresh;
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
        const held = attachedOf(context.actor.sender);
        const connectionId = createId();
        const port = ports.open(context.actor.sender, {
          agentId: input.agentId,
          terminalId: input.terminalId,
        });
        held.set(connectionId, port);
        byConnection.set(connectionId, port);
        port.onMessage((message) => fork(heard(connectionId, message)));
        // The panel closing its port is the detach.
        port.onClose(() => {
          if (!held.delete(connectionId)) return;
          fork(release(connectionId));
        });
        const taken = yield* host.terminalConnect({ connectionId, ...input });
        if (taken) return;
        held.delete(connectionId);
        yield* release(connectionId);
        return yield* Effect.fail(errors.REFUSED());
      },
    ),
  };
}
