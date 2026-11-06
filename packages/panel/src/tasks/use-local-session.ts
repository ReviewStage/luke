import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
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
import { type LocalStripTab, sameTab } from "@repo/ui/tab-strip-model";
import { Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { askAct, tellAct } from "../act.js";
import { useSideBundles } from "../bundle-loader.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TerminalFind, TerminalHandle } from "../terminal/contract.js";
import { onTerminalPort } from "../terminal/terminal-port.js";
import { type HeldShell, localShellsHeld, nextShellTitle } from "./local-held.js";
import { useOpenLink } from "./use-open-link.js";
import type { SidePanelControl } from "./use-side-panel.js";

/**
 * use-local-session.ts -- one Local tab's terminal on this Mac, in its cloud agent's mirror: its shell opened, attached while the tab is shown, and let go when it is not; and the doors that open such a tab and end its terminal as it closes.
 *
 * Each terminal is a tab of its own, minted in the window's list
 * (`local-held.ts`) as its tab opens. While the tab is shown it attaches to
 * the terminal's shell, or where none is open yet opens one: the agent's
 * mirror found or made (`macShell.mirror`, which starts mirroring the
 * agent's files and answers as soon as its folder stands), then a shell
 * opened there (`macShell.open`). Main then posts the shell's port, which
 * carries its bytes and how it stands (`TERMINAL_CONNECTION`) and nothing
 * else. Hidden, the tab closes the port; the shell goes on running in main,
 * which holds the latest of what it printed for the next attach, drawn on a
 * cleared screen, and a reload attaches to it again. A shell main no longer
 * holds, refused on attach, is forgotten and a new one opened in its place.
 *
 * A shell that ended takes any key for a new one in the same tab, and the
 * bar's action (its click, or Return) asks again for a mirror or a shell
 * main could not make. Closing the tab ends its terminal (`useEndLocal`).
 *
 * The bytes go to the screen and to the port, and nowhere else.
 */

/** How long a resize waits for the next before the shell is told, so a dragged edge tells it once. */
const RESIZE_SETTLES = Duration.millis(100);

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
  readonly terminalId: string;
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
  terminalId: string | undefined;
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

/** A Local tab's session: where it stands, where its screen mounts, and the bar's action. */
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

/** The terminal without the shell it held, whose id main no longer answers to. */
function withoutShell(held: HeldShell): HeldShell {
  const { terminalId: _gone, ...rest } = held;
  return rest;
}

export function useLocalSession(agentId: string, shellId: string, shown: boolean): LocalSession {
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
  const live = useRef<LiveSession>({
    state,
    handle: undefined,
    port: undefined,
    terminalId: undefined,
    attaching: false,
    asked: [],
    release: undefined,
    unacked: 0,
    generation: 0,
  });

  // Note that the terminal is read and written through the registry,
  // because a connect under way reads it as it lands rather than as its
  // render saw it.
  const heldNow = useCallback(
    () => registry.get(localShellsHeld(agentId)).find((each) => each.shell === shellId),
    [registry, agentId, shellId],
  );
  const writeHeld = useCallback(
    (update: (held: HeldShell) => HeldShell) =>
      registry.set(
        localShellsHeld(agentId),
        registry
          .get(localShellsHeld(agentId))
          .map((each) => (each.shell === shellId ? update(each) : each)),
      ),
    [registry, agentId, shellId],
  );
  // A shell main no longer holds is forgotten, unless the terminal holds another by now.
  const forget = useCallback(
    (target: string) =>
      writeHeld((held) => (held.terminalId === target ? withoutShell(held) : held)),
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

  // A new shell in the agent's mirror, held beside the terminal, or why
  // main could not make the mirror or the shell. Note that a shell no
  // terminal will keep is let go as it lands, because nothing else would
  // end it: one whose tab closed while it opened, its connect let go too so
  // it answers nothing more, and one that lost to another open for the same
  // terminal, as a tab hidden and shown again asks, which answers the
  // shell that won.
  const open = useCallback(async (): Promise<Opened> => {
    const mirrored = await askAct(ACT_KIND.MAC_SHELL_MIRROR, { agentId }).catch(() => undefined);
    if (mirrored === undefined) return { why: TERMINAL_UNREACHED.MIRROR };
    const opened = await askAct(ACT_KIND.MAC_SHELL_OPEN, {
      agentId,
      folder: mirrored.folder,
    }).catch(() => undefined);
    if (opened === undefined) return { why: TERMINAL_UNREACHED.SHELL };
    const { terminalId } = opened;
    const held = heldNow();
    if (held === undefined || held.terminalId !== undefined) {
      tellAct(ACT_KIND.MAC_SHELL_CLOSE, { agentId, terminalId });
      return held?.terminalId === undefined
        ? { why: TERMINAL_UNREACHED.SHELL }
        : { terminalId: held.terminalId };
    }
    writeHeld((was) => ({ ...was, terminalId }));
    return { terminalId };
  }, [agentId, heldNow, writeHeld]);

  // Note that `connect` is read through a ref here, because a refused
  // attach opens a shell in its place, and `connect` is built over `attach`.
  const connectNow = useRef<() => Promise<void>>(async () => undefined);

  const attach = useCallback(
    (target: string, opened = false) => {
      const held = live.current;
      const size = held.handle?.size();
      if (size === undefined) return;
      held.terminalId = target;
      held.attaching = true;
      const asked: AttachAsked = { terminalId: target };
      held.asked.push(asked);
      // Note that the screen is cleared, because main draws all it holds of the shell again.
      held.handle?.reset();
      enter({ kind: TERMINAL_STATE.CONNECTING });
      // An attach main refused posts no port, so it is out of the line, and
      // its shell, which main no longer holds, forgotten; a new one is
      // opened in its place, unless it was just opened, which says so.
      void askAct(ACT_KIND.MAC_SHELL_ATTACH, { agentId, terminalId: target, ...size }).catch(() => {
        held.asked = held.asked.filter((each) => each !== asked);
        if (held.asked.length === 0) held.release?.();
        forget(target);
        if (held.terminalId !== target) return;
        held.terminalId = undefined;
        if (!held.attaching || held.asked.length > 0) return;
        if (opened) enter({ kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SHELL });
        else void connectNow.current();
      });
    },
    [agentId, enter, forget],
  );

  // Note that a terminal its tab no longer holds, as one closed, connects to nothing.
  const connect = useCallback(async () => {
    letGo();
    const generation = live.current.generation;
    const current = () => generation === live.current.generation;
    enter({ kind: TERMINAL_STATE.CONNECTING });
    const held = heldNow();
    if (held === undefined) return;
    if (held.terminalId !== undefined) return attach(held.terminalId);
    const made = await open();
    if (!current()) return;
    if ("why" in made) return enter({ kind: TERMINAL_STATE.UNREACHABLE, why: made.why });
    attach(made.terminalId, true);
  }, [attach, enter, heldNow, letGo, open]);
  useLayoutEffect(() => {
    connectNow.current = connect;
  });

  // Note that the screen takes the keyboard back as the bar's action
  // starts, because the button pressed goes with the bar.
  const onAction = useCallback(
    (_action: TerminalAction) => {
      live.current.handle?.focus();
      void connect();
    },
    [connect],
  );

  // The shell that ended let go, out of main and the terminal, and a new
  // one opened in its place, as a key asks.
  const replaceEnded = useCallback(() => {
    const held = live.current;
    const ended = held.terminalId;
    held.terminalId = undefined;
    if (ended !== undefined) {
      forget(ended);
      tellAct(ACT_KIND.MAC_SHELL_CLOSE, { agentId, terminalId: ended });
    }
    void connect();
  }, [agentId, connect, forget]);

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
        const answers = ticket.agentId === agentId && ticket.terminalId === first?.terminalId;
        if (!answers) return port.close();
        held.asked.shift();
        const newest = held.asked.length === 0 && ticket.terminalId === held.terminalId;
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
        const at = held.asked.findIndex((asked) => asked.terminalId === ticket.terminalId);
        if (ticket.agentId !== agentId || at < 0) return;
        port.close();
        held.asked.splice(at, 1);
        if (held.asked.length === 0) stop();
      });
      held.release = stop;
    };
  }, [agentId]);

  // Connected only while shown, and only once there is a screen to draw on.
  useEffect(() => {
    if (!shown || handle === undefined) return;
    handle.focus();
    void connect();
    return letGo;
  }, [shown, handle, connect, letGo]);

  return {
    state,
    failed: AsyncResult.isFailure(loaded),
    retryBundle,
    find: handle?.find,
    screen: setElement,
    onAction,
  };
}

/** The tab of one of the agent's terminals. */
function localTabOf(agentId: string, held: HeldShell): LocalStripTab {
  return { local: agentId, shell: held.shell, title: held.title };
}

/**
 * Opens a cloud agent's Local tab, handing the panel the keys (`onShown`).
 * A new terminal (`fresh`), as the Local rows of the panel's "+" and ⌘K
 * mean it, is minted in the window's list and its tab opened, which opens
 * its shell. Show local goes to the agent's Local tab viewed last; where
 * none is open, as after a reload, it opens the tab of each terminal the
 * window still holds, the newest shown, and where it holds none, a new one.
 */
export function useOpenLocal(
  sidePanel: Pick<SidePanelControl, "onChoose" | "locals" | "viewedAt">,
  onShown: () => void,
): (agentId: string, fresh: boolean) => void {
  const registry = useContext(RegistryContext);
  const { onChoose, locals, viewedAt } = sidePanel;
  return useCallback(
    (agentId, fresh) => {
      const held = registry.get(localShellsHeld(agentId));
      const open = locals.filter((tab) => tab.local === agentId);
      if (fresh || held.length === 0) {
        const made: HeldShell = { shell: crypto.randomUUID(), title: nextShellTitle(held) };
        registry.set(localShellsHeld(agentId), [...held, made]);
        onChoose(localTabOf(agentId, made));
      } else if (open.length > 0) {
        const at = (tab: LocalStripTab) =>
          viewedAt.find((each) => sameTab(each.tab, tab))?.at ?? Number.NEGATIVE_INFINITY;
        onChoose(open.reduce((latest, tab) => (at(tab) > at(latest) ? tab : latest)));
      } else {
        for (const each of held) onChoose(localTabOf(agentId, each));
      }
      onShown();
    },
    [registry, onChoose, locals, viewedAt, onShown],
  );
}

/**
 * Ends a Local tab's terminal as its tab closes: out of the window's list,
 * and its shell, where one opened, ended in main, which nothing brings back.
 */
export function useEndLocal(): (tab: LocalStripTab) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (tab) => {
      const shells = registry.get(localShellsHeld(tab.local));
      const ended = shells.find((each) => each.shell === tab.shell);
      registry.set(
        localShellsHeld(tab.local),
        shells.filter((each) => each.shell !== tab.shell),
      );
      if (ended?.terminalId === undefined) return;
      tellAct(ACT_KIND.MAC_SHELL_CLOSE, { agentId: tab.local, terminalId: ended.terminalId });
    },
    [registry],
  );
}
