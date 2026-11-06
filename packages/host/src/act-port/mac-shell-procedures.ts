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

export interface MacShell {
  onData(listener: (bytes: Uint8Array) => void): void;
  onExit(listener: (code: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface MacShellActsDependencies<Sender> {
  mirror: (agentId: string) => Effect.Effect<string | undefined>;
  spawn: (folder: string) => MacShell | undefined;
  ports: TerminalPortSeam<Sender>;
  whenClosed: (sender: Sender, then: () => void) => void;
  createId: () => string;
}

const MISSED_MAX_BYTES = 256 * 1024;

interface Held {
  readonly shell: MacShell;
  readonly ticket: TerminalPortTicket;
  port: HostTerminalPort | undefined;
  unacked: number;
  paused: boolean;
  missed: Uint8Array[];
  missedBytes: number;
  exitCode: number | undefined;
}

const readInbound = readEither(terminalPortInboundSchema);

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

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

function detach(held: Held): void {
  held.port?.close();
  held.port = undefined;
  held.unacked = 0;
  if (!held.paused) return;
  held.paused = false;
  held.shell.resume();
}

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
  if (held.exitCode !== undefined) return;
  if (inbound.type === TERMINAL_PORT_MESSAGE.INPUT) held.shell.write(inbound.data);
  else held.shell.resize(inbound.cols, inbound.rows);
}

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
  const { mirror, spawn, ports, whenClosed, createId } = dependencies;
  const macShellPort = actPortFor<Sender>();
  const windows = new Map<Sender, Map<string, Map<string, Held>>>();
  const pagesWatched = new Set<Sender>();

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

  const named = (sender: Sender, ticket: TerminalPortTicket) =>
    windows.get(sender)?.get(ticket.agentId)?.get(ticket.terminalId);

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
    [MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const folder = yield* mirror(input.agentId);
        if (folder === undefined) return yield* Effect.fail(errors.REFUSED());
        return { folder };
      },
    ),
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
