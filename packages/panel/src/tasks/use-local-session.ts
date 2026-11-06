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

const RESIZE_SETTLES = Duration.millis(100);

const SHELL_FAILED = {
  CREATE: "Could not start a shell.",
  KILL: "Could not end that shell.",
} as const;

const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

const RETURN = "\r";

const NOTE_INK = "\x1b[38;5;245m";
const RESET = "\x1b[0m";

const HIDE_CURSOR = "\x1b[?25l";

function inputMessages(data: string): TerminalPortInbound[] {
  const messages: TerminalPortInbound[] = [];
  let at = 0;
  while (at < data.length) {
    let end = Math.min(at + TERMINAL_FLOW.MAX_INPUT_CHARS, data.length);
    if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1))) end -= 1;
    messages.push({ type: TERMINAL_PORT_MESSAGE.INPUT, data: data.slice(at, end) });
    at = end;
  }
  return messages;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

interface AttachAsked {
  readonly shell: string;
}

type Opened =
  | { readonly terminalId: string }
  | { readonly why: (typeof TERMINAL_UNREACHED)[keyof typeof TERMINAL_UNREACHED] };

interface LiveSession {
  state: TerminalState;
  handle: TerminalHandle | undefined;
  port: MessagePort | undefined;
  shell: string | undefined;
  attaching: boolean;
  asked: AttachAsked[];
  release: (() => void) | undefined;
  unacked: number;
  generation: number;
}

export interface LocalSession {
  readonly state: TerminalState;
  readonly failed: boolean;
  readonly retryBundle: () => void;
  readonly find: TerminalFind | undefined;
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
  readonly listed: readonly HeldShell[];
  readonly shell: string | undefined;
  readonly onChoose: (shell: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (shell: string, title: string) => void;
  readonly onKill: (shell: string) => Promise<ActionResult>;
}

interface AfterWait {
  readonly run: () => void;
}

const waitAtom = (wait: Duration.Duration) =>
  rendererRuntime.fn((after: AfterWait) =>
    Effect.sleep(wait).pipe(Effect.andThen(Effect.sync(after.run))),
  );

export function useLocalSession(agentId: string, shown: boolean): LocalSession {
  const { act } = useAct();
  const registry = useContext(RegistryContext);
  const openLink = useOpenLink();
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
      enter({ kind: TERMINAL_STATE.CONNECTING });
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

  const onChoose = useCallback(
    (next: string) => {
      const held = live.current;
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

  const onRename = useCallback(
    (target: string, title: string) =>
      writeHeld((shells) =>
        shells.map((each) => (each.terminalId === target ? { ...each, title } : each)),
      ),
    [writeHeld],
  );

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

  const onAction = useCallback(
    (_action: TerminalAction) => {
      live.current.handle?.focus();
      void connect();
    },
    [connect],
  );

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
          return;
      }
    },
    [onAction, replaceEnded],
  );

  const onPortMessage = useCallback(
    (message: TerminalPortOutbound) => {
      const held = live.current;
      if (message.type === TERMINAL_PORT_MESSAGE.OUTPUT) {
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

  const typed = useRef(onInput);
  const linked = useRef(openLink);
  useLayoutEffect(() => {
    typed.current = onInput;
    linked.current = openLink;
  });

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

  useEffect(() => {
    const held = live.current;
    return () => {
      if (held.asked.length === 0) return;
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

  useEffect(() => {
    if (!shown || handle === undefined) return;
    handle.focus();
    const replacing =
      live.current.state.kind === TERMINAL_STATE.EXITED &&
      registry.get(localShellsAsked(agentId)) > 0;
    if (!replacing) void connect();
    return letGo;
  }, [shown, handle, agentId, connect, letGo, registry]);

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
