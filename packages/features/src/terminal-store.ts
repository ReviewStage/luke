import type { TerminalsAnswer } from "@repo/features/terminal-wire";
import * as Atom from "effect/reactivity/Atom";

export const sandboxRead = Atom.family((_agentId: string) =>
  Atom.keepAlive(Atom.make<TerminalsAnswer | undefined>(undefined)),
);

export const shellsAsked = Atom.family((_agentId: string) => Atom.keepAlive(Atom.make(0)));
