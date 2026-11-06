import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalPortInbound,
  type TerminalPortOutbound,
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
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { useSideBundles } from "../bundle-loader.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TerminalFind, TerminalHandle } from "../terminal/contract.js";
import { onTerminalPort } from "../terminal/terminal-port.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { type HeldShell, localShellsAsked, localShellsHeld, nextShellTitle } from "./local-held.js";
import { useOpenLink } from "./use-open-link.js";
import type { SidePanelControl } from "./use-side-panel.js";

/**
 * use-local-session.ts -- one Local tab's shells on this Mac, in its cloud agent's mirror: opened, attached while the tab is shown, and let go when it is not.
 *
 * While the tab is shown it attaches to the shell it held, else the oldest
 * the window holds for the agent (`local-held.ts`), else a new one: the
 * agent's mirror found or made (`macShell.mirror`, which starts mirroring
 * the agent's files and answers as soon as its folder stands), then a
 * shell opened there (`macShell.open`). Main then posts the shell's port,
 * which carries its bytes and how it stands (`TERMINAL_CONNECTION`) and
 * nothing else. Hidden, the tab closes the port; the shell goes on running
 * in main, which holds the latest of what it printed for the next attach,
 * drawn on a cleared screen, and a reload attaches to it again. A shell
 * main no longer holds, refused on attach, is dropped from the list and the
 * next one found.
 *
 * A shell that ended takes any key for a new one, and the bar's action (its
 * click, or Return) asks again for a mirror or a shell main could not make.
 *
 * The bytes go to the screen and to the port, and nowhere else.
 */

/** How long a resize waits for the next before the shell is told, so a dragged edge tells it once. */
const RESIZE_SETTLES = Duration.millis(100);

/** What a toast says when a shell could not be started or ended. */
const SHELL_FAILED = {
  CREATE: "Could not start a shell.",
  KILL: "Could not end that shell.",
} as const;

/** Reads a message main sent on a shell's port. */
const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

/** Return, as the screen reads it, which runs the bar's action. */
const RETURN = "\r";

/** The ink a terminal prints its own notes in: palette slot 245, which `terminal-theme.ts` gives the note color and a dimmed screen leaves undimmed. */
const NOTE_INK = "\x1b[38;5;245m";
const RESET = "\x1b[0m";

/** What hides the cursor, as a terminal reads it (DECTCEM). */
const HIDE_CURSOR = "\x1b[?25l";

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

/** A shell opened, or why none could be. */
type Opened =
  | { readonly terminalId: string }
  | { readonly why: (typeof TERMINAL_UNREACHED)[keyof typeof TERMINAL_UNREACHED] };

/** What the session holds between renders, read by callbacks no render stands between. */
interface LiveSession {
  state: TerminalState;
  handle: TerminalHandle | undefined;
  port: MessagePort | undefined;
  /** The shell the tab shows, which an attach and a port's ticket name. */
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

/** A Local tab's session: where it stands, where its screen mounts, the bar's action, and its shells. */
export interface LocalSession {
  readonly state: TerminalState;
  /** Whether the terminal bundle failed to load, so there is no screen to draw on. */
  readonly failed: boolean;
  /** Imports the terminal bundle again, where it failed to load. */
  readonly retryBundle: () => void;
  /** The find over the screen's scrollback, once there is a screen. */
  readonly find: TerminalFind | undefined;
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
  /** The agent's shells this window opened, oldest first. */
  readonly listed: readonly HeldShell[];
  /** The shell the screen shows, or nothing before one is found. */
  readonly shell: string | undefined;
  /** Shows another of the agent's shells on the screen. */
  readonly onChoose: (shell: string) => void;
  /** Opens another shell in the same agent's mirror and shows it. */
  readonly onCreate: () => void;
  /** Names a shell, which takes at once. */
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

export function useLocalSession(agentId: string, shown: boolean): LocalSession {
  const { act } = useAct();
  const registry = useContext(RegistryContext);
  const openLink = useOpenLink();
  // Note that the module itself is held, not the result around it, which is a new value each render.
  const { terminal } = useSideBundles();
  const loaded = useAtomValue(terminal);
  const retryBundle = useAtomRefresh(terminal);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const [state, setState] = useState<TerminalState>({ kind: TERMINAL_STATE.CONNECTING });
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<TerminalHandle | undefined>(undefined);
  const [resizeAtom] = useState(() => waitAtom(RESIZE_SETTLES));
  const settleResize = useAtomSet(resizeAtom);
  const listed = useAtomValue(localShellsHeld(agentId));
  const asked = useAtomValue(localShellsAsked(agentId));
  const setAsked = useAtomSet(localShellsAsked(agentId));
  const [shell, setShell] = useState<string | undefined>(undefined);
  const show = useToast();
  const failedToast = useCallback(
    (words: string, cause: unknown) =>
      show({
        words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.TERMINAL_CREATE, cause, about: { agentId } },
      }),
    [show, agentId],
  );
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

  // Note that the list is read and written through the registry, because a
  // connect under way reads it as it lands rather than as its render saw it.
  const heldNow = useCallback(() => registry.get(localShellsHeld(agentId)), [registry, agentId]);
  const writeHeld = useCallback(
    (update: (shells: readonly HeldShell[]) => readonly HeldShell[]) =>
      registry.set(localShellsHeld(agentId), update(registry.get(localShellsHeld(agentId)))),
    [registry, agentId],
  );
  const forget = useCallback(
    (target: string) => writeHeld((shells) => shells.filter((each) => each.terminalId !== target)),
    [writeHeld],
  );

  // Note that a dimmed screen hides its cursor, because no shell stands
  // behind it to type into.
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

  // A new shell in the agent's mirror, held in the window's list, or why
  // main could not make the mirror or the shell.
  const open = useCallback(async (): Promise<Opened> => {
    const mirrored = await act(ACT_KIND.MAC_SHELL_MIRROR, { agentId }).catch(() => undefined);
    if (mirrored === undefined) return { why: TERMINAL_UNREACHED.MIRROR };
    const opened = await act(ACT_KIND.MAC_SHELL_OPEN, {
      agentId,
      folder: mirrored.folder,
    }).catch(() => undefined);
    if (opened === undefined) return { why: TERMINAL_UNREACHED.SHELL };
    const { terminalId } = opened;
    writeHeld((shells) => [...shells, { terminalId, title: nextShellTitle(shells) }]);
    return { terminalId };
  }, [act, agentId, writeHeld]);

  // Note that `connect` is read through a ref here, because a refused
  // attach finds the next shell, and `connect` is built over `attach`.
  const connectNow = useRef<() => Promise<void>>(async () => undefined);

  const attach = useCallback(
    (target: string, opened = false) => {
      const held = live.current;
      const size = held.handle?.size();
      if (size === undefined) return;
      held.shell = target;
      held.attaching = true;
      const asked: AttachAsked = { shell: target };
      held.asked.push(asked);
      setShell(target);
      // Note that the screen is cleared, because main draws all it holds of the shell again.
      held.handle?.reset();
      enter({ kind: TERMINAL_STATE.CONNECTING });
      // An attach main refused posts no port, so it is out of the line, and
      // its shell, which main no longer holds, out of the list; the next one
      // is found in its place, unless it was just opened, which says so.
      void act(ACT_KIND.MAC_SHELL_ATTACH, { agentId, terminalId: target, ...size }).catch(() => {
        held.asked = held.asked.filter((each) => each !== asked);
        if (held.asked.length === 0) held.release?.();
        forget(target);
        if (held.shell !== target) return;
        held.shell = undefined;
        if (!held.attaching || held.asked.length > 0) return;
        if (opened) enter({ kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SHELL });
        else void connectNow.current();
      });
    },
    [act, agentId, enter, forget],
  );

  const connect = useCallback(async () => {
    letGo();
    const generation = live.current.generation;
    const current = () => generation === live.current.generation;
    enter({ kind: TERMINAL_STATE.CONNECTING });
    // A new shell asked for is opened in place of the one held.
    const fresh = registry.get(localShellsAsked(agentId)) > 0;
    if (fresh) setAsked((was) => Math.max(0, was - 1));
    const shells = heldNow();
    const target = shells.find((each) => each.terminalId === live.current.shell) ?? shells[0];
    if (target !== undefined && !fresh) return attach(target.terminalId);
    const made = await open();
    if (!current()) return;
    if ("why" in made) return enter({ kind: TERMINAL_STATE.UNREACHABLE, why: made.why });
    attach(made.terminalId, true);
  }, [agentId, attach, enter, heldNow, letGo, open, registry, setAsked]);
  useLayoutEffect(() => {
    connectNow.current = connect;
  });

  // Note that a shell shown on the same screen as another starts from a
  // clear screen, which main then fills with what it held of that shell.
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
    const made = await open();
    if ("why" in made) return failedToast(SHELL_FAILED.CREATE, made.why);
    onChoose(made.terminalId);
  }, [failedToast, onChoose, open]);

  // A shell's name is the window's own, so it takes at once.
  const onRename = useCallback(
    (target: string, title: string) =>
      writeHeld((shells) =>
        shells.map((each) => (each.terminalId === target ? { ...each, title } : each)),
      ),
    [writeHeld],
  );

  // Note that the shown shell's port is let go before it is ended, so its
  // end is never said as an exit on the screen. The screen then moves on to
  // the oldest shell left, or a new one, where nothing else moved it meanwhile.
  const onKill = useCallback(
    async (target: string): Promise<ActionResult> => {
      const held = live.current;
      const shown = target === held.shell;
      if (shown) {
        letGo();
        held.shell = undefined;
        held.handle?.reset();
      }
      const generation = held.generation;
      try {
        await act(ACT_KIND.MAC_SHELL_CLOSE, { agentId, terminalId: target });
        forget(target);
        if (shown && held.generation === generation) await connect();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      } catch {
        if (shown && held.generation === generation) attach(target);
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: SHELL_FAILED.KILL };
      }
    },
    [act, agentId, attach, connect, forget, letGo],
  );

  // Note that the screen takes the keyboard back as the bar's action
  // starts, because the button pressed goes with the bar.
  const onAction = useCallback(
    (_action: TerminalAction) => {
      live.current.handle?.focus();
      void connect();
    },
    [connect],
  );

  // The shown shell that ended let go, out of main and the list, and the
  // next one found in its place, as a key or a new shell asked for opens it.
  const replaceEnded = useCallback(() => {
    const held = live.current;
    const ended = held.shell;
    held.shell = undefined;
    if (ended !== undefined) {
      forget(ended);
      void act(ACT_KIND.MAC_SHELL_CLOSE, { agentId, terminalId: ended }).catch(() => undefined);
    }
    void connect();
  }, [act, agentId, connect, forget]);

  // What is typed goes to the shell while one is attached, and otherwise
  // is the state's own: any key after the shell ended opens a new one in
  // its place, Return runs the bar's action, and nothing while a shell opens.
  const onInput = useCallback(
    (data: string) => {
      const held = live.current;
      switch (held.state.kind) {
        case TERMINAL_STATE.EXITED:
          return replaceEnded();
        case TERMINAL_STATE.UNREACHABLE:
          if (data === RETURN) onAction(TERMINAL_ACTION.RETRY);
          return;
        case TERMINAL_STATE.ATTACHED:
          for (const message of inputMessages(data)) held.port?.postMessage(message);
          return;
        default:
          // Note that typing goes out only to an attached shell, because nothing stands to take it while one opens.
          return;
      }
    },
    [onAction, replaceEnded],
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
      enter(
        message.state === TERMINAL_CONNECTION.EXITED
          ? { kind: TERMINAL_STATE.EXITED, code: message.code }
          : { kind: TERMINAL_STATE.ATTACHED },
      );
    },
    [enter],
  );

  // Note that the screen reads the latest of these through refs, because
  // mounting it again for a new closure would lose its scrollback, and the
  // link opener is a new closure whenever the listed tasks change.
  const typed = useRef(onInput);
  const linked = useRef(openLink);
  useLayoutEffect(() => {
    typed.current = onInput;
    linked.current = openLink;
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
      onLink: (url) => linked.current(url),
    });
    live.current.handle = mounted;
    setHandle(mounted);
    return () => {
      live.current.handle = undefined;
      setHandle(undefined);
      mounted.unmount();
    };
  }, [module, element, settleResize]);

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

  // Note that a tab taken down with attaches still out closes their ports
  // as they land, since no listener of its own is left to, and an unclaimed
  // port would hold its shell's output back. It reads the same line of
  // attaches the tab kept, which a refused attach leaves as well, and stops
  // listening once that line is empty, so it never takes a port a later
  // tab asked for.
  useEffect(() => {
    const held = live.current;
    return () => {
      if (held.asked.length === 0) return;
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
  }, [agentId]);

  // Connected only while shown, and only once there is a screen to draw on.
  // Note that a shell that ended with a new one asked for is left to the
  // ask's own effect below, which lets the ended one go first, because
  // connecting here as well would open a shell beside the one asked for.
  useEffect(() => {
    if (!shown || handle === undefined) return;
    handle.focus();
    const replacing =
      live.current.state.kind === TERMINAL_STATE.EXITED &&
      registry.get(localShellsAsked(agentId)) > 0;
    if (!replacing) void connect();
    return letGo;
  }, [shown, handle, agentId, connect, letGo, registry]);

  // A new shell asked for while a shell is attached opens at once, each ask
  // its own shell; one asked for while the shown shell ended is the key
  // that opens it; one asked for before is opened by the connect. Note that
  // attached means a port held too, because a hidden tab let its port go
  // and its state stands as it was until it is shown again.
  useEffect(() => {
    if (!shown || asked === 0) return;
    if (state.kind === TERMINAL_STATE.ATTACHED && live.current.port !== undefined) {
      setAsked((was) => Math.max(0, was - 1));
      void onCreate();
      return;
    }
    if (state.kind === TERMINAL_STATE.EXITED) replaceEnded();
  }, [shown, asked, state.kind, setAsked, onCreate, replaceEnded]);

  return {
    state,
    failed: AsyncResult.isFailure(loaded),
    retryBundle,
    find: handle?.find,
    screen: setElement,
    onAction,
    listed,
    shell,
    onChoose,
    onCreate: () => void onCreate(),
    onRename,
    onKill,
  };
}

/**
 * Opens an agent's Local tab, handing the panel the keys (`onShown`): with a
 * new shell asked of its mirror (`fresh`), as the Local rows of the panel's
 * "+" and ⌘K mean it, or on the shell it holds, as Show local does.
 */
export function useOpenLocal(
  sidePanel: Pick<SidePanelControl, "onChoose">,
  onShown: () => void,
): (agentId: string, fresh: boolean) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (agentId, fresh) => {
      if (fresh) registry.update(localShellsAsked(agentId), (asked) => asked + 1);
      sidePanel.onChoose({ local: agentId });
      onShown();
    },
    [registry, sidePanel.onChoose, onShown],
  );
}
