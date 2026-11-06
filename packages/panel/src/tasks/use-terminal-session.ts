import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
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
} from "@repo/features/terminal-acts";
import {
  TERMINAL_ACTION,
  TERMINAL_STATE,
  TERMINAL_UNREACHED,
  type TerminalAction,
  type TerminalState,
  terminalLook,
} from "@repo/features/terminal-model";
import { sandboxRead, shellsAsked } from "@repo/features/terminal-store";
import { SANDBOX_STATE, type TerminalsAnswer } from "@repo/features/terminal-wire";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import {
  type PendingValue,
  type PendingValues,
  pendingSettled,
  pendingShown,
  pendingValue,
  pendingWithout,
  type SameValue,
} from "@repo/ui/pending-values";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type ActResult, sendAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { useSideBundles } from "../bundle-loader.js";
import { usePendingNow } from "../pending-clock.js";
import type { RenameShape } from "../rename-write.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TerminalFind, TerminalHandle } from "../terminal/contract.js";
import { onTerminalPort } from "../terminal/terminal-port.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { terminalListQueryOptions } from "./agent-reads.js";
import { useOpenLink } from "./use-open-link.js";

const RESIZE_SETTLES = Duration.millis(100);

const STARTING_RELIST = Duration.seconds(5);
const SHELLS_REREAD = Duration.seconds(5);

const SHELL_FAILED = {
  CREATE: "Could not start a shell.",
  KILL: "Could not end that shell.",
} as const;

const NO_PENDING_TITLES: PendingValues<string, string> = new Map();

const sameTitle: SameValue<string> = (a, b) => a === b;

function shellTitle(listed: TerminalsAnswer | undefined, shell: string): string | undefined {
  return listed?.terminals.find((each) => each.id === shell)?.title;
}

function withTitles(
  listed: TerminalsAnswer | undefined,
  titles: PendingValues<string, string>,
): TerminalsAnswer | undefined {
  if (listed === undefined || titles.size === 0) return listed;
  const shown = pendingShown(
    pendingSettled(titles, (shell) => shellTitle(listed, shell), sameTitle, undefined),
  );
  if (shown.size === 0) return listed;
  return {
    ...listed,
    terminals: listed.terminals.map((each) => {
      const title = shown.get(each.id);
      return title === undefined ? each : { ...each, title };
    }),
  };
}

const LIST_CHANGES: ReadonlySet<TerminalState["kind"]> = new Set([
  TERMINAL_STATE.STOPPED,
  TERMINAL_STATE.STARTING,
  TERMINAL_STATE.EXITED,
]);

const readOutbound = Schema.decodeUnknownOption(terminalPortOutboundSchema);

const RETURN = "\r";

const NOTE_INK = "\x1b[38;5;245m";
const RESET = "\x1b[0m";

const HIDE_CURSOR = "\x1b[?25l";

const SERVICE_UNREACHED: TerminalState = {
  kind: TERMINAL_STATE.UNREACHABLE,
  why: TERMINAL_UNREACHED.SERVICE,
};

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
    case TERMINAL_REFUSAL.SANDBOX_SNAPSHOT_GONE:
      return { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SNAPSHOT_GONE };
    case TERMINAL_REFUSAL.GONE:
      return undefined;
  }
}

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
  showing: boolean;
  listMoves: number;
}

export interface TerminalSession {
  readonly state: TerminalState;
  readonly failed: boolean;
  readonly retryBundle: () => void;
  readonly find: TerminalFind | undefined;
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
  readonly listed: TerminalsAnswer | undefined;
  readonly shell: string | undefined;
  readonly onChoose: (shell: string) => void;
  readonly onCreate: () => void;
  readonly rename: RenameShape<TerminalRenameAnswer, TerminalRenameAsk> & {
    readonly options: ReturnType<typeof terminalRenameMutation<PendingValue<string>>>;
  };
  readonly kill: ReturnType<typeof terminalKillMutation>;
}

interface AfterWait {
  readonly run: () => void;
}

const waitAtom = (wait: Duration.Duration) =>
  rendererRuntime.fn((after: AfterWait) =>
    Effect.sleep(wait).pipe(Effect.andThen(Effect.sync(after.run))),
  );

function terminalKillMutation(run: (shell: string) => Promise<ActionResult>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TERMINAL_KILL], mutationFn: run });
}

interface TerminalRenameAsk {
  readonly terminalId: string;
  readonly title: string;
}

type TerminalRenameAnswer = ActResult<typeof ACT_KIND.TERMINAL_RENAME>;

function terminalRenameMutation<Pending>(
  agentId: string,
  drawn: {
    readonly ask: (asked: TerminalRenameAsk) => Pending;
    readonly settle: (
      answer: TerminalRenameAnswer | undefined,
      asked: TerminalRenameAsk,
      pending: Pending,
    ) => void;
  },
) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TERMINAL_RENAME],
    mutationFn: ({ terminalId, title }: TerminalRenameAsk) =>
      sendAct(ACT_KIND.TERMINAL_RENAME, { agentId, terminalId, title }),
    onMutate: (asked) => drawn.ask(asked),
    onSettled: (answer, _error, asked, pending) => {
      if (pending !== undefined) drawn.settle(answer, asked, pending);
    },
  });
}

export function useTerminalSession(
  agentId: string,
  shown: boolean,
  onGone: () => void,
): TerminalSession {
  const queryClient = useQueryClient();
  const { mutateAsync: sendAttach } = useMutation(actMutation(ACT_KIND.TERMINAL_ATTACH));
  const { mutateAsync: sendCreate } = useMutation(actMutation(ACT_KIND.TERMINAL_CREATE));
  const { mutateAsync: sendResume } = useMutation(actMutation(ACT_KIND.TERMINAL_RESUME));
  const { mutate: sendDetach } = useMutation(actMutation(ACT_KIND.TERMINAL_DETACH));
  const openLink = useOpenLink();
  const { terminal } = useSideBundles();
  const loaded = useAtomValue(terminal);
  const retryBundle = useAtomRefresh(terminal);
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
  const askedNow = useRef(asked);
  useLayoutEffect(() => {
    askedNow.current = asked;
  });
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
      void sendAttach({ agentId, terminalId: shell, ...size }).catch(() => {
        held.asked = held.asked.filter((each) => each !== asked);
        if (held.asked.length === 0) held.release?.();
        if (held.attaching && held.asked.length === 0) enter(SERVICE_UNREACHED);
      });
    },
    [sendAttach, agentId, enter],
  );

  const connect = useCallback(async () => {
    letGo();
    const generation = live.current.generation;
    const current = () => generation === live.current.generation;
    enter({ kind: TERMINAL_STATE.CONNECTING });
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
      const listing = terminalListQueryOptions(agentId);
      await queryClient.cancelQueries({ queryKey: listing.queryKey });
      const listed = await queryClient.fetchQuery(listing);
      if (!current()) return;
      if ("refused" in listed) return wait(refusedState(listed.refused));
      setListed(listed);
      if (listed.sandbox === SANDBOX_STATE.STOPPED) return wait({ kind: TERMINAL_STATE.STOPPED });
      if (listed.sandbox === SANDBOX_STATE.STARTING) return wait({ kind: TERMINAL_STATE.STARTING });
      const fresh = askedNow.current > 0;
      if (fresh) setAsked((was) => Math.max(0, was - 1));
      const held = listed.terminals.find((each) => each.id === live.current.shell);
      const oldest = held ?? listed.terminals[0];
      if (oldest !== undefined && !fresh) return attach(oldest.id);
      const made = await sendCreate({ agentId });
      if (!current()) return;
      if ("refused" in made) return wait(refusedState(made.refused));
      setListed({ ...listed, terminals: [...listed.terminals, made.terminal] });
      attach(made.terminal.id);
    } catch {
      if (current()) enter(SERVICE_UNREACHED);
    }
  }, [queryClient, sendCreate, agentId, attach, enter, letGo, relistLater, setAsked, setListed]);

  const writeList = useCallback(
    (answer: TerminalsAnswer) => {
      live.current.listMoves += 1;
      setListed(answer);
    },
    [setListed],
  );

  const reread = useCallback(async () => {
    const seen = live.current.listMoves;
    try {
      const answer = await queryClient.fetchQuery(terminalListQueryOptions(agentId));
      if (!("refused" in answer) && live.current.listMoves === seen) writeList(answer);
    } catch {}
  }, [queryClient, agentId, writeList]);

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
    try {
      const made = await sendCreate({ agentId });
      if ("refused" in made) {
        const next = refusedState(made.refused);
        return next === undefined ? gone.current() : enter(next);
      }
      onChoose(made.terminal.id);
      await reread();
    } catch (cause) {
      failedToast(SHELL_FAILED.CREATE, cause);
    }
  }, [sendCreate, agentId, enter, failedToast, onChoose, reread]);

  const [titles, setTitles] = useState(NO_PENDING_TITLES);
  const titlesNow = usePendingNow(titles.size > 0);
  useEffect(
    () =>
      setTitles((was) =>
        pendingSettled(was, (shell) => shellTitle(listed, shell), sameTitle, titlesNow),
      ),
    [listed, titlesNow],
  );
  const named = useMemo(() => withTitles(listed, titles), [listed, titles]);
  const rename = {
    options: terminalRenameMutation(agentId, {
      ask: ({ terminalId, title }) => {
        live.current.listMoves += 1;
        const asked = pendingValue(
          titles.get(terminalId),
          title,
          shellTitle(listed, terminalId),
          sameTitle,
        );
        setTitles((was) => new Map(was).set(terminalId, asked));
        return asked;
      },
      settle: (answer, { terminalId }, asked) => {
        if (answer === undefined || "refused" in answer) {
          setTitles((was) => pendingWithout(was, terminalId, asked));
          return;
        }
        writeList(answer);
      },
    }),
    ask: (terminalId: string, title: string) => ({ terminalId, title }),
    asked: ({ terminalId, title }: TerminalRenameAsk) => ({ subjectId: terminalId, name: title }),
    refused: (answer: TerminalRenameAnswer) => "refused" in answer,
  };

  const kill = terminalKillMutation(async (target) => {
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
      const answer = await sendAct(ACT_KIND.TERMINAL_KILL, { agentId, terminalId: target });
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
  });

  const resume = useCallback(async () => {
    const generation = live.current.generation;
    enter({ kind: TERMINAL_STATE.RESUMING, since: Date.now() });
    try {
      const resumed = await sendResume({ agentId });
      if (generation !== live.current.generation) return;
      if ("refused" in resumed) {
        const next = refusedState(resumed.refused);
        return next === undefined ? gone.current() : enter(next);
      }
      await connect();
    } catch {
      if (generation === live.current.generation) enter(SERVICE_UNREACHED);
    }
  }, [sendResume, agentId, connect, enter]);

  const onAction = useCallback(
    (action: TerminalAction) => {
      live.current.handle?.focus();
      if (action === TERMINAL_ACTION.RESUME) return void resume();
      const { shell } = live.current;
      if (live.current.state.kind === TERMINAL_STATE.RECONNECTING && shell !== undefined) {
        attach(shell);
      } else {
        void connect();
      }
    },
    [attach, connect, resume],
  );

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
        held.shell = undefined;
        void connect();
        return;
      }
      enter(next);
      if (LIST_CHANGES.has(next.kind)) void reread();
    },
    [connect, enter, reread],
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
      for (const shell of new Set(held.asked.map((asked) => asked.shell))) {
        sendDetach({ agentId, terminalId: shell });
      }
      const stop = onTerminalPort((ticket, port) => {
        const at = held.asked.findIndex((asked) => asked.shell === ticket.terminalId);
        if (ticket.agentId !== agentId || at < 0) return;
        port.close();
        held.asked.splice(at, 1);
        if (held.asked.length === 0) stop();
      });
      held.release = stop;
    };
  }, [sendDetach, agentId]);

  useEffect(() => {
    if (!shown || handle === undefined) return;
    handle.focus();
    void connect();
    return letGo;
  }, [shown, handle, connect, letGo]);

  useEffect(() => {
    if (!shown || asked === 0) return;
    if (state.kind === TERMINAL_STATE.ATTACHED && live.current.port !== undefined) {
      setAsked((was) => Math.max(0, was - 1));
      void onCreate();
      return;
    }
    if (state.kind === TERMINAL_STATE.IDLE || state.kind === TERMINAL_STATE.EXITED) void connect();
  }, [shown, asked, state.kind, setAsked, onCreate, connect]);

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
    retryBundle,
    find: handle?.find,
    screen: setElement,
    onAction,
    listed: named,
    shell,
    onChoose,
    onCreate: () => void onCreate(),
    rename,
    kill,
  };
}
