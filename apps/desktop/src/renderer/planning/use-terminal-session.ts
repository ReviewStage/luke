import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  TERMINAL_REFUSAL,
  type TerminalConnection,
  type TerminalPortInbound,
  type TerminalPortOutbound,
  type TerminalRefusal,
  terminalPortOutboundSchema,
} from "@luke/features/terminal-acts";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { rendererRuntime } from "../renderer-runtime";
import type { TerminalHandle } from "../terminal/contract";
import { onTerminalPort } from "../terminal/terminal-port";
import { terminalModuleAtom } from "./terminal-bundle";
import {
  TERMINAL_ACTION,
  TERMINAL_STATE,
  type TerminalAction,
  type TerminalState,
  terminalLook,
} from "./terminal-model";
import { useOpenLink } from "./use-open-link";

/**
 * use-terminal-session.ts -- one Terminal tab's connection to a shell in its agent's sandbox: found, attached while the tab is shown, and let go when it is not.
 *
 * A terminal connects on demand and disconnects when it is not used. While
 * the tab is shown it lists the agent's shells (`terminal.list`), which never
 * wakes a stopped sandbox, and attaches to the one it held, else the oldest,
 * else a new one (`terminal.create`); main then posts the shell's port, which
 * carries its bytes and where the connection stands (`TERMINAL_CONNECTION`)
 * and nothing else. Hidden, the tab closes the port, which detaches; the
 * shells go on running in the sandbox, and showing the tab again attaches
 * to the same one, which tmux redraws.
 *
 * What each state asks of the developer is what a terminal asks: after five
 * minutes without typing any key reconnects, a shell that ended takes any key
 * for a new one, and the bar's action (its click, or Return) retries a
 * dropped connection or resumes a stopped sandbox, which nothing but that
 * resumes. While the agent has not opened its sandbox the tab lists again
 * every few seconds, and once a shell's port is open the host waits on the
 * sandbox itself.
 *
 * The bytes go to the screen and to the port, and nowhere else.
 */

/** How long a resize waits for the next before the shell is told, so a dragged edge tells it once. */
const RESIZE_SETTLES = Duration.millis(100);

/** How often a tab waiting on an agent that has not opened its sandbox lists again. */
const STARTING_RELIST = Duration.seconds(5);

/** Reads a message main sent on a shell's port. */
const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

/** Return, as the screen reads it, which runs the bar's action. */
const RETURN = "\r";

/** The grey a terminal prints its own notes in: the palette's bright black. */
const NOTE_INK = "\x1b[90m";
const RESET = "\x1b[0m";

/** What hides the cursor, as a terminal reads it (DECTCEM). */
const HIDE_CURSOR = "\x1b[?25l";

/** A state from the host's word for it. */
function stateOf(
  connection: TerminalConnection,
  code: number | undefined,
): TerminalState | undefined {
  switch (connection) {
    case TERMINAL_CONNECTION.CONNECTING:
      return { kind: TERMINAL_STATE.CONNECTING };
    case TERMINAL_CONNECTION.ATTACHED:
      return { kind: TERMINAL_STATE.ATTACHED };
    case TERMINAL_CONNECTION.RECONNECTING:
      return { kind: TERMINAL_STATE.RECONNECTING };
    case TERMINAL_CONNECTION.IDLE:
      return { kind: TERMINAL_STATE.IDLE };
    case TERMINAL_CONNECTION.STOPPED:
      return { kind: TERMINAL_STATE.STOPPED };
    case TERMINAL_CONNECTION.STARTING:
      return { kind: TERMINAL_STATE.STARTING };
    case TERMINAL_CONNECTION.EXITED:
      return { kind: TERMINAL_STATE.EXITED, code };
    case TERMINAL_CONNECTION.GONE:
      return undefined;
  }
}

/** The action Return runs in a state, where the state offers one. */
function returnAction(state: TerminalState): TerminalAction | undefined {
  switch (state.kind) {
    case TERMINAL_STATE.RECONNECTING:
    case TERMINAL_STATE.UNREACHABLE:
      return TERMINAL_ACTION.RETRY;
    case TERMINAL_STATE.STOPPED:
      return TERMINAL_ACTION.RESUME;
    default:
      return undefined;
  }
}

/**
 * Where a refusal leaves the tab: a stopped sandbox's bar, the wait for an
 * agent that has not opened its sandbox, or the bar that asks again for a
 * shell or agent not found; nothing for an agent archived or retired, whose
 * tab closes, as its Changes tab does.
 */
function refusedState(refused: TerminalRefusal): TerminalState | undefined {
  switch (refused) {
    case TERMINAL_REFUSAL.SANDBOX_STOPPED:
      return { kind: TERMINAL_STATE.STOPPED };
    case TERMINAL_REFUSAL.AGENT_NOT_READY:
      return { kind: TERMINAL_STATE.STARTING };
    case TERMINAL_REFUSAL.NOT_FOUND:
      return { kind: TERMINAL_STATE.UNREACHABLE };
    case TERMINAL_REFUSAL.GONE:
      return undefined;
  }
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

/** One attach out, by the shell it named; its own object, so a refusal takes that one out of line. */
interface AttachAsked {
  readonly shell: string;
}

/** What the session holds between renders, read by callbacks no render stands between. */
interface LiveSession {
  state: TerminalState;
  handle: TerminalHandle | undefined;
  port: MessagePort | undefined;
  /** The shell the tab shows, which an attach, a reconnect, and a port's ticket name. */
  shell: string | undefined;
  /** Whether the tab wants the port of the newest attach it sent. */
  attaching: boolean;
  /**
   * The attaches out whose ports have not arrived, oldest first, each by the
   * shell it named. Note that only the newest one's port is taken, because
   * main posts them in the order they were asked for and a ticket names the
   * shell alone, so an earlier attach's port, landing late, is told apart by
   * its place in line; a port that answers no attach in line is not counted.
   */
  asked: AttachAsked[];
  /** Lets go of what waits on the line of attaches once it empties, after the tab was taken down. */
  release: (() => void) | undefined;
  /** How many characters the screen has drawn since it last said so. */
  unacked: number;
  /** Counts each connect up, so an answer to one the tab has since let go lands nowhere. */
  generation: number;
}

/** A Terminal tab's session: where it stands, where its screen mounts, and the bar's action. */
export interface TerminalSession {
  readonly state: TerminalState;
  /** Whether the terminal bundle failed to load, so there is no screen to draw on. */
  readonly failed: boolean;
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
}

/** What runs once a wait has passed. Note that it is wrapped, because an atom's setter calls a bare function as an update. */
interface AfterWait {
  readonly run: () => void;
}

/** A wait, as an atom whose call runs what it is handed once it has passed, a later call standing in for one still waiting. */
const waitAtom = (wait: Duration.Duration) =>
  rendererRuntime.fn((after: AfterWait) =>
    Effect.sleep(wait).pipe(Effect.andThen(Effect.sync(after.run))),
  );

export function useTerminalSession(
  agentId: string,
  shown: boolean,
  /** Closes the tab, once the service says the agent was archived or retired. */
  onGone: () => void,
): TerminalSession {
  const { act } = useAct();
  const openLink = useOpenLink();
  // Note that the module itself is held, not the result around it, which is a new value each render.
  const loaded = useAtomValue(terminalModuleAtom);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const [state, setState] = useState<TerminalState>({ kind: TERMINAL_STATE.CONNECTING });
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<TerminalHandle | undefined>(undefined);
  const [resizeAtom] = useState(() => waitAtom(RESIZE_SETTLES));
  const [relistAtom] = useState(() => waitAtom(STARTING_RELIST));
  const settleResize = useAtomSet(resizeAtom);
  const relistLater = useAtomSet(relistAtom);
  // Note that the close is read through a ref, because the tab hands a new one each render.
  const gone = useRef(onGone);
  useLayoutEffect(() => {
    gone.current = onGone;
  });
  const live = useRef<LiveSession>({
    state,
    handle: undefined,
    port: undefined,
    shell: undefined,
    attaching: false,
    asked: [],
    release: undefined,
    unacked: 0,
    generation: 0,
  });

  // Note that a dimmed screen hides its cursor, because no shell stands
  // behind it to type into; tmux shows it again as it redraws on reattach.
  const enter = useCallback((next: TerminalState) => {
    const { line, dim } = terminalLook(next);
    const was = terminalLook(live.current.state);
    live.current.state = next;
    setState(next);
    const said = line === undefined ? "" : `\r\n${NOTE_INK}${line}${RESET}\r\n`;
    const hidden = dim && !was.dim ? HIDE_CURSOR : "";
    if (said !== "" || hidden !== "") live.current.handle?.write(said + hidden, () => undefined);
  }, []);

  const letGo = useCallback(() => {
    live.current.generation += 1;
    live.current.attaching = false;
    live.current.port?.close();
    live.current.port = undefined;
  }, []);

  const attach = useCallback(
    (shell: string) => {
      const held = live.current;
      const size = held.handle?.size();
      if (size === undefined) return;
      held.shell = shell;
      held.attaching = true;
      const asked: AttachAsked = { shell };
      held.asked.push(asked);
      enter({ kind: TERMINAL_STATE.CONNECTING });
      // An attach main refused posts no port, so it is out of the line.
      void act(ACT_KIND.TERMINAL_ATTACH, { agentId, terminalId: shell, ...size }).catch(() => {
        held.asked = held.asked.filter((each) => each !== asked);
        if (held.asked.length === 0) held.release?.();
        if (held.attaching && held.asked.length === 0) enter({ kind: TERMINAL_STATE.UNREACHABLE });
      });
    },
    [act, agentId, enter],
  );

  const connect = useCallback(async () => {
    letGo();
    const generation = live.current.generation;
    const current = () => generation === live.current.generation;
    enter({ kind: TERMINAL_STATE.CONNECTING });
    // An agent that has not opened its sandbox is listed again a while on,
    // and one gone closes its tab.
    const wait = (next: TerminalState | undefined) => {
      if (next === undefined) return gone.current();
      enter(next);
      if (next.kind !== TERMINAL_STATE.STARTING) return;
      relistLater({
        run: () => {
          if (current()) void connect();
        },
      });
    };
    try {
      const listed = await act(ACT_KIND.TERMINAL_LIST, { agentId });
      if (!current()) return;
      if ("refused" in listed) return wait(refusedState(listed.refused));
      if (listed.sandbox === SANDBOX_STATE.STOPPED) return wait({ kind: TERMINAL_STATE.STOPPED });
      if (listed.sandbox === SANDBOX_STATE.STARTING) return wait({ kind: TERMINAL_STATE.STARTING });
      const held = listed.terminals.find((each) => each.id === live.current.shell);
      const oldest = held ?? listed.terminals[0];
      if (oldest !== undefined) return attach(oldest.id);
      const made = await act(ACT_KIND.TERMINAL_CREATE, { agentId });
      if (!current()) return;
      if ("refused" in made) return wait(refusedState(made.refused));
      attach(made.terminal.id);
    } catch {
      if (current()) enter({ kind: TERMINAL_STATE.UNREACHABLE });
    }
  }, [act, agentId, attach, enter, letGo, relistLater]);

  const resume = useCallback(async () => {
    const generation = live.current.generation;
    enter({ kind: TERMINAL_STATE.RESUMING, since: Date.now() });
    try {
      const resumed = await act(ACT_KIND.TERMINAL_RESUME, { agentId });
      if (generation !== live.current.generation) return;
      if ("refused" in resumed) {
        const next = refusedState(resumed.refused);
        return next === undefined ? gone.current() : enter(next);
      }
      await connect();
    } catch {
      if (generation === live.current.generation) enter({ kind: TERMINAL_STATE.UNREACHABLE });
    }
  }, [act, agentId, connect, enter]);

  // Note that the screen takes the keyboard back as the bar's action
  // starts, because the button pressed goes with the bar.
  const onAction = useCallback(
    (action: TerminalAction) => {
      live.current.handle?.focus();
      if (action === TERMINAL_ACTION.RESUME) return void resume();
      // A dropped connection is asked for again at once, which replaces the
      // host's own retry; a read that failed starts over.
      const { shell } = live.current;
      if (live.current.state.kind === TERMINAL_STATE.RECONNECTING && shell !== undefined) {
        attach(shell);
      } else {
        void connect();
      }
    },
    [attach, connect, resume],
  );

  // What is typed goes to the shell while one is attached, and otherwise
  // is the state's own: any key after an idle close or an ended shell,
  // Return for the bar's action, and nothing while a connection opens.
  const onInput = useCallback(
    (data: string) => {
      const held = live.current;
      switch (held.state.kind) {
        case TERMINAL_STATE.IDLE:
          if (held.shell !== undefined) attach(held.shell);
          return;
        case TERMINAL_STATE.EXITED:
          held.shell = undefined;
          void connect();
          return;
        default: {
          const action = returnAction(held.state);
          if (action !== undefined) {
            if (data === RETURN) onAction(action);
            return;
          }
          // Note that typing goes out only to an attached shell, because the
          // host drops what reaches a connection still opening or dropped.
          if (held.state.kind !== TERMINAL_STATE.ATTACHED) return;
          for (const message of inputMessages(data)) held.port?.postMessage(message);
        }
      }
    },
    [attach, connect, onAction],
  );

  const onPortMessage = useCallback(
    (message: TerminalPortOutbound) => {
      const held = live.current;
      if (message.type === TERMINAL_PORT_MESSAGE.OUTPUT) {
        // Note that the output is counted in the bytes it came as, and only
        // for the port it came on, which a write still drawing can outlive.
        const source = held.port;
        held.handle?.write(message.data, () => {
          if (held.port !== source) return;
          held.unacked += message.data.length;
          if (held.unacked < TERMINAL_FLOW.ACK_EVERY_BYTES) return;
          const ack: TerminalPortInbound = { type: TERMINAL_PORT_MESSAGE.ACK, bytes: held.unacked };
          held.port?.postMessage(ack);
          held.unacked = 0;
        });
        return;
      }
      const next = stateOf(message.state, message.code);
      if (next === undefined) {
        // The shell was killed elsewhere: find another, or open one.
        held.shell = undefined;
        void connect();
        return;
      }
      enter(next);
    },
    [connect, enter],
  );

  // Note that the screen reads the latest of these through a ref, because
  // mounting it again for a new closure would lose its scrollback.
  const typed = useRef(onInput);
  useLayoutEffect(() => {
    typed.current = onInput;
  });

  // The screen mounts once the bundle has loaded and the tab has drawn its place.
  useEffect(() => {
    if (module === undefined || element === null) return;
    const mounted = module.mount(element, {
      onInput: (data) => typed.current(data),
      onResize: (size) =>
        settleResize({
          run: () => {
            const resize: TerminalPortInbound = { type: TERMINAL_PORT_MESSAGE.RESIZE, ...size };
            live.current.port?.postMessage(resize);
          },
        }),
      onLink: openLink,
    });
    live.current.handle = mounted;
    setHandle(mounted);
    return () => {
      live.current.handle = undefined;
      setHandle(undefined);
      mounted.unmount();
    };
  }, [module, element, openLink, settleResize]);

  // The shell's port, which main posts to this window alone after an attach.
  useEffect(
    () =>
      onTerminalPort((ticket, port) => {
        const held = live.current;
        const [first] = held.asked;
        const answers = ticket.agentId === agentId && ticket.terminalId === first?.shell;
        if (!answers) return port.close();
        held.asked.shift();
        const newest = held.asked.length === 0 && ticket.terminalId === held.shell;
        if (!held.attaching || !newest) return port.close();
        held.port?.close();
        held.port = port;
        held.unacked = 0;
        port.onmessage = (event) => {
          if (held.port !== port) return;
          const message = readOutbound(event.data);
          if (Option.isSome(message)) onPortMessage(message.value);
        };
        port.start();
      }),
    [agentId, onPortMessage],
  );

  // Note that a tab taken down with attaches still out lets their shells go,
  // and closes their ports as they land, since no listener of its own is
  // left to, and an unclaimed port would hold its connection open. It reads
  // the same line of attaches the tab kept, which a refused attach leaves as
  // well, and stops listening once that line is empty, so it never takes a
  // port a later tab asked for.
  useEffect(() => {
    const held = live.current;
    return () => {
      if (held.asked.length === 0) return;
      for (const shell of new Set(held.asked.map((asked) => asked.shell))) {
        void act(ACT_KIND.TERMINAL_DETACH, { agentId, terminalId: shell }).catch(() => undefined);
      }
      // Note that a port is matched to any attach still out for its shell,
      // not only the oldest, since nothing waits on their order any more.
      const stop = onTerminalPort((ticket, port) => {
        const at = held.asked.findIndex((asked) => asked.shell === ticket.terminalId);
        if (ticket.agentId !== agentId || at < 0) return;
        port.close();
        held.asked.splice(at, 1);
        if (held.asked.length === 0) stop();
      });
      held.release = stop;
    };
  }, [act, agentId]);

  // Connected only while shown, and only once there is a screen to draw on.
  useEffect(() => {
    if (!shown || handle === undefined) return;
    handle.focus();
    void connect();
    return letGo;
  }, [shown, handle, connect, letGo]);

  return { state, failed: AsyncResult.isFailure(loaded), screen: setElement, onAction };
}
