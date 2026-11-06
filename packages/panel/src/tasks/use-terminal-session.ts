import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TERMINAL_CONNECTION,
  TERMINAL_REFUSAL,
  type TerminalConnection,
  type TerminalRefusal,
} from "@repo/features/terminal-acts";
import {
  TERMINAL_STATE,
  TERMINAL_UNREACHED,
  type TerminalState,
} from "@repo/features/terminal-model";
import { sandboxRead, shellShown, shellsAsked } from "@repo/features/terminal-store";
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
import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ActResult, askAct, sendAct } from "../act.js";
import { usePendingNow } from "../pending-clock.js";
import type { RenameShape } from "../rename-write.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { terminalListQueryOptions } from "./agent-reads.js";
import {
  endTerminalSessions,
  SERVICE_UNREACHED,
  type ShellLink,
  type ShellOpened,
  TERMINAL_KIND,
  TerminalSession,
  terminalSession,
} from "./terminal-session.js";
import { type TerminalView, useTerminalView } from "./use-terminal-view.js";

/**
 * use-terminal-session.ts -- one agent's Terminal tab: its sandbox's shells found, each one a terminal of its own kept for the tab's life, the one shown chosen, started, named, and ended.
 *
 * Shown, the tab lists the agent's shells (`terminal.list`), which never
 * wakes a stopped sandbox, and shows the one it showed before, else the
 * oldest, else a new one (`terminal.create`). Each shell shown is a terminal
 * of its own (`terminal-session.ts`): its screen and its attach stand until
 * the tab closes, so a tab hidden, or another shell chosen, leaves each
 * shell's screen as it was; tmux redraws a shell only for a window that
 * reloaded. While the tab shows no shell, its screen is the find's own, so
 * a stopped sandbox's bar takes Return there as it does over a shell.
 *
 * What each state asks of the developer is what a terminal asks: after a
 * disconnect any key reconnects, a shell that ended takes any key
 * for a new one, and the bar's action (its click, or Return) retries a
 * dropped connection or resumes a stopped sandbox, which nothing but that
 * resumes. While the agent has not opened its sandbox the tab lists again
 * every few seconds, and once a shell's port is open the host waits on the
 * sandbox itself.
 */

/** How often a tab waiting on an agent that has not opened its sandbox lists again, and a shown tab reads its shells again. */
const STARTING_RELIST = Duration.seconds(5);
const SHELLS_REREAD = Duration.seconds(5);

/** What a toast says when a shell could not be started or ended; a refused name is said by its row. */
const SHELL_FAILED = {
  CREATE: "Could not start a shell.",
  KILL: "Could not end that shell.",
} as const;

/** No shell's name given here and waiting on the list. */
const NO_PENDING_TITLES: PendingValues<string, string> = new Map();

/** Whether two shells' names are one. */
const sameTitle: SameValue<string> = (a, b) => a === b;

/** A shell's name as the list read it; none where the list holds no such shell. */
function shellTitle(listed: TerminalsAnswer | undefined, shell: string): string | undefined {
  return listed?.terminals.find((each) => each.id === shell)?.title;
}

/** The list with each name given here that it does not yet carry drawn in its shell's place. */
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

/** The states of a shown shell a new shell asked for starts beside at once: one that runs, or one closed or ended, which a key would leave anyway. */
const STARTS_ASKED: ReadonlySet<TerminalState["kind"]> = new Set([
  TERMINAL_STATE.ATTACHED,
  TERMINAL_STATE.IDLE,
  TERMINAL_STATE.EXITED,
]);

/** The states the host says that change the agent's shells. */
const LIST_CHANGES: ReadonlySet<TerminalState["kind"]> = new Set([
  TERMINAL_STATE.STOPPED,
  TERMINAL_STATE.STARTING,
  TERMINAL_STATE.EXITED,
]);

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

/**
 * Where a refusal leaves the tab: a stopped sandbox's bar, the wait for an
 * agent that has not opened its sandbox, or the bar that asks again for a
 * shell or agent not found, a sandbox that did not answer, or one whose
 * saved files are gone, saying which; nothing for an agent archived or retired, whose tab closes, as its
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
    case TERMINAL_REFUSAL.SANDBOX_SNAPSHOT_GONE:
      return { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SNAPSHOT_GONE };
    case TERMINAL_REFUSAL.GONE:
      return undefined;
  }
}

/** A Terminal tab's session: where it stands, where its screen is shown, the bar's action, and the agent's shells. */
export interface TerminalTabSession extends TerminalView {
  /** The agent's shells and where its sandbox stands, as last read, or nothing before the first read. */
  readonly listed: TerminalsAnswer | undefined;
  /** The shell the screen shows, or nothing before one is found. */
  readonly shell: string | undefined;
  /** Shows another of the agent's shells on the screen. */
  readonly onChoose: (shell: string) => void;
  /** Starts a shell in the same agent's sandbox and shows it. */
  readonly onCreate: () => void;
  /** How the list renames a shell, a mutation of its own over these options, drawn at once and put back where refused. */
  readonly rename: RenameShape<TerminalRenameAnswer, TerminalRenameAsk> & {
    readonly options: ReturnType<typeof terminalRenameMutation<PendingValue<string>>>;
  };
  /** Ends a shell, answering whether it ended; the one shown gives way to the oldest left, or a new one. */
  readonly kill: ReturnType<typeof terminalKillMutation>;
}

/** The key the tab's find holds its screen under, beside its shells' ids, which are never empty. */
const FINDING = "";

/** What runs once a wait has passed. Note that it is wrapped, because an atom's setter calls a bare function as an update. */
interface AfterWait {
  readonly run: () => void;
}

/** A wait, as an atom whose call runs what it is handed once it has passed, a later call standing in for one still waiting. */
const waitAtom = (wait: Duration.Duration) =>
  rendererRuntime.fn((after: AfterWait) =>
    Effect.sleep(wait).pipe(Effect.andThen(Effect.sync(after.run))),
  );

/** One of the agent's shells let go: its terminal ended here, and the tab's choice of it with it; the shell itself runs on where it still does. */
function letShellGo(registry: AtomRegistry.AtomRegistry, agentId: string, shell: string): void {
  endTerminalSessions(registry, TERMINAL_KIND.CLOUD, agentId, [shell]);
  if (registry.get(shellShown(agentId)) === shell) registry.set(shellShown(agentId), undefined);
}

/**
 * How a shell in the agent's sandbox is reached: attached through the
 * service's relay, and, where it ended or went, let go so the tab finds
 * another or starts one. `onGone` closes the tab, as for an agent archived.
 */
function cloudLink(
  registry: AtomRegistry.AtomRegistry,
  agentId: string,
  shell: string,
  onGone: () => void,
): ShellLink {
  return {
    agentId,
    attach: (terminalId, size) =>
      askAct(ACT_KIND.TERMINAL_ATTACH, { agentId, terminalId, ...size }).then(
        () => ({ asked: true }),
        () => ({ state: SERVICE_UNREACHED }),
      ),
    stateOf,
    ended: () => letShellGo(registry, agentId, shell),
    resume: async () => {
      const resumed = await askAct(ACT_KIND.TERMINAL_RESUME, { agentId });
      if (!("refused" in resumed)) return undefined;
      const next = refusedState(resumed.refused);
      if (next === undefined) onGone();
      return next ?? { kind: TERMINAL_STATE.CONNECTING };
    },
  };
}

/** Ends every terminal of an agent's Terminal tab, as the tab closes; the shells run on in the sandbox. */
export function useEndTerminal(): (agentId: string) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (agentId) => {
      endTerminalSessions(registry, TERMINAL_KIND.CLOUD, agentId);
      registry.set(shellShown(agentId), undefined);
    },
    [registry],
  );
}

/**
 * A shell ended, as the question asking it holds its own mutation over it,
 * run through `run`: answering whether it ended, the one shown giving way to
 * the oldest left, or a new one.
 */
function terminalKillMutation(run: (shell: string) => Promise<ActionResult>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TERMINAL_KILL], mutationFn: run });
}

/** A shell's rename as a mutation asks it: the shell, and its new title. */
interface TerminalRenameAsk {
  readonly terminalId: string;
  readonly title: string;
}

/** What a shell's rename answers: the list as it now stands, or that it was refused. */
type TerminalRenameAnswer = ActResult<typeof ACT_KIND.TERMINAL_RENAME>;

/**
 * A shell's rename as the list's row holds it, a mutation of its own: the
 * session draws the name at once (`ask`, whose pending title it answers),
 * and puts it back or writes the list once answered (`settle`).
 */
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
  /** Closes the tab, once the service says the agent was archived or retired. */
  onGone: () => void,
): TerminalTabSession {
  const registry = useContext(RegistryContext);
  const queryClient = useQueryClient();
  const [relistAtom] = useState(() => waitAtom(STARTING_RELIST));
  const [rereadAtom] = useState(() => waitAtom(SHELLS_REREAD));
  const relistLater = useAtomSet(relistAtom);
  const rereadLater = useAtomSet(rereadAtom);
  const listed = useAtomValue(sandboxRead(agentId));
  const setListed = useAtomSet(sandboxRead(agentId));
  const asked = useAtomValue(shellsAsked(agentId));
  const setAsked = useAtomSet(shellsAsked(agentId));
  const shell = useAtomValue(shellShown(agentId));
  const setShell = useAtomSet(shellShown(agentId));
  // Note that the ask is read through a ref too, because a find under way reads it as it lands.
  const askedNow = useRef(asked);
  // Note that the close is read through a ref, because the tab hands a new one each render, and a shell's terminal outlives it.
  const gone = useRef(onGone);
  useLayoutEffect(() => {
    askedNow.current = asked;
    gone.current = onGone;
  });
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

  // The shell the tab shows found: the oldest, or a new one where none
  // runs or one was asked for. An agent that has not opened its sandbox is
  // listed again a while on while the tab still shows no shell, and one
  // gone closes its tab.
  const find = useCallback(
    async (again: () => void): Promise<ShellOpened> => {
      const wait = (next: TerminalState | undefined): ShellOpened => {
        if (next === undefined) {
          gone.current();
          return { state: { kind: TERMINAL_STATE.CONNECTING } };
        }
        if (next.kind === TERMINAL_STATE.STARTING) {
          relistLater({
            run: () => {
              if (registry.get(shellShown(agentId)) === undefined) again();
            },
          });
        }
        return { state: next };
      };
      // Note that a reread still out may predate what made the tab look, a shell ending among them, so it gives way to a read of its own.
      const listing = terminalListQueryOptions(agentId);
      await queryClient.cancelQueries({ queryKey: listing.queryKey });
      const answer = await queryClient.fetchQuery(listing);
      if ("refused" in answer) return wait(refusedState(answer.refused));
      setListed(answer);
      if (answer.sandbox === SANDBOX_STATE.STOPPED) return wait({ kind: TERMINAL_STATE.STOPPED });
      if (answer.sandbox === SANDBOX_STATE.STARTING) return wait({ kind: TERMINAL_STATE.STARTING });
      // A new shell asked for is started in place of the oldest.
      const fresh = askedNow.current > 0;
      if (fresh) setAsked((was) => Math.max(0, was - 1));
      const [oldest] = answer.terminals;
      if (oldest !== undefined && !fresh) {
        setShell(oldest.id);
        return { state: { kind: TERMINAL_STATE.CONNECTING } };
      }
      const made = await askAct(ACT_KIND.TERMINAL_CREATE, { agentId });
      if ("refused" in made) return wait(refusedState(made.refused));
      setListed({ ...answer, terminals: [...answer.terminals, made.terminal] });
      setShell(made.terminal.id);
      return { state: { kind: TERMINAL_STATE.CONNECTING } };
    },
    [queryClient, agentId, registry, relistLater, setAsked, setListed, setShell],
  );
  // Note that the find is read through a ref, because the terminal that runs it outlives the tab drawn.
  const findNow = useRef(find);
  useLayoutEffect(() => {
    findNow.current = find;
  });
  // While the tab shows no shell, its screen is the find's: the shell sought, a stopped sandbox resumed.
  const finding = useMemo(
    () =>
      terminalSession(registry, TERMINAL_KIND.CLOUD, agentId, FINDING, () => {
        const session: TerminalSession = new TerminalSession(
          {
            ...cloudLink(registry, agentId, FINDING, () => gone.current()),
            open: () => findNow.current(() => session.replace()),
          },
          undefined,
        );
        return session;
      }),
    [registry, agentId],
  );
  const shellSession = useMemo(
    () =>
      shell === undefined
        ? undefined
        : terminalSession(
            registry,
            TERMINAL_KIND.CLOUD,
            agentId,
            shell,
            () =>
              new TerminalSession(
                cloudLink(registry, agentId, shell, () => gone.current()),
                shell,
              ),
          ),
    [registry, agentId, shell],
  );
  const session = shellSession ?? finding;
  const view = useTerminalView(session, shown);
  const { state } = view;
  // Counts each change of the list the tab makes or asks for, so a read that went out before one lands nowhere rather than undoing it.
  const listMoves = useRef(0);

  // The list as an answer says it, every read since let go.
  const writeList = useCallback(
    (answer: TerminalsAnswer) => {
      listMoves.current += 1;
      setListed(answer);
    },
    [setListed],
  );

  // The shells read again without touching any terminal; a read that
  // fails or is refused leaves the last one standing, and one overtaken by
  // a change the tab made since is let go.
  const reread = useCallback(async () => {
    const seen = listMoves.current;
    try {
      const answer = await queryClient.fetchQuery(terminalListQueryOptions(agentId));
      if (!("refused" in answer) && listMoves.current === seen) writeList(answer);
    } catch {
      // The next read, a few seconds on, asks again.
    }
  }, [queryClient, agentId, writeList]);

  // Another shell shown, its own terminal kept as it was. The screen takes the keyboard from the row pressed, the shell's to type into.
  const onChoose = useCallback(
    (next: string) => {
      setShell(next);
      session.screen?.focus();
    },
    [setShell, session],
  );

  const onCreate = useCallback(async () => {
    try {
      const made = await askAct(ACT_KIND.TERMINAL_CREATE, { agentId });
      if ("refused" in made) {
        if (refusedState(made.refused) === undefined) return gone.current();
        return failedToast(SHELL_FAILED.CREATE, made.refused);
      }
      onChoose(made.terminal.id);
      await reread();
    } catch (cause) {
      failedToast(SHELL_FAILED.CREATE, cause);
    }
  }, [agentId, failedToast, onChoose, reread]);

  // A name given here stands over the list until a read carries it, or a third name, or its time
  // runs out (`@repo/ui/pending-values`), and goes at once where the rename is refused.
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
  // A name asked is drawn at once, over the list, until its answer: put back where refused, the list it answers written where kept.
  const rename = {
    options: terminalRenameMutation(agentId, {
      ask: ({ terminalId, title }) => {
        listMoves.current += 1;
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

  // A shell ended, and its terminal here with it, which leaves the tab to
  // find the oldest left, or start one, where it was the one shown.
  const kill = terminalKillMutation(async (target) => {
    listMoves.current += 1;
    try {
      const answer = await sendAct(ACT_KIND.TERMINAL_KILL, { agentId, terminalId: target });
      if ("refused" in answer) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: SHELL_FAILED.KILL };
      }
      writeList(answer);
      letShellGo(registry, agentId, target);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    } catch {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: SHELL_FAILED.KILL };
    }
  });

  // The tab finds a shell again whenever it is shown showing none, as once the one it showed ended or went; its first find runs once its screen first has room.
  useEffect(() => {
    if (shown && shell === undefined) finding.replace();
  }, [shown, shell, finding]);

  // A sandbox that stopped or a shell that ended changes the list, which is read again.
  useEffect(() => {
    if (shellSession !== undefined && LIST_CHANGES.has(state.kind)) void reread();
  }, [shellSession, state.kind, reread]);

  // A new shell asked for while a shell is shown starts at once, each ask
  // its own shell; one asked for while the tab finds one is started by the
  // find, once the sandbox runs, which a stopped one waits on Resume for.
  useEffect(() => {
    if (!shown || asked === 0 || shellSession === undefined || !STARTS_ASKED.has(state.kind)) {
      return;
    }
    setAsked((was) => Math.max(0, was - 1));
    void onCreate();
  }, [shown, asked, shellSession, state.kind, setAsked, onCreate]);

  // While shown, the shells are read again every few seconds and whenever
  // the window takes the keyboard back, so a shell started or ended
  // elsewhere, or a command started in one, shows in the list.
  useEffect(() => {
    if (!shown) return;
    let showing = true;
    const again = () =>
      rereadLater({
        run: () => {
          if (!showing) return;
          void reread();
          again();
        },
      });
    again();
    const onFocus = () => void reread();
    window.addEventListener("focus", onFocus);
    return () => {
      showing = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [shown, reread, rereadLater]);

  return {
    ...view,
    listed: named,
    shell,
    onChoose,
    onCreate: () => void onCreate(),
    rename,
    kill,
  };
}
