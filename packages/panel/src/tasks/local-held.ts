import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";

/**
 * local-held.ts -- the terminals this window holds on this Mac in each cloud agent's mirror, each one Local tab, kept across a reload.
 *
 * A terminal is minted here first, under an id of the window's own and its
 * name, so its tab stands at once; the tab then opens its shell
 * (`use-local-session.ts`) and writes the id main named the shell by
 * beside it. Main holds each shell and ends it with the window, but a
 * reload keeps them running (`@repo/host/act-port`'s
 * `mac-shell-procedures.ts`), so the window keeps its terminals in its
 * session storage, which a reload keeps and a closed window forgets with
 * its shells, and Show local opens their tabs again. Note that every
 * agent's list is kept under one key, nested by the agent's id, because a
 * key is never built from an id. It holds ids and names, never a byte a
 * shell printed. A terminal leaves its list as its tab closes.
 */

/** The one key the window's shells are kept under. */
const HELD_KEY = "vespin.localShells";

/** One terminal the window holds: the id it minted the terminal under, the id main named its shell by once one is open, and its name. */
const heldShellSchema = Schema.Struct({
  shell: Schema.String,
  terminalId: Schema.optionalKey(Schema.String),
  title: Schema.String,
});

export type HeldShell = typeof heldShellSchema.Type;

/** Every agent's terminals, oldest first, by the agent's id. */
const heldShellsSchema = Schema.Record(Schema.String, Schema.Array(heldShellSchema));

type HeldShells = typeof heldShellsSchema.Type;

const heldShellsJson = Schema.fromJsonString(heldShellsSchema);

/** No agent holds a terminal. */
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
    // A reload then forgets the window's terminals, whose shells still end with the window.
  }
}

/** Every agent's terminals as the window holds them: what it kept before a reload, read once, then each list written through to storage. */
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
 * One agent's terminals, oldest first: read as the window holds them, and
 * written through to its session storage, so a reload finds them.
 */
export const localShellsHeld = Atom.family((agentId: string) =>
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

/** The name a new terminal takes: "Terminal" and the next number past every name of that shape the agent's terminals hold. */
export function nextShellTitle(shells: readonly HeldShell[]): string {
  const taken = shells.map((shell) => /^Terminal (\d+)$/u.exec(shell.title)?.[1]).map(Number);
  const highest = taken.reduce(
    (most, each) => (Number.isFinite(each) ? Math.max(most, each) : most),
    0,
  );
  return `Terminal ${highest + 1}`;
}
