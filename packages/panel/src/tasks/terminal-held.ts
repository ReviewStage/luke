import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";

/**
 * terminal-held.ts -- the shells this window opened on this Mac for each cloud agent's Terminal tab, kept across a reload, and the new shells asked for and not yet opened.
 *
 * Main holds each shell and ends it with the window, but a reload keeps
 * them running (`@repo/host/act-port`'s `mac-shell-procedures.ts`), so the
 * window keeps which shells it opened, and what it named them, in its
 * session storage, which a reload keeps and a closed window forgets with
 * its shells. Note that every agent's list is kept under one key, nested by
 * the agent's id, because a key is never built from an id. It holds ids and
 * names, never a byte a shell printed. A shell main no longer holds is
 * dropped from its list once its attach is refused.
 */

/** The one key the window's shells are kept under. */
const HELD_KEY = "vespin.terminalShells";

/** One shell the window opened: the id main named it by, and its name in the list. */
const heldShellSchema = Schema.Struct({
  terminalId: Schema.String,
  title: Schema.String,
});

export type HeldShell = typeof heldShellSchema.Type;

/** Every agent's shells, oldest first, by the agent's id. */
const heldShellsSchema = Schema.Record(Schema.String, Schema.Array(heldShellSchema));

type HeldShells = typeof heldShellsSchema.Type;

const heldShellsJson = Schema.fromJsonString(heldShellsSchema);

/** No agent holds a shell. */
const NOTHING_HELD: readonly HeldShell[] = [];

/** What the window kept before a reload, or nothing where it kept none, it no longer reads, or storage refuses. */
function readHeld(): HeldShells {
  try {
    const kept = Schema.decodeUnknownOption(heldShellsJson)(
      window.sessionStorage.getItem(HELD_KEY),
    );
    return Option.getOrElse(kept, () => ({}));
  } catch {
    return {};
  }
}

/** Keeps the window's shells for the next reload; a write that fails costs only the list a reload reads. */
function writeHeld(held: HeldShells): void {
  try {
    window.sessionStorage.setItem(HELD_KEY, Schema.encodeSync(heldShellsJson)(held));
  } catch {
    // A reload then opens a fresh shell, the earlier ones still ended with the window.
  }
}

/** Every agent's shells as the window holds them: what it kept before a reload, read once, then each list written through to storage. */
const allHeld = Atom.keepAlive(
  Atom.writable(
    (): HeldShells => readHeld(),
    (context, next: HeldShells) => {
      writeHeld(next);
      context.setSelf(next);
    },
  ),
);

/**
 * One agent's shells, oldest first: read as the window holds them, and
 * written through to its session storage, so a reload finds them.
 */
export const shellsHeld = Atom.family((agentId: string) =>
  Atom.keepAlive(
    Atom.writable(
      (get) => get(allHeld)[agentId] ?? NOTHING_HELD,
      (context, shells: readonly HeldShell[]) => {
        const { [agentId]: _was, ...others } = context.get(allHeld);
        context.set(allHeld, shells.length === 0 ? others : { ...others, [agentId]: shells });
      },
    ),
  ),
);

/**
 * How many new shells were asked for in the agent's mirror and not yet
 * opened: New terminal asks, from ⌘K or the panel's "+", and the agent's
 * Terminal tab opens them and counts them off.
 */
export const shellsAsked = Atom.family((_agentId: string) => Atom.keepAlive(Atom.make(0)));

/** The name a new shell takes: "Shell" and the next number past every name of that shape the agent's shells hold. */
export function nextShellTitle(shells: readonly HeldShell[]): string {
  const taken = shells.map((shell) => /^Shell (\d+)$/u.exec(shell.title)?.[1]).map(Number);
  const highest = taken.reduce(
    (most, each) => (Number.isFinite(each) ? Math.max(most, each) : most),
    0,
  );
  return `Shell ${highest + 1}`;
}
