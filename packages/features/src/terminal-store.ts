import type { TerminalsAnswer } from "@luke/features/terminal-wire";
import * as Atom from "effect/reactivity/Atom";

/**
 * terminal-store.ts -- what the window last read of each coding agent's sandbox: where it stands, and its shells.
 *
 * A Terminal tab reads the agent's shells while it is shown, and every other
 * place that names the agent's terminal says what that read last said,
 * without reading the service itself: the tab's card counts the shells. It
 * holds names, folders, and commands, never a byte a shell printed. It is
 * the window's for its life, and nothing before the first read.
 */

/** The last list of the agent's shells, with where its sandbox stood, or nothing before the window first read it. */
export const sandboxRead = Atom.family((_agentId: string) =>
  Atom.keepAlive(Atom.make<TerminalsAnswer | undefined>(undefined)),
);

/**
 * How many new shells were asked for in the agent's sandbox and not yet
 * started: New terminal asks, from ⌘K or the panel's "+", and the agent's
 * Terminal tab, once its sandbox runs, starts them and counts them off.
 */
export const shellsAsked = Atom.family((_agentId: string) => Atom.keepAlive(Atom.make(0)));
