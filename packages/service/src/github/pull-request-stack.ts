/**
 * pull-request-stack.ts -- the stack a pull request stands in, worked out from the repository's open pull requests: the one it is based on, the one based on it, and so on up and down, base first.
 *
 * A stack is read as stage-cli reads one. A pull request stands on the open
 * pull request whose head is its base, and only where it is the one open
 * pull request based on that branch, so a branch many target (`main`, a
 * release branch) makes no stack of them. A head two open pull requests
 * share names neither, a pull request from a fork stacks on nothing, and a
 * chain that loops back on itself is no stack. A pull request no other one
 * stands on or under stands in none, which reads as no stack at all.
 */

import { OVERVIEW_BOUNDS } from "@luke/features/coding-agent-wire";

/** One open pull request as a stack is worked out from: its number, its words, and its two branches. */
export interface StackCandidate {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly draft: boolean;
  readonly head: string;
  readonly base: string;
  /** Whether its head is a fork's branch, which no pull request of this repository stands on. */
  readonly crossRepository: boolean;
}

/** One pull request of a stack, as its header lists it. */
export type StackEntry = Omit<StackCandidate, "base" | "crossRepository">;

/** The candidates by a branch of theirs, each branch's in the order given. */
function byBranch(
  candidates: readonly StackCandidate[],
  branch: (candidate: StackCandidate) => string,
): ReadonlyMap<string, readonly StackCandidate[]> {
  const by = new Map<string, StackCandidate[]>();
  for (const candidate of candidates) {
    const held = by.get(branch(candidate));
    if (held === undefined) by.set(branch(candidate), [candidate]);
    else held.push(candidate);
  }
  return by;
}

/** The one candidate of a branch's, or none where it holds none or more than one. */
function sole(list: readonly StackCandidate[] | undefined): StackCandidate | undefined {
  return list?.length === 1 ? list[0] : undefined;
}

/**
 * The stack `current` stands in, base first, `current` among it; none where
 * nothing stands on or under it, or the chain loops. `current` is counted
 * whether or not `open` lists it, since a listing bounded to the newest may
 * leave out the very pull request it is read for. The chain is walked out
 * from `current` up to the bound each way.
 */
export function stackOf(
  current: StackCandidate,
  open: readonly StackCandidate[],
): readonly StackEntry[] {
  const candidates = [
    current,
    ...open.filter((each) => each.number !== current.number && !each.crossRepository),
  ];
  const heads = byBranch(candidates, (each) => each.head);
  const bases = byBranch(candidates, (each) => each.base);
  // Note that an edge stands only where each end is the one of its branch, so a parent names exactly one child.
  const parentOf = (node: StackCandidate) =>
    sole(bases.get(node.base)) === node ? sole(heads.get(node.base)) : undefined;
  const childOf = (node: StackCandidate) => {
    const child = sole(bases.get(node.head));
    return child !== undefined && sole(heads.get(node.head)) === node ? child : undefined;
  };
  const seen = new Set([current.number]);
  const chain = [current];
  for (let node = parentOf(current); node !== undefined; node = parentOf(node)) {
    if (seen.has(node.number)) return [];
    if (chain.length >= OVERVIEW_BOUNDS.MAX_STACK) break;
    seen.add(node.number);
    chain.unshift(node);
  }
  for (let node = childOf(current); node !== undefined; node = childOf(node)) {
    if (seen.has(node.number)) return [];
    if (chain.length >= OVERVIEW_BOUNDS.MAX_STACK) break;
    seen.add(node.number);
    chain.push(node);
  }
  if (chain.length < 2) return [];
  return chain.map(({ number, title, url, draft, head }) => ({ number, title, url, draft, head }));
}
