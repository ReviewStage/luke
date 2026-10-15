import * as Atom from "effect/reactivity/Atom";

/**
 * pr-run-store.ts -- the runs asked of each coding agent's pull request on this Mac and not yet started.
 *
 * Run on this Mac, from the pull request's menu, opens the pull request's
 * run tab and counts an ask here, by the agent that published it; the tab,
 * once its port can stand, starts one run for every ask it finds and counts
 * them off, so a press made before the tab was drawn is not lost and a tab
 * drawn again without one only shows the run that stands. It holds counts,
 * never a byte a run printed. It is the window's for its life.
 */

export const runsAsked = Atom.family((_agentId: string) => Atom.keepAlive(Atom.make(0)));
