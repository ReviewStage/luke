import { Store, useSelector } from "@tanstack/react-store";
import { Option, Schema } from "effect";
import { TERMINAL_KIND, type TerminalKind } from "./terminal-session.js";

/**
 * terminal-held.ts -- the terminals this window holds for each coding agent, each one tab, cloud or Local, kept across a reload.
 *
 * A terminal is minted here first, under an id of the window's own and its
 * name ("Cloud 1", "Local 1"), so its tab stands at once; the tab then opens
 * its shell (`use-terminal-session.ts`). The window keeps its terminals in
 * its session storage, which a reload keeps and a closed window forgets, and
 * Show terminal and Show local open their tabs again. A cloud terminal keeps
 * the id its sandbox answered for its shell, which runs on in tmux, so its
 * tab attaches to it again; a Local shell ends with the page, so its tab
 * opens a fresh one. Note that every list is kept under one key, nested by
 * kind and then by the agent's id, because a key is never built from an id.
 * It holds ids and names, never a byte a shell printed. A terminal leaves
 * its list as its tab closes. The lists are one TanStack `Store` the window
 * holds (`use-terminal-session.ts`'s `TerminalsContext`), read from storage
 * as it is made and written through to it at each change.
 */

/** The one key the window's terminals are kept under. */
const HELD_KEY = "vespin.terminals";

/** What a terminal's name starts with, by kind, before its number. */
const TITLE_WORDS = {
  [TERMINAL_KIND.CLOUD]: "Cloud",
  [TERMINAL_KIND.LOCAL]: "Local",
} as const;

/** One terminal the window holds: the id it minted the terminal under, its name, and its shell's id where its host keeps it past a reload. */
const heldShellSchema = Schema.Struct({
  shell: Schema.String,
  title: Schema.String,
  terminal: Schema.optional(Schema.String),
});

export type HeldShell = typeof heldShellSchema.Type;

/** One kind's terminals, oldest first, by the agent's id. */
const heldByAgentSchema = Schema.Record(Schema.String, Schema.Array(heldShellSchema));

/** Every kind's terminals. */
const heldShellsSchema = Schema.Struct({
  [TERMINAL_KIND.CLOUD]: heldByAgentSchema,
  [TERMINAL_KIND.LOCAL]: heldByAgentSchema,
});

type HeldShells = typeof heldShellsSchema.Type;

const heldShellsJson = Schema.fromJsonString(heldShellsSchema);

/** No terminal held. */
const NONE_HELD: HeldShells = { [TERMINAL_KIND.CLOUD]: {}, [TERMINAL_KIND.LOCAL]: {} };
const NOTHING_HELD: readonly HeldShell[] = [];

/** What the window kept before a reload, or nothing where it kept none, it no longer reads, or storage refuses. */
function readHeld(): HeldShells {
  try {
    const kept = Schema.decodeUnknownOption(heldShellsJson)(
      window.sessionStorage.getItem(HELD_KEY),
    );
    return Option.getOrElse(kept, () => NONE_HELD);
  } catch {
    return NONE_HELD;
  }
}

/** Keeps the window's terminals for the next reload; a write that fails costs only the list a reload reads. */
function writeHeld(held: HeldShells): void {
  try {
    window.sessionStorage.setItem(HELD_KEY, Schema.encodeSync(heldShellsJson)(held));
  } catch {
    // A reload then forgets the window's terminals.
  }
}

/** Every terminal a window holds, by kind, then by agent: what it kept before a reload, read as it is made, then each list written through to storage. */
export class TerminalsHeld {
  /** The lists themselves; written only through `set`, which keeps storage in step. */
  readonly all = new Store<HeldShells>(readHeld());

  /** One kind's terminals of one agent, oldest first. */
  of(kind: TerminalKind, agentId: string): readonly HeldShell[] {
    return this.all.state[kind][agentId] ?? NOTHING_HELD;
  }

  /** Sets one kind's terminals of one agent, written through to the window's session storage. */
  set(kind: TerminalKind, agentId: string, shells: readonly HeldShell[]): void {
    const all = this.all.state;
    const { [agentId]: _was, ...others } = all[kind];
    const next = {
      ...all,
      [kind]: shells.length === 0 ? others : { ...others, [agentId]: shells },
    };
    writeHeld(next);
    this.all.setState(() => next);
  }
}

/** One kind's terminals of one agent the window holds, oldest first, as a component reads them. */
export function useHeldShells(
  held: TerminalsHeld,
  kind: TerminalKind,
  agentId: string,
): readonly HeldShell[] {
  return useSelector(held.all, (all) => all[kind][agentId] ?? NOTHING_HELD);
}

/** The name a new terminal takes: its kind's word and the next number past every name of that shape the agent's terminals of the kind hold. */
export function nextShellTitle(kind: TerminalKind, shells: readonly HeldShell[]): string {
  const word = TITLE_WORDS[kind];
  const pattern = new RegExp(`^${word} (\\d+)$`, "u");
  const highest = shells
    .map((shell) => Number(pattern.exec(shell.title)?.[1]))
    .reduce((most, each) => (Number.isFinite(each) ? Math.max(most, each) : most), 0);
  return `${word} ${highest + 1}`;
}
