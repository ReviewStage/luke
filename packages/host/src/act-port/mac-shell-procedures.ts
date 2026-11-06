/**
 * mac-shell-procedures.ts -- shells on this Mac as the act port carries them: the developer's login shell opened in a folder for the asking panel, attached on a port of its own, and closed, from a panel alone.
 *
 * The platform holds each shell (`MacShell`: the desktop's main, over
 * node-pty), and these procedures hold which window it belongs to. A shell
 * belongs to the window that opened it, and no other window can attach to
 * or close it. An attach opens a channel and posts its other end to that
 * window under the ticket a cloud shell's port carries, so the Terminal tab
 * reads it as it reads a cloud shell's: what the shell prints, paced to the
 * tab's acks (`TERMINAL_FLOW`), how it stands, and its exit, out; what the
 * panel types, resizes, and acks, in. The window's page going, a reload
 * among it, closes the port and leaves the shell running, so the page that
 * loads next attaches to it again; the window itself going ends its shells.
 *
 * What a shell prints is never read here, logged, or written to app state:
 * it passes from the shell to its window's one port and is let go. While no
 * port stands, the latest `MISSED_MAX_BYTES` of it is held for the window's
 * next attach and nobody else, so a tab shown again draws what its shell
 * printed while it was hidden.
 */

import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalPortTicket,
  terminalPortInboundSchema,
} from "@repo/features/terminal-acts";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import { MAC_SHELL_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPortFor } from "./base.js";
import type { PlatformActProcedures } from "./index.js";
import type { HostTerminalPort, TerminalPortSeam } from "./terminal-procedures.js";

type MacShellActKind = (typeof MAC_SHELL_ACT_KIND)[keyof typeof MAC_SHELL_ACT_KIND];

/** One running shell, as the platform holds it. */
export interface MacShell {
  /** Hears each chunk the shell prints, in order. */
  onData(listener: (bytes: Uint8Array) => void): void;
  /** Hears the shell's exit status, once. */
  onExit(listener: (code: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops reading what the shell prints until `resume`, so the shell waits on its terminal. */
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface MacShellActsDependencies<Sender> {
  /** The developer's login shell started in `folder`; none where that is no folder on this Mac or the shell did not start. */
  spawn: (folder: string) => MacShell | undefined;
  ports: TerminalPortSeam<Sender>;
  /** Calls `then` once, when the window itself is gone, which a reload is not. */
  whenClosed: (sender: Sender, then: () => void) => void;
  /** A fresh shell id. */
  createId: () => string;
}

/** The most of what a shell printed while no port stood that is held for the next attach. */
const MISSED_MAX_BYTES = 256 * 1024;

/** One shell a window opened, and where its port stands. */
interface Held {
  readonly shell: MacShell;
  readonly ticket: TerminalPortTicket;
  port: HostTerminalPort | undefined;
  /** Bytes posted that the tab has not acked. */
  unacked: number;
  paused: boolean;
  /** What the shell printed while no port stood, oldest first. */
  missed: Uint8Array[];
  missedBytes: number;
  /** The shell's exit status, once it exited. */
  exitCode: number | undefined;
}

const readInbound = readEither(terminalPortInboundSchema);

/** The refusal a window that draws no Terminal tab hears, in its kind's own words, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** What a shell printed, posted on its port and the shell paused once the tab fell far enough behind, or held while no port stands. */
function output(held: Held, bytes: Uint8Array): void {
  if (held.port === undefined) {
    held.missed.push(bytes);
    held.missedBytes += bytes.length;
    while (held.missedBytes > MISSED_MAX_BYTES && held.missed.length > 1) {
      held.missedBytes -= held.missed.shift()?.length ?? 0;
    }
    return;
  }
  held.port.post({ type: TERMINAL_PORT_MESSAGE.OUTPUT, data: bytes });
  held.unacked += bytes.length;
  if (held.paused || held.unacked <= TERMINAL_FLOW.PAUSE_ABOVE_BYTES) return;
  held.paused = true;
  held.shell.pause();
}

/** The shell's port closed and its count let go; the shell reads on, since nothing waits on a port that is gone. */
function detach(held: Held): void {
  held.port?.close();
  held.port = undefined;
  held.unacked = 0;
  if (!held.paused) return;
  held.paused = false;
  held.shell.resume();
}

/** What the panel sent on a shell's port, read and handed to the shell; anything else is dropped. */
function heard(held: Held, message: WireBoundaryInput): void {
  const read = readInbound(unparsedWire(message));
  if (Result.isFailure(read)) return;
  const inbound = read.success;
  if (inbound.type === TERMINAL_PORT_MESSAGE.ACK) {
    held.unacked = Math.max(0, held.unacked - inbound.bytes);
    if (!held.paused || held.unacked >= TERMINAL_FLOW.RESUME_BELOW_BYTES) return;
    held.paused = false;
    held.shell.resume();
    return;
  }
  // Note that a shell that exited takes nothing more, because its terminal is closed.
  if (held.exitCode !== undefined) return;
  if (inbound.type === TERMINAL_PORT_MESSAGE.INPUT) held.shell.write(inbound.data);
  else held.shell.resize(inbound.cols, inbound.rows);
}

/** How the shell stands told on its port: attached, what it printed while away, and its exit where it exited. */
function attached(held: Held, port: HostTerminalPort): void {
  held.port = port;
  port.post({ type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED });
  const missed = held.missed.splice(0);
  held.missedBytes = 0;
  for (const bytes of missed) output(held, bytes);
  if (held.exitCode === undefined) return;
  port.post({
    type: TERMINAL_PORT_MESSAGE.STATE,
    state: TERMINAL_CONNECTION.EXITED,
    code: held.exitCode,
  });
}

export function macShellProcedures<Sender>(
  dependencies: MacShellActsDependencies<Sender>,
): Pick<PlatformActProcedures<Sender>, MacShellActKind> {
  const { spawn, ports, whenClosed, createId } = dependencies;
  const macShellPort = actPortFor<Sender>();
  /** Each window's shells, by agent and then by shell. */
  const windows = new Map<Sender, Map<string, Map<string, Held>>>();
  /** The windows whose page is watched for its end, which a reload starts over. */
  const pagesWatched = new Set<Sender>();

  /** The window's shells, its own end watched the first time it opens one. */
  const shellsOf = (sender: Sender) => {
    const held = windows.get(sender);
    if (held !== undefined) return held;
    const fresh = new Map<string, Map<string, Held>>();
    windows.set(sender, fresh);
    whenClosed(sender, () => {
      windows.delete(sender);
      for (const shells of fresh.values()) {
        for (const each of shells.values()) {
          detach(each);
          each.shell.kill();
        }
      }
    });
    return fresh;
  };

  /** The shell a call names, where the asking window opened it. */
  const named = (sender: Sender, ticket: TerminalPortTicket) =>
    windows.get(sender)?.get(ticket.agentId)?.get(ticket.terminalId);

  /** The page's end watched, once per page, so it closes every port it held and leaves the shells running. */
  const watchPage = (sender: Sender) => {
    if (pagesWatched.has(sender)) return;
    pagesWatched.add(sender);
    ports.whenGone(sender, () => {
      pagesWatched.delete(sender);
      for (const shells of windows.get(sender)?.values() ?? []) {
        for (const each of shells.values()) detach(each);
      }
    });
  };

  return {
    [MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const shell = spawn(input.folder);
        if (shell === undefined) return yield* Effect.fail(errors.REFUSED());
        const ticket = { agentId: input.agentId, terminalId: createId() };
        const held: Held = {
          shell,
          ticket,
          port: undefined,
          unacked: 0,
          paused: false,
          missed: [],
          missedBytes: 0,
          exitCode: undefined,
        };
        const agents = shellsOf(context.actor.sender);
        const shells = agents.get(ticket.agentId) ?? new Map<string, Held>();
        agents.set(ticket.agentId, shells.set(ticket.terminalId, held));
        shell.onData((bytes) => output(held, bytes));
        shell.onExit((code) => {
          held.exitCode = code;
          held.port?.post({
            type: TERMINAL_PORT_MESSAGE.STATE,
            state: TERMINAL_CONNECTION.EXITED,
            code,
          });
        });
        return { terminalId: ticket.terminalId };
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const sender = context.actor.sender;
        const held = named(sender, input);
        if (held === undefined) return yield* Effect.fail(errors.REFUSED());
        watchPage(sender);
        detach(held);
        if (held.exitCode === undefined) held.shell.resize(input.cols, input.rows);
        const port = ports.open(sender, held.ticket);
        port.onMessage((message) => {
          if (held.port === port) heard(held, message);
        });
        attached(held, port);
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const held = named(context.actor.sender, input);
        if (held === undefined) return;
        windows.get(context.actor.sender)?.get(input.agentId)?.delete(input.terminalId);
        detach(held);
        held.shell.kill();
      },
    ),
  };
}
