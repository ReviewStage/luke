import { OVERVIEW_BOUNDS } from "@repo/features/agent-wire";

export interface StackCandidate {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly draft: boolean;
  readonly head: string;
  readonly base: string;
  readonly crossRepository: boolean;
  readonly queued?: true;
}

export type StackEntry = Omit<StackCandidate, "head" | "base" | "crossRepository">;

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

function sole(list: readonly StackCandidate[] | undefined): StackCandidate | undefined {
  return list?.length === 1 ? list[0] : undefined;
}

export function stackOf(
  current: StackCandidate,
  open: readonly StackCandidate[],
): readonly StackEntry[] {
  if (current.crossRepository) return [];
  const candidates = [
    current,
    ...open.filter((each) => each.number !== current.number && !each.crossRepository),
  ];
  const heads = byBranch(candidates, (each) => each.head);
  const bases = byBranch(candidates, (each) => each.base);
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
  return chain.map(({ number, title, url, draft, queued }) => ({
    number,
    title,
    url,
    draft,
    ...(queued === true ? { queued } : undefined),
  }));
}
