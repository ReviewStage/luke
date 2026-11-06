import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";

const HELD_KEY = "vespin.localShells";

const heldShellSchema = Schema.Struct({
  terminalId: Schema.String,
  title: Schema.String,
});

export type HeldShell = typeof heldShellSchema.Type;

const heldShellsSchema = Schema.Record(Schema.String, Schema.Array(heldShellSchema));

type HeldShells = typeof heldShellsSchema.Type;

const heldShellsJson = Schema.fromJsonString(heldShellsSchema);

const NOTHING_HELD: readonly HeldShell[] = [];

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

function writeHeld(held: HeldShells): void {
  try {
    window.sessionStorage.setItem(HELD_KEY, Schema.encodeSync(heldShellsJson)(held));
  } catch {}
}

const allHeld = Atom.keepAlive(
  Atom.writable(
    (): HeldShells => readHeld(),
    (context, next: HeldShells) => {
      writeHeld(next);
      context.setSelf(next);
    },
  ),
);

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

export const localShellsAsked = Atom.family((_agentId: string) => Atom.keepAlive(Atom.make(0)));

export function nextShellTitle(shells: readonly HeldShell[]): string {
  const taken = shells.map((shell) => /^Terminal (\d+)$/u.exec(shell.title)?.[1]).map(Number);
  const highest = taken.reduce(
    (most, each) => (Number.isFinite(each) ? Math.max(most, each) : most),
    0,
  );
  return `Terminal ${highest + 1}`;
}
