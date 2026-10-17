/**
 * terminal-acts.ts -- the Terminal tab's act rows: a coding agent's shells listed, started, named, ended, attached, and detached, and its sandbox resumed.
 *
 * The rows carry ids, sizes, and names alone. An attach mints a connection
 * for the asking panel and that one shell, opens a channel, and posts the
 * channel's other end to that panel alone; what the shell prints arrives as
 * the host's events for that connection and is posted on main's end, and
 * what the panel types, resizes, and acks arrives on it and goes to the host
 * named by the same connection. Nothing a shell prints is read here beyond
 * its connection's id, kept, logged, or written to app state: it passes from
 * the host's event to the one port and is let go. A panel that attaches a
 * shell it already holds has the older port closed first, and a panel whose
 * page is gone has every port it held closed and every connection let go.
 * Only a panel draws a Terminal tab, so every row refuses the voice and call
 * windows.
 */

import {
  TERMINAL_PORT_MESSAGE,
  type TerminalCreatedActAnswer,
  type TerminalPortOutbound,
  type TerminalPortTicket,
  type TerminalResumedActAnswer,
  type TerminalsActAnswer,
  terminalPortInboundSchema,
} from "@luke/features/terminal-acts";
import { ActRefused, type ActRows, type ActSender } from "@luke/host/act-router";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { WebContents } from "electron";

type TerminalActKind =
  | typeof ACT_KIND.TERMINAL_LIST
  | typeof ACT_KIND.TERMINAL_CREATE
  | typeof ACT_KIND.TERMINAL_RENAME
  | typeof ACT_KIND.TERMINAL_KILL
  | typeof ACT_KIND.TERMINAL_RESUME
  | typeof ACT_KIND.TERMINAL_ATTACH
  | typeof ACT_KIND.TERMINAL_DETACH;

/** Main's end of one attached shell's channel. */
export interface MainTerminalPort {
  post(message: TerminalPortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

/** How main reaches a panel's page for its ports. */
interface TerminalPortSeam {
  /** A fresh channel: main's end, with the other end already posted to the panel under the ticket. */
  open(sender: WebContents, ticket: TerminalPortTicket): MainTerminalPort;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone(sender: WebContents, then: () => void): void;
}

/** The events of a window's contents that end the page a port was posted to. */
type PageEvents = Pick<NodeJS.EventEmitter, "on" | "off">;

/**
 * Calls `then` once the page behind a window's contents is gone: the
 * contents destroyed, its renderer gone, or the window navigated to a new
 * document, which a reload is. The contents outlive a reload, and the ports
 * posted to the page before it do not, so a reload is as much an end as a
 * close. A navigation within the same document, or of a frame inside it,
 * keeps the page.
 */
export function whenPageGone(contents: PageEvents, then: () => void): void {
  const navigated = (details: {
    readonly isMainFrame: boolean;
    readonly isSameDocument: boolean;
  }) => {
    if (details.isMainFrame && !details.isSameDocument) gone();
  };
  const gone = () => {
    contents.off("did-start-navigation", navigated);
    contents.off("render-process-gone", gone);
    contents.off("destroyed", gone);
    then();
  };
  contents.on("did-start-navigation", navigated);
  contents.on("render-process-gone", gone);
  contents.on("destroyed", gone);
}

export interface TerminalActsDependencies {
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
  ports: TerminalPortSeam;
  /** A fresh connection id. */
  createId: () => string;
  /** Runs what a port's message asks of the host, from the port's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One shell a panel attached: the connection the host knows it by, and main's end of its channel. */
interface Attached {
  readonly connectionId: string;
  readonly port: MainTerminalPort;
}

const readInbound = readEither(terminalPortInboundSchema);

/** The refusal a window that draws no Terminal tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: TerminalActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

/** The host's answer, or the kind's own refusal where the host had none. */
function answeredOr<Answer>(
  kind: TerminalActKind,
  answer: Effect.Effect<Answer | undefined>,
): Effect.Effect<Answer, ActRefused> {
  return Effect.flatMap(answer, (value) =>
    value === undefined
      ? Effect.fail(new ActRefused({ message: ACT[kind].refusal }))
      : Effect.succeed(value),
  );
}

export function terminalActRows(
  dependencies: TerminalActsDependencies,
): Pick<ActRows<WebContents>, TerminalActKind> {
  const { host, ports, createId, run } = dependencies;
  /** Each panel's attached shells, by agent and then by shell, since a shell's id is its agent's to mint. */
  const panels = new Map<WebContents, Map<string, Map<string, Attached>>>();
  /** Every attached shell, by connection, which is how the host names its events. */
  const byConnection = new Map<string, MainTerminalPort>();

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
  const release = (attached: Attached) =>
    Effect.suspend(() => {
      attached.port.close();
      byConnection.delete(attached.connectionId);
      return host.terminalDisconnect({ connectionId: attached.connectionId });
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
    return host.terminalAck({ connectionId, bytes: inbound.bytes });
  };

  /** The panel's attached shells of one agent, its page's end watched for the first time it attaches any. */
  const attachedOf = (sender: WebContents, agentId: string) => {
    let agents = panels.get(sender);
    if (agents === undefined) {
      const fresh = new Map<string, Map<string, Attached>>();
      agents = fresh;
      panels.set(sender, fresh);
      ports.whenGone(sender, () => {
        panels.delete(sender);
        const all = [...fresh.values()].flatMap((shells) => [...shells.values()]);
        void run(Effect.forEach(all, release, { discard: true }));
      });
    }
    const held = agents.get(agentId);
    if (held !== undefined) return held;
    const shells = new Map<string, Attached>();
    agents.set(agentId, shells);
    return shells;
  };

  return {
    [ACT_KIND.TERMINAL_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_LIST, sender);
      return answeredOr<TerminalsActAnswer>(ACT_KIND.TERMINAL_LIST, host.terminalList(params));
    },
    [ACT_KIND.TERMINAL_CREATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_CREATE, sender);
      return answeredOr<TerminalCreatedActAnswer>(
        ACT_KIND.TERMINAL_CREATE,
        host.terminalCreate(params),
      );
    },
    [ACT_KIND.TERMINAL_RENAME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_RENAME, sender);
      return answeredOr<TerminalsActAnswer>(ACT_KIND.TERMINAL_RENAME, host.terminalRename(params));
    },
    [ACT_KIND.TERMINAL_KILL]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_KILL, sender);
      return answeredOr<TerminalsActAnswer>(ACT_KIND.TERMINAL_KILL, host.terminalKill(params));
    },
    [ACT_KIND.TERMINAL_RESUME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_RESUME, sender);
      return answeredOr<TerminalResumedActAnswer>(
        ACT_KIND.TERMINAL_RESUME,
        host.terminalResume(params),
      );
    },
    [ACT_KIND.TERMINAL_ATTACH]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_ATTACH, sender);
      return Effect.gen(function* () {
        const held = attachedOf(sender.sender, params.agentId);
        const earlier = held.get(params.terminalId);
        if (earlier !== undefined) {
          held.delete(params.terminalId);
          yield* release(earlier);
        }
        const connectionId = createId();
        const port = ports.open(sender.sender, {
          agentId: params.agentId,
          terminalId: params.terminalId,
        });
        const attached = { connectionId, port };
        held.set(params.terminalId, attached);
        byConnection.set(connectionId, port);
        port.onMessage((message) => void run(heard(connectionId, message)));
        const taken = yield* host.terminalConnect({ connectionId, ...params });
        if (taken) return undefined;
        // Note that only this attach's own entry goes, because a newer attach of the shell may have taken its place.
        if (held.get(params.terminalId) === attached) held.delete(params.terminalId);
        yield* release(attached);
        return yield* Effect.fail(
          new ActRefused({ message: ACT[ACT_KIND.TERMINAL_ATTACH].refusal }),
        );
      });
    },
    [ACT_KIND.TERMINAL_DETACH]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.TERMINAL_DETACH, sender);
      const held = panels.get(sender.sender)?.get(params.agentId);
      const attached = held?.get(params.terminalId);
      if (held === undefined || attached === undefined) return Effect.void;
      held.delete(params.terminalId);
      return release(attached);
    },
  };
}
