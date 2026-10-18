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
import {
  TERMINAL_ACTION,
  TERMINAL_STATE,
  TERMINAL_UNREACHED,
  type TerminalAction,
  type TerminalState,
  terminalLook,
} from "@luke/features/terminal-model";
import { sandboxRead, shellsAsked } from "@luke/features/terminal-store";
import { SANDBOX_STATE, type TerminalsAnswer } from "@luke/features/terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSideBundles } from "../bundle-loader";
import { rendererRuntime } from "../renderer-runtime";
import type { TerminalFind, TerminalHandle } from "../terminal/contract";
import { onTerminalPort } from "../terminal/terminal-port";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";

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

/** How often a tab waiting on an agent that has not opened its sandbox lists again, and a shown tab reads its shells again. */
const STARTING_RELIST = Duration.seconds(5);
const SHELLS_REREAD = Duration.seconds(5);

/** What a toast says when a shell could not be started, named, or ended. */
const SHELL_FAILED = {
  CREATE: "Could not start a shell.",
  RENAME: "Could not rename that shell.",
  KILL: "Could not end that shell.",
} as const;

/** The states the host says that change the agent's shells. */
const LIST_CHANGES: ReadonlySet<TerminalState["kind"]> = new Set([
  TERMINAL_STATE.STOPPED,
  TERMINAL_STATE.STARTING,
  TERMINAL_STATE.EXITED,
]);

/** Reads a message main sent on a shell's port. */
const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

/** Return, as the screen reads it, which runs the bar's action. */
const RETURN = "\r";

/** The grey a terminal prints its own notes in: the palette's bright black. */
const NOTE_INK = "\x1b[90m";
const RESET = "\x1b[0m";

/** What hides the cursor, as a terminal reads it (DECTCEM). */
const HIDE_CURSOR = "\x1b[?25l";

/** Where a call main refused leaves the tab: main refuses where the service could not be reached or did not answer. */
const SERVICE_UNREACHED: TerminalState = {
  kind: TERMINAL_STATE.UNREACHABLE,
  why: TERMINAL_UNREACHED.SERVICE,
};

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
    case TERMINAL_CONNECTION.UNAVAILABLE:
      return { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.RELAY };
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
 * shell or agent not found or a sandbox that did not answer, saying
 * which; nothing for an agent archived or retired, whose tab closes, as its
 * Changes tab does.
 */
function refusedState(refused: TerminalRefusal): TerminalState | undefined {
  switch (refused) {
    case TERMINAL_REFUSAL.SANDBOX_STOPPED:
      return { kind: TERMINAL_STATE.STOPPED };
    case TERMINAL_REFUSAL.AGENT_NOT_READY:
      return { kind: TERMINAL_STATE.STARTING };
    case TERMINAL_REFUSAL.NOT_FOUND:
      return { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.NOT_FOUND };
    case TERMINAL_REFUSAL.SANDBOX_UNANSWERED:
      return { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SANDBOX };
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
  /** Whether the tab is shown, which its shells are read again for. */
  showing: boolean;
  /**
   * Counts each change of the list the tab makes or asks for, so a read
   * that went out before one lands nowhere rather than undoing it.
   */
  listMoves: number;
}

/** A Terminal tab's session: where it stands, where its screen mounts, and the bar's action. */
export interface TerminalSession {
  readonly state: TerminalState;
  /** Whether the terminal bundle failed to load, so there is no screen to draw on. */
  readonly failed: boolean;
  /** The find over the screen's scrollback, once there is a screen. */
  readonly find: TerminalFind | undefined;
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
  /** The agent's shells and where its sandbox stands, as last read, or nothing before the first read. */
  readonly listed: TerminalsAnswer | undefined;
  /** The shell the screen shows, or nothing before one is found. */
  readonly shell: string | undefined;
  /** Shows another of the agent's shells on the screen. */
  readonly onChoose: (shell: string) => void;
  /** Starts a shell in the same agent's sandbox and shows it. */
  readonly onCreate: () => void;
  readonly onRename: (shell: string, title: string) => void;
  /** Ends a shell, answering whether it ended; the one shown gives way to the oldest left, or a new one. */
  readonly onKill: (shell: string) => Promise<ActionResult>;
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
  const loaded = useAtomValue(useSideBundles().terminal);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const [state, setState] = useState<TerminalState>({ kind: TERMINAL_STATE.CONNECTING });
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<TerminalHandle | undefined>(undefined);
  const [resizeAtom] = useState(() => waitAtom(RESIZE_SETTLES));
  const [relistAtom] = useState(() => waitAtom(STARTING_RELIST));
  const [rereadAtom] = useState(() => waitAtom(SHELLS_REREAD));
  const settleResize = useAtomSet(resizeAtom);
  const relistLater = useAtomSet(relistAtom);
  const rereadLater = useAtomSet(rereadAtom);
  const listed = useAtomValue(sandboxRead(agentId));
  const setListed = useAtomSet(sandboxRead(agentId));
  const asked = useAtomValue(shellsAsked(agentId));
  const setAsked = useAtomSet(shellsAsked(agentId));
  // Note that the ask is read through a ref too, because a connect under way reads it as it lands.
  const askedNow = useRef(asked);
  useLayoutEffect(() => {
    askedNow.current = asked;
  });
  const [shell, setShell] = useState<string | undefined>(undefined);
  const show = useToast();
  const failedToast = useCallback(
    (words: string) => show({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED }),
    [show],
  );
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
    showing: false,
    listMoves: 0,
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
      setShell(shell);
      enter({ kind: TERMINAL_STATE.CONNECTING });
      // An attach main refused posts no port, so it is out of the line.
      void act(ACT_KIND.TERMINAL_ATTACH, { agentId, terminalId: shell, ...size }).catch(() => {
        held.asked = held.asked.filter((each) => each !== asked);
        if (held.asked.length === 0) held.release?.();
        if (held.attaching && held.asked.length === 0) enter(SERVICE_UNREACHED);
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
      setListed(listed);
      if (listed.sandbox === SANDBOX_STATE.STOPPED) return wait({ kind: TERMINAL_STATE.STOPPED });
      if (listed.sandbox === SANDBOX_STATE.STARTING) return wait({ kind: TERMINAL_STATE.STARTING });
      // A new shell asked for is started in place of the one held.
      const fresh = askedNow.current > 0;
      if (fresh) setAsked((was) => Math.max(0, was - 1));
      const held = listed.terminals.find((each) => each.id === live.current.shell);
      const oldest = held ?? listed.terminals[0];
      if (oldest !== undefined && !fresh) return attach(oldest.id);
      const made = await act(ACT_KIND.TERMINAL_CREATE, { agentId });
      if (!current()) return;
      if ("refused" in made) return wait(refusedState(made.refused));
      setListed({ ...listed, terminals: [...listed.terminals, made.terminal] });
      attach(made.terminal.id);
    } catch {
      if (current()) enter(SERVICE_UNREACHED);
    }
  }, [act, agentId, attach, enter, letGo, relistLater, setAsked, setListed]);

  // The list as an answer says it, every read since let go.
  const writeList = useCallback(
    (answer: TerminalsAnswer) => {
      live.current.listMoves += 1;
      setListed(answer);
    },
    [setListed],
  );

  // The shells read again without touching the connection; a read that
  // fails or is refused leaves the last one standing, and one overtaken by
  // a change the tab made since is let go.
  const reread = useCallback(async () => {
    const seen = live.current.listMoves;
    try {
      const answer = await act(ACT_KIND.TERMINAL_LIST, { agentId });
      if (!("refused" in answer) && live.current.listMoves === seen) writeList(answer);
    } catch {
      // The next read, a few seconds on, asks again.
    }
  }, [act, agentId, writeList]);

  // Note that a shell shown on the same screen as another starts from a
  // clear screen, which its tmux session then redraws.
  const onChoose = useCallback(
    (next: string) => {
      const held = live.current;
      // The screen takes the keyboard from the row pressed, the shell's to type into.
      held.handle?.focus();
      if (next === held.shell && held.port !== undefined) return;
      letGo();
      held.handle?.reset();
      attach(next);
    },
    [attach, letGo],
  );

  const onCreate = useCallback(async () => {
    try {
      const made = await act(ACT_KIND.TERMINAL_CREATE, { agentId });
      if ("refused" in made) {
        const next = refusedState(made.refused);
        return next === undefined ? gone.current() : enter(next);
      }
      onChoose(made.terminal.id);
      await reread();
    } catch {
      failedToast(SHELL_FAILED.CREATE);
    }
  }, [act, agentId, enter, failedToast, onChoose, reread]);

  const onRename = useCallback(
    async (target: string, title: string) => {
      live.current.listMoves += 1;
      try {
        const answer = await act(ACT_KIND.TERMINAL_RENAME, { agentId, terminalId: target, title });
        if ("refused" in answer) return failedToast(SHELL_FAILED.RENAME);
        writeList(answer);
      } catch {
        failedToast(SHELL_FAILED.RENAME);
      }
    },
    [act, agentId, failedToast, writeList],
  );

  // Note that the shown shell's port is let go before it is ended, because
  // the host says it is gone on that port, which would start a shell in its
  // place beside the one this starts. Once the end answers, the screen moves
  // on only where nothing else has moved it meanwhile: to the oldest shell
  // left, or back to the same shell where it was not ended.
  const onKill = useCallback(
    async (target: string): Promise<ActionResult> => {
      const held = live.current;
      held.listMoves += 1;
      const shown = target === held.shell;
      if (shown) {
        letGo();
        held.shell = undefined;
        held.handle?.reset();
      }
      const generation = held.generation;
      const moveOn = async (ended: boolean) => {
        if (!shown || held.generation !== generation) return;
        if (!ended) held.shell = target;
        await connect();
      };
      try {
        const answer = await act(ACT_KIND.TERMINAL_KILL, { agentId, terminalId: target });
        if ("refused" in answer) {
          await moveOn(false);
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: SHELL_FAILED.KILL };
        }
        writeList(answer);
        await moveOn(true);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      } catch {
        await moveOn(false);
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: SHELL_FAILED.KILL };
      }
    },
    [act, agentId, connect, letGo, writeList],
  );

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
      if (generation === live.current.generation) enter(SERVICE_UNREACHED);
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
      // A sandbox that stopped or a shell that ended changes the list, which is read again.
      if (LIST_CHANGES.has(next.kind)) void reread();
    },
    [connect, enter, reread],
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

  // A new shell asked for while a shell is attached starts at once, each ask
  // its own shell; one asked for of a connection the host ended is the key
  // that connects again, starting it; one asked for before is started by
  // the connect, once the sandbox runs, which a stopped one waits on Resume
  // for. Note that attached means a port held too, because a hidden tab let
  // its port go and its state stands as it was until it is shown again.
  useEffect(() => {
    if (!shown || asked === 0) return;
    if (state.kind === TERMINAL_STATE.ATTACHED && live.current.port !== undefined) {
      setAsked((was) => Math.max(0, was - 1));
      void onCreate();
      return;
    }
    if (state.kind === TERMINAL_STATE.IDLE || state.kind === TERMINAL_STATE.EXITED) void connect();
  }, [shown, asked, state.kind, setAsked, onCreate, connect]);

  // While shown, the shells are read again every few seconds and whenever
  // the window takes the keyboard back, so a shell started or ended
  // elsewhere, or a command started in one, shows in the list.
  useEffect(() => {
    if (!shown) return;
    const held = live.current;
    held.showing = true;
    const again = () =>
      rereadLater({
        run: () => {
          if (!held.showing) return;
          void reread();
          again();
        },
      });
    again();
    const onFocus = () => void reread();
    window.addEventListener("focus", onFocus);
    return () => {
      held.showing = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [shown, reread, rereadLater]);

  return {
    state,
    failed: AsyncResult.isFailure(loaded),
    find: handle?.find,
    screen: setElement,
    onAction,
    listed,
    shell,
    onChoose,
    onCreate: () => void onCreate(),
    onRename: (target, title) => void onRename(target, title),
    onKill,
  };
}
