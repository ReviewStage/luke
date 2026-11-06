import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { TERMINAL_CONNECTION } from "@repo/features/terminal-acts";
import { TERMINAL_STATE, TERMINAL_UNREACHED } from "@repo/features/terminal-model";
import { ACT_KIND } from "@repo/host/acts";
import { type LocalStripTab, sameTab } from "@repo/ui/tab-strip-model";
import { useCallback, useContext, useMemo } from "react";
import { askAct, tellAct } from "../act.js";
import { type HeldShell, localShellsHeld, nextShellTitle } from "./local-held.js";
import {
  endTerminalSessions,
  type ShellLink,
  TERMINAL_KIND,
  TerminalSession,
  terminalSession,
} from "./terminal-session.js";
import type { SidePanelControl } from "./use-side-panel.js";
import { type TerminalView, useTerminalView } from "./use-terminal-view.js";

/**
 * use-local-session.ts -- one Local tab's terminal on this Mac, in its cloud agent's mirror: its shell opened at the screen's first size and attached for the tab's life; and the doors that open such a tab and end its terminal as it closes.
 *
 * Each terminal is a tab of its own, minted in the window's list
 * (`local-held.ts`) as its tab opens, and a session of its own
 * (`terminal-session.ts`). Once the screen first has room, the session opens
 * its shell: the agent's mirror found or made (`macShell.mirror`, which
 * starts mirroring the agent's files and answers as soon as its folder
 * stands), then a shell opened there at the screen's size (`macShell.open`),
 * and attached. The shell is the tab's alone: closing the tab ends it, and
 * so does the window's page going, a reload among it, after which the tab
 * opens a fresh one.
 *
 * A shell that ended takes any key for a new one in the same tab, and the
 * bar's action (its click, or Return) asks again for a mirror or a shell
 * main could not make.
 */

/** How a Local tab's session reaches its shell on this Mac. */
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

export function useLocalSession(agentId: string, shellId: string, shown: boolean): TerminalView {
  const registry = useContext(RegistryContext);
  const session = useMemo(
    () =>
      terminalSession(
        registry,
        TERMINAL_KIND.LOCAL,
        agentId,
        shellId,
        () => new TerminalSession(localLink(agentId), undefined),
      ),
    [registry, agentId, shellId],
  );
  return useTerminalView(session, shown);
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
 * and its session, screen, and shell let go, which nothing brings back.
 */
export function useEndLocal(): (tab: LocalStripTab) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (tab) => {
      registry.set(
        localShellsHeld(tab.local),
        registry.get(localShellsHeld(tab.local)).filter((each) => each.shell !== tab.shell),
      );
      endTerminalSessions(registry, TERMINAL_KIND.LOCAL, tab.local, [tab.shell]);
    },
    [registry],
  );
}
