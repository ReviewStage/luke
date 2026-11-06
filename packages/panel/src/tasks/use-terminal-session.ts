import { useAtomSet } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
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
import { ACT_KIND } from "@repo/host/acts";
import {
  type LocalStripTab,
  localTab,
  STRIP_TAB_KIND,
  sameTab,
  type TerminalStripTab,
  terminalTab,
} from "@repo/ui/tab-strip-model";
import { absurd, Duration, Effect } from "effect";
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
import { askAct, tellAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { type HeldShell, nextShellTitle, terminalsHeld } from "./terminal-held.js";
import {
  endTerminalSessions,
  SERVICE_UNREACHED,
  type ShellLink,
  TERMINAL_KIND,
  type TerminalKind,
  TerminalSession,
  terminalSession,
} from "./terminal-session.js";
import type { SidePanelControl } from "./use-side-panel.js";
import { type TerminalView, useTerminalView } from "./use-terminal-view.js";

/**
 * use-terminal-session.ts -- one terminal tab's shell, in its agent's cloud sandbox or on this Mac in the agent's mirror: opened at the screen's first size and attached for the tab's life; and the doors that open such a tab and end its shell as it closes.
 *
 * Each terminal is a tab of its own, minted in the window's list
 * (`terminal-held.ts`) as its tab opens, and a session of its own
 * (`terminal-session.ts`). Once the screen first has room, the session opens
 * its shell. A cloud tab starts a shell in the agent's sandbox
 * (`terminal.create`), which runs on in tmux, so a tab opened again after a
 * reload attaches to it; a Local tab finds or makes the agent's mirror
 * (`macShell.mirror`) and opens a shell there (`macShell.open`), which ends
 * with the page. Closing the tab ends its shell, wherever it runs.
 *
 * A shell that ended takes any key for a new one in the same tab. The bar's
 * action (its click, or Return) asks again for what could not be reached,
 * or resumes a stopped sandbox, which nothing but that resumes. While the
 * agent has not opened its sandbox, a shown cloud tab asks again every few
 * seconds.
 */

/** How often a shown cloud tab waiting on an agent that has not opened its sandbox asks again. */
const STARTING_RETRY = Duration.seconds(5);

/** A cloud state from the host's word for it. */
function cloudStateOf(
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
 * Where a refusal leaves a cloud tab: a stopped sandbox's bar, the wait for
 * an agent that has not opened its sandbox, or the bar that asks again for a
 * shell or agent not found, a sandbox that did not answer, or one whose
 * saved files are gone, saying which; nothing for an agent archived or
 * retired, whose tab closes, as its Changes tab does.
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

/** A cloud tab's state for a refusal, closing the tab where the agent is gone. */
function refusedOrGone(refused: TerminalRefusal, onGone: () => void): TerminalState {
  const next = refusedState(refused);
  if (next === undefined) onGone();
  return next ?? { kind: TERMINAL_STATE.CONNECTING };
}

/** The shell's id written onto its terminal in the window's list, so a reload attaches to it again. */
function holdShellId(
  registry: AtomRegistry.AtomRegistry,
  agentId: string,
  shell: string,
  terminal: string,
): void {
  const held = terminalsHeld[TERMINAL_KIND.CLOUD](agentId);
  registry.set(
    held,
    registry.get(held).map((each) => (each.shell === shell ? { ...each, terminal } : each)),
  );
}

/**
 * How a cloud tab reaches its shell: started in the agent's sandbox and
 * attached through the service's relay; one that ended or went is replaced
 * by a new one in the same tab, and the tab's close ends it. `onGone` closes
 * the tab, as for an agent archived.
 */
function cloudLink(
  registry: AtomRegistry.AtomRegistry,
  agentId: string,
  shell: string,
  onGone: () => void,
): ShellLink {
  return {
    agentId,
    open: async () => {
      const made = await askAct(ACT_KIND.TERMINAL_CREATE, { agentId });
      if ("refused" in made) return { state: refusedOrGone(made.refused, onGone) };
      holdShellId(registry, agentId, shell, made.terminal.id);
      return { terminalId: made.terminal.id };
    },
    attach: (terminalId, size) =>
      askAct(ACT_KIND.TERMINAL_ATTACH, { agentId, terminalId, ...size }).then(
        () => ({ asked: true }),
        () => ({ state: SERVICE_UNREACHED }),
      ),
    stateOf: cloudStateOf,
    ended: (session) => session.replace(),
    resume: async () => {
      const resumed = await askAct(ACT_KIND.TERMINAL_RESUME, { agentId });
      return "refused" in resumed ? refusedOrGone(resumed.refused, onGone) : undefined;
    },
    close: (terminalId) => tellAct(ACT_KIND.TERMINAL_KILL, { agentId, terminalId }),
  };
}

/** How a Local tab reaches its shell on this Mac. */
function localLink(agentId: string): ShellLink {
  const close = (terminalId: string) => tellAct(ACT_KIND.MAC_SHELL_CLOSE, { agentId, terminalId });
  return {
    agentId,
    open: async (size) => {
      const mirrored = await askAct(ACT_KIND.MAC_SHELL_MIRROR, { agentId }).catch(() => undefined);
      if (mirrored === undefined) {
        return { state: { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.MIRROR } };
      }
      const made = await askAct(ACT_KIND.MAC_SHELL_OPEN, {
        agentId,
        folder: mirrored.folder,
        ...size,
      }).catch(() => undefined);
      if (made === undefined) {
        return { state: { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SHELL } };
      }
      return { terminalId: made.terminalId };
    },
    attach: (terminalId, size) =>
      askAct(ACT_KIND.MAC_SHELL_ATTACH, { agentId, terminalId, ...size }).then(
        () => ({ asked: true }),
        () => ({ state: { kind: TERMINAL_STATE.UNREACHABLE, why: TERMINAL_UNREACHED.SHELL } }),
      ),
    stateOf: (connection, code) =>
      connection === TERMINAL_CONNECTION.EXITED
        ? { kind: TERMINAL_STATE.EXITED, code }
        : { kind: TERMINAL_STATE.ATTACHED },
    // The shell that ended let go in main, and a new one opened in its place.
    ended: (session) => {
      if (session.terminalId !== undefined) close(session.terminalId);
      session.replace();
    },
    close,
  };
}

/** A terminal tab of either kind. */
export type ShellTab = TerminalStripTab | LocalStripTab;

/** A terminal tab's kind, its agent, and the id the window minted its terminal under. */
function shellOf(tab: ShellTab): {
  readonly kind: TerminalKind;
  readonly agentId: string;
  readonly shell: string;
} {
  switch (tab.kind) {
    case STRIP_TAB_KIND.TERMINAL:
      return { kind: TERMINAL_KIND.CLOUD, agentId: tab.terminal, shell: tab.shell };
    case STRIP_TAB_KIND.LOCAL:
      return { kind: TERMINAL_KIND.LOCAL, agentId: tab.local, shell: tab.shell };
    default:
      return absurd(tab);
  }
}

/** The tab of one of an agent's terminals of the kind. */
function tabOf(kind: TerminalKind, agentId: string, held: HeldShell): ShellTab {
  return kind === TERMINAL_KIND.CLOUD
    ? terminalTab(agentId, held.shell, held.title)
    : localTab(agentId, held.shell, held.title);
}

/** A new terminal of the kind minted in the window's list after the agent's others, and its tab. */
function mintedTab(
  registry: AtomRegistry.AtomRegistry,
  kind: TerminalKind,
  agentId: string,
): ShellTab {
  const heldAtom = terminalsHeld[kind](agentId);
  const held = registry.get(heldAtom);
  const made: HeldShell = { shell: crypto.randomUUID(), title: nextShellTitle(kind, held) };
  registry.set(heldAtom, [...held, made]);
  return tabOf(kind, agentId, made);
}

/**
 * The agent's newest cloud terminal tab the window holds, or a new one where
 * it holds none, as a door that cannot read the side panel's tabs opens it:
 * Show terminal beside the Inbox, which opens it on the agent's task.
 */
export function useCloudTerminalTab(): (agentId: string) => ShellTab {
  const registry = useContext(RegistryContext);
  return useCallback(
    (agentId) => {
      const newest = registry.get(terminalsHeld[TERMINAL_KIND.CLOUD](agentId)).at(-1);
      return newest === undefined
        ? mintedTab(registry, TERMINAL_KIND.CLOUD, agentId)
        : tabOf(TERMINAL_KIND.CLOUD, agentId, newest);
    },
    [registry],
  );
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

export function useTerminalTabSession(
  tab: ShellTab,
  shown: boolean,
  /** Closes the tab, once the service says the agent was archived or retired. */
  onGone: () => void,
): TerminalView {
  const registry = useContext(RegistryContext);
  const { kind, agentId, shell } = shellOf(tab);
  // Note that the close is read through a ref, because the tab hands a new one each render, and its terminal outlives it.
  const gone = useRef(onGone);
  useLayoutEffect(() => {
    gone.current = onGone;
  });
  const session = useMemo(
    () =>
      terminalSession(registry, kind, agentId, shell, () =>
        kind === TERMINAL_KIND.CLOUD
          ? new TerminalSession(
              cloudLink(registry, agentId, shell, () => gone.current()),
              registry
                .get(terminalsHeld[TERMINAL_KIND.CLOUD](agentId))
                .find((each) => each.shell === shell)?.terminal,
            )
          : new TerminalSession(localLink(agentId), undefined),
      ),
    [registry, kind, agentId, shell],
  );
  const view = useTerminalView(session, shown);
  const [retryAtom] = useState(() => waitAtom(STARTING_RETRY));
  const retryLater = useAtomSet(retryAtom);
  // A shown tab waiting on the agent to open its sandbox asks again a while on.
  useEffect(() => {
    if (!shown || view.state.kind !== TERMINAL_STATE.STARTING) return;
    retryLater({
      run: () => {
        if (session.state.kind === TERMINAL_STATE.STARTING) session.connect();
      },
    });
  }, [shown, view.state, session, retryLater]);
  return view;
}

/**
 * Opens one of an agent's terminal tabs of the kind, handing the panel the
 * keys (`onShown`). A new terminal (`fresh`), as New terminal and the rows of
 * the panel's "+" mean it, is minted in the window's list and its tab
 * opened, which opens its shell. Show terminal and Show local go to the
 * agent's tab of the kind viewed last; where none is open, as after a
 * reload, they open the tab of each terminal the window still holds, the
 * newest shown, and where it holds none, a new one.
 */
export function useOpenTerminalTab(
  kind: TerminalKind,
  sidePanel: Pick<SidePanelControl, "onChoose" | "terminals" | "locals" | "viewedAt">,
  onShown: () => void,
): (agentId: string, fresh: boolean) => void {
  const registry = useContext(RegistryContext);
  const { onChoose, terminals, locals, viewedAt } = sidePanel;
  return useCallback(
    (agentId, fresh) => {
      const held = registry.get(terminalsHeld[kind](agentId));
      const open = (kind === TERMINAL_KIND.CLOUD ? terminals : locals).filter(
        (tab) => shellOf(tab).agentId === agentId,
      );
      if (fresh || held.length === 0) {
        onChoose(mintedTab(registry, kind, agentId));
      } else if (open.length > 0) {
        const at = (tab: ShellTab) =>
          viewedAt.find((each) => sameTab(each.tab, tab))?.at ?? Number.NEGATIVE_INFINITY;
        onChoose(open.reduce((latest, tab) => (at(tab) > at(latest) ? tab : latest)));
      } else {
        for (const each of held) onChoose(tabOf(kind, agentId, each));
      }
      onShown();
    },
    [kind, registry, onChoose, terminals, locals, viewedAt, onShown],
  );
}

/**
 * Ends a terminal tab's shell as its tab closes: out of the window's list,
 * and its session, screen, and shell let go, which nothing brings back.
 */
export function useEndTerminalTab(): (tab: ShellTab) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (tab) => {
      const { kind, agentId, shell } = shellOf(tab);
      const held = terminalsHeld[kind](agentId);
      registry.set(
        held,
        registry.get(held).filter((each) => each.shell !== shell),
      );
      endTerminalSessions(registry, kind, agentId, [shell]);
    },
    [registry],
  );
}
