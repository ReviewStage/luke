import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalConnection,
  type TerminalPortInbound,
  terminalPortOutboundSchema,
} from "@repo/features/terminal-acts";
import {
  TERMINAL_ACTION,
  TERMINAL_STATE,
  TERMINAL_UNREACHED,
  type TerminalAction,
  type TerminalState,
  terminalLook,
} from "@repo/features/terminal-model";
import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { TerminalHandle, TerminalModule, TerminalSize } from "../terminal/contract.js";
import { onTerminalPort } from "../terminal/terminal-port.js";

/**
 * terminal-session.ts -- one terminal for its tab's whole life: its screen, made once and shown in whichever box its tab draws, and its shell, attached on one port from the first time the screen has room until the tab closes.
 *
 * A terminal keeps its screen and its shell while its tab is hidden, as a
 * terminal does: the screen goes on drawing what the shell prints, and acking
 * it, out of any box. The shell is opened, or attached where one is held,
 * once the screen has first been fitted to a box with room, at that size,
 * and every size after that goes straight to the port, the latest one sent
 * again as a port opens. What is typed before a port stands waits for it.
 * Where the shell is and how it is opened is the link's (`ShellLink`): a
 * cloud agent's sandbox, or this Mac.
 *
 * Main posts each shell's port to the window under a ticket naming the
 * shell (`../terminal/terminal-port.ts`); the one listener here hands it to
 * the session that asked for that shell. Closing the port is the detach:
 * main hears it close.
 *
 * The bytes go to the screen and to the port, and nowhere else.
 */

/** Reads a message main sent on a shell's port. */
const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

/** Return, as the screen reads it, which runs the bar's action. */
const RETURN = "\r";

/** Where a call main refused leaves the tab: main refuses where the service could not be reached or did not answer. */
export const SERVICE_UNREACHED: TerminalState = {
  kind: TERMINAL_STATE.UNREACHABLE,
  why: TERMINAL_UNREACHED.SERVICE,
};

/** A shell opened, or the state the tab is left in where none could be. */
type ShellOpened = { readonly terminalId: string } | { readonly state: TerminalState };

/** What an attach answered: asked, so the port is on its way, or the state the tab is left in. */
export type ShellAttached = { readonly asked: true } | { readonly state: TerminalState };

/** How a session reaches its shell: where the shell runs, and what its host's words mean there. */
export interface ShellLink {
  /** The agent the shell's port is ticketed under. */
  readonly agentId: string;
  /** A new shell at the size given, where the session holds none; a link with none leaves that to the tab. */
  readonly open?: (size: TerminalSize) => Promise<ShellOpened>;
  /** The shell's port asked for at the size given. */
  readonly attach: (terminalId: string, size: TerminalSize) => Promise<ShellAttached>;
  /** The state a word of the host's stands for; none where the shell is gone. */
  readonly stateOf: (
    connection: TerminalConnection,
    code: number | undefined,
  ) => TerminalState | undefined;
  /** What a key after the shell ended does, or the host saying it went: the session's to start over in its place, or the tab's. */
  readonly ended: (session: TerminalSession) => void;
  /** The sandbox resumed, where the shell's link has one: the state the tab is left in where it could not be. */
  readonly resume?: () => Promise<TerminalState | undefined>;
  /** The shell ended for good, where its link ends it with its tab. */
  readonly close?: (terminalId: string) => void;
}

/** What is typed, cut into messages the port takes, a long paste in several. */
function inputMessages(data: string): TerminalPortInbound[] {
  const messages: TerminalPortInbound[] = [];
  let at = 0;
  while (at < data.length) {
    // Note that a cut never falls inside a character, because half of one
    // sent alone reaches the shell as no character at all.
    let end = Math.min(at + TERMINAL_FLOW.MAX_INPUT_CHARS, data.length);
    if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1))) end -= 1;
    messages.push({ type: TERMINAL_PORT_MESSAGE.INPUT, data: data.slice(at, end) });
    at = end;
  }
  return messages;
}

/** Whether a UTF-16 unit opens a character that the next unit closes. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** The action Return runs in a state, where the state offers one. */
function returnAction(state: TerminalState): TerminalAction | undefined {
  switch (state.kind) {
    case TERMINAL_STATE.RECONNECTING:
    case TERMINAL_STATE.UNREACHABLE:
      return TERMINAL_ACTION.RETRY;
    default:
      return undefined;
  }
}

/** One terminal: its screen, its shell's port, and where it stands. */
export class TerminalSession {
  readonly link: ShellLink;
  #state: TerminalState = { kind: TERMINAL_STATE.CONNECTING };
  #screen: TerminalHandle | undefined;
  /** The size the screen was last fitted at, none before it first had room. */
  #size: TerminalSize | undefined;
  /** The shell the session shows, once one is opened or held. */
  #terminalId: string | undefined;
  /** The shell whose port is on its way. */
  #awaiting: string | undefined;
  #port: MessagePort | undefined;
  /** What was typed before a port stood, in order. */
  #typed: string[] = [];
  /** How many bytes the screen has drawn since it last said so. */
  #unacked = 0;
  #listeners = new Set<() => void>();
  /** Whether the tab draws the screen now, which a stopped sandbox is resumed for. */
  #shown = false;
  /** Whether the session resumed the sandbox since the shell last attached or the developer last asked again, so a sandbox that stays stopped is said once rather than resumed in a loop. */
  #resumed = false;
  #openLink: (url: string) => void = () => undefined;

  constructor(link: ShellLink, terminalId: string | undefined) {
    this.link = link;
    this.#terminalId = terminalId;
  }

  get state(): TerminalState {
    return this.#state;
  }

  get terminalId(): string | undefined {
    return this.#terminalId;
  }

  /** The screen, once it has been shown. */
  get screen(): TerminalHandle | undefined {
    return this.#screen;
  }

  /** Hears each change of state, until the answer is called. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Opens a link pressed with ⌘ held through the opener the tab drawn last handed. */
  set openLink(opener: (url: string) => void) {
    this.#openLink = opener;
  }

  /** Shows the screen in `host`, making it the first time, and resumes the sandbox where it stopped while the tab was hidden. */
  show(module: TerminalModule, host: HTMLElement): void {
    this.#shown = true;
    this.#screen ??= module.create({
      onInput: (data) => this.#input(data),
      onResize: (size) => this.#resized(size),
      onLink: (url) => this.#openLink(url),
    });
    this.#screen.attach(host);
    this.#screen.dim(terminalLook(this.#state).dim);
    if (this.#state.kind === TERMINAL_STATE.STOPPED) this.#enter(this.#state);
  }

  /** Says on the shell's port that its tab is shown in the window the developer is using; nothing while no port stands. */
  sayShown(): void {
    this.#post({ type: TERMINAL_PORT_MESSAGE.SHOWN });
  }

  /** Takes the screen out of its box; the shell and the screen go on. */
  hide(): void {
    this.#shown = false;
    this.#screen?.detach();
  }

  /** Runs the bar's action. Note that the screen takes the keyboard back, because the button pressed goes with the bar. */
  act(_action: TerminalAction): void {
    this.#screen?.focus();
    this.#resumed = false;
    this.#letGo();
    this.connect();
  }

  /** The shell's port asked for, or a shell opened where the session holds none, once the screen has had room. */
  connect(): void {
    const size = this.#size;
    if (size === undefined) return;
    this.#enter({ kind: TERMINAL_STATE.CONNECTING });
    const terminalId = this.#terminalId;
    if (terminalId === undefined) return void this.#open(size);
    this.#awaiting = terminalId;
    this.link.attach(terminalId, size).then(
      (attached) => {
        if ("state" in attached) this.#enter(attached.state);
      },
      () => this.#enter(SERVICE_UNREACHED),
    );
  }

  /** The shell let go, and another opened in its place, as a key after it ended asks. */
  replace(): void {
    this.#letGo();
    this.#terminalId = undefined;
    this.connect();
  }

  /** The port handed in by main for the shell it names, where this session asked for it. */
  takes(agentId: string, terminalId: string): boolean {
    return agentId === this.link.agentId && terminalId === this.#awaiting;
  }

  /** The shell's port, as main posted it. */
  attached(port: MessagePort): void {
    this.#awaiting = undefined;
    this.#port = port;
    this.#unacked = 0;
    port.onmessage = (event) => {
      const message = readOutbound(event.data);
      if (Option.isSome(message)) this.#heard(message.value);
    };
    port.start();
    if (this.#size !== undefined) this.#post({ type: TERMINAL_PORT_MESSAGE.RESIZE, ...this.#size });
    for (const data of this.#typed.splice(0)) this.#send(data);
  }

  /** The screen, the port, and the shell where its link ends it, let go for good, as the tab closes. */
  dispose(): void {
    this.#letGo();
    if (this.#terminalId !== undefined) this.link.close?.(this.#terminalId);
    this.#screen?.dispose();
    this.#screen = undefined;
    this.#listeners.clear();
  }

  #open(size: TerminalSize): void {
    this.link.open?.(size).then(
      (opened) => {
        if ("state" in opened) return this.#enter(opened.state);
        this.#terminalId = opened.terminalId;
        this.connect();
      },
      () => this.#enter(SERVICE_UNREACHED),
    );
  }

  // The sandbox resumed, the tab saying it is connecting meanwhile.
  async #resume(): Promise<void> {
    this.#resumed = true;
    this.#enter({ kind: TERMINAL_STATE.CONNECTING });
    try {
      const refused = await this.link.resume?.();
      if (refused !== undefined) return this.#enter(refused);
      this.#letGo();
      this.connect();
    } catch {
      this.#enter(SERVICE_UNREACHED);
    }
  }

  #letGo(): void {
    this.#port?.close();
    this.#port = undefined;
    this.#awaiting = undefined;
  }

  // A stopped sandbox is resumed where the tab is shown, and only there, so
  // a reload never wakes every hidden tab's; one still stopped after the
  // session resumed it says it did not answer, whose action asks again.
  #enter(next: TerminalState): void {
    if (next.kind === TERMINAL_STATE.STOPPED && this.#shown) {
      if (!this.#resumed) return void this.#resume();
      return void this.#enter({
        kind: TERMINAL_STATE.UNREACHABLE,
        why: TERMINAL_UNREACHED.SANDBOX,
      });
    }
    if (next.kind === TERMINAL_STATE.ATTACHED) this.#resumed = false;
    this.#state = next;
    this.#screen?.dim(terminalLook(next).dim);
    for (const listener of this.#listeners) listener();
  }

  #resized(size: TerminalSize): void {
    const first = this.#size === undefined;
    this.#size = size;
    if (first) this.connect();
    else this.#post({ type: TERMINAL_PORT_MESSAGE.RESIZE, ...size });
  }

  // What is typed goes to the shell's port, or waits for one; after the
  // shell ended or the connection closed, any key is the state's own, and
  // Return runs the bar's action.
  #input(data: string): void {
    const state = this.#state;
    const action = returnAction(state);
    if (state.kind === TERMINAL_STATE.EXITED) {
      this.link.ended(this);
    } else if (state.kind === TERMINAL_STATE.IDLE) {
      this.#letGo();
      this.connect();
    } else if (action !== undefined && this.#port === undefined) {
      if (data === RETURN) this.act(action);
    } else {
      this.#send(data);
    }
  }

  #send(data: string): void {
    if (this.#port === undefined) {
      this.#typed.push(data);
      return;
    }
    for (const message of inputMessages(data)) this.#post(message);
  }

  #post(message: TerminalPortInbound): void {
    this.#port?.postMessage(message);
  }

  #heard(message: Schema.Schema.Type<typeof terminalPortOutboundSchema>): void {
    if (message.type === TERMINAL_PORT_MESSAGE.OUTPUT) {
      // Note that the output is counted in the bytes it came as.
      this.#screen?.write(message.data, () => {
        this.#unacked += message.data.length;
        if (this.#unacked < TERMINAL_FLOW.ACK_EVERY_BYTES) return;
        this.#post({ type: TERMINAL_PORT_MESSAGE.ACK, bytes: this.#unacked });
        this.#unacked = 0;
      });
      return;
    }
    const next = this.link.stateOf(message.state, message.code);
    if (next === undefined || message.state === TERMINAL_CONNECTION.IDLE) this.#letGo();
    if (next === undefined) this.link.ended(this);
    else this.#enter(next);
  }
}

/** The kinds of terminal the window holds sessions of, each keyed by its own ids. */
export const TERMINAL_KIND = {
  CLOUD: "cloud",
  LOCAL: "local",
} as const;

export type TerminalKind = (typeof TERMINAL_KIND)[keyof typeof TERMINAL_KIND];

/** The sessions a window holds, by kind, then by the agent, then by the terminal's own key, and the listener that hands them their ports while any stands. */
interface Sessions {
  readonly held: Map<TerminalKind, Map<string, Map<string, TerminalSession>>>;
  stopHearing: (() => void) | undefined;
}

/** The window's sessions, one set for the registry's life, each let go with it. */
const sessionsAtom = Atom.keepAlive(
  Atom.make((get): Sessions => {
    const sessions: Sessions = { held: new Map(), stopHearing: undefined };
    get.addFinalizer(() => {
      for (const each of everySession(sessions)) each.dispose();
      sessions.held.clear();
      sessions.stopHearing?.();
    });
    return sessions;
  }),
);

function everySession(sessions: Sessions): TerminalSession[] {
  return [...sessions.held.values()].flatMap((agents) =>
    [...agents.values()].flatMap((held) => [...held.values()]),
  );
}

/** The session a terminal holds, made with `make` the first time it is asked for. */
export function terminalSession(
  registry: AtomRegistry.AtomRegistry,
  kind: TerminalKind,
  agentId: string,
  key: string,
  make: () => TerminalSession,
): TerminalSession {
  const sessions = registry.get(sessionsAtom);
  const agents = sessions.held.get(kind) ?? new Map<string, Map<string, TerminalSession>>();
  sessions.held.set(kind, agents);
  const held = agents.get(agentId) ?? new Map<string, TerminalSession>();
  agents.set(agentId, held);
  const found = held.get(key);
  if (found !== undefined) return found;
  const made = make();
  held.set(key, made);
  // Each shell's port goes to the session that asked for it.
  sessions.stopHearing ??= onTerminalPort((ticket, port) =>
    everySession(sessions)
      .find((each) => each.takes(ticket.agentId, ticket.terminalId))
      ?.attached(port),
  );
  return made;
}

/** Ends the sessions of an agent's terminals given, or every one of its kind with none given, as their tabs close. */
export function endTerminalSessions(
  registry: AtomRegistry.AtomRegistry,
  kind: TerminalKind,
  agentId: string,
  keys?: readonly string[],
): void {
  const sessions = registry.get(sessionsAtom);
  const held = sessions.held.get(kind)?.get(agentId);
  if (held === undefined) return;
  for (const key of keys ?? [...held.keys()]) {
    held.get(key)?.dispose();
    held.delete(key);
  }
  if (held.size === 0) sessions.held.get(kind)?.delete(agentId);
  if (everySession(sessions).length > 0) return;
  sessions.stopHearing?.();
  sessions.stopHearing = undefined;
}
