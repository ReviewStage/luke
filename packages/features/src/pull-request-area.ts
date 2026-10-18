import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * pull-request-area.ts -- the directories a pull request touched, and its lines in each.
 *
 * An area is one directory of the repository a pull request changed files
 * in, from the repository's root, and the lines it added and removed there.
 * A file is counted in the directory it sits in, cut to `AREA_DEPTH`
 * directories, so `packages/service/src/agents/brain/turn.ts` counts in
 * `packages/service/src/agents` and `apps/web/vite.config.ts` in `apps/web`.
 * A file at the root counts in `AREA_PATH.ROOT`.
 *
 * A pull request names at most `PULL_REQUEST_AREA_BOUNDS.MAX_AREAS`: the
 * largest by the lines changed there, then one more, `AREA_PATH.REST`,
 * holding the lines of every area past them. Neither spelling is one a
 * directory under the root can have, since git names no path segment empty
 * or `.`.
 *
 * The service keeps them on a coding agent's stored pull request as GitHub
 * last answered it, and the Factory's world reads them to place the work.
 */

/** @public Read by the world's storage, route, and view model, which land above this contract. */
export const PULL_REQUEST_AREA_BOUNDS = {
  /** The most areas one pull request names, the remainder among them. */
  MAX_AREAS: 16,
} as const;

/** How many directories deep a file is counted: deep enough to tell a package's modules apart. */
const AREA_DEPTH = 4;

/**
 * The two area paths that are no directory under the root.
 *
 * @public Read by the world's storage, route, and view model, which land above this contract.
 */
export const AREA_PATH = {
  /** The repository's root, where a file with no directory counts. */
  ROOT: ".",
  /** Every area past the largest, folded into one. */
  REST: "",
} as const;

/**
 * One directory a pull request touched: its path from the root, and the lines added and removed in it.
 *
 * @public Read by the service's stored pull request and the world's view model, which land above this contract.
 */
export const pullRequestAreaSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  additions: countedNumber,
  deletions: countedNumber,
});

/** @public Read by the world's storage, route, and view model, which land above this contract. */
export type PullRequestArea = typeof pullRequestAreaSchema.Type;

/**
 * A pull request's areas, largest first and the remainder last, within their bound.
 *
 * @public Read by the world's storage, route, and view model, which land above this contract.
 */
export const pullRequestAreasSchema = EffectSchema.Array(pullRequestAreaSchema).check(
  EffectSchema.isMaxLength(PULL_REQUEST_AREA_BOUNDS.MAX_AREAS),
);

/**
 * One file a pull request changed, as GitHub lists it: its path from the root, and its lines.
 *
 * @public Read by the world's storage, route, and view model, which land above this contract.
 */
export interface ChangedFileLines {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The area a file counts in: its directory, cut to `AREA_DEPTH`, or the root. */
function areaPathOf(filePath: string): string {
  const directories = filePath.split("/").filter((segment) => segment !== "");
  directories.pop();
  if (directories.length === 0) return AREA_PATH.ROOT;
  return directories.slice(0, AREA_DEPTH).join("/");
}

function linesOf(area: PullRequestArea): number {
  return area.additions + area.deletions;
}

/** Larger first; equal areas by path, so the same files always fold the same way. */
function largerFirst(left: PullRequestArea, right: PullRequestArea): number {
  return linesOf(right) - linesOf(left) || (left.path < right.path ? -1 : 1);
}

/**
 * Folds a pull request's changed files into its areas: each file's lines
 * summed into the directory it counts in, largest first, and past the bound
 * the smallest folded into `AREA_PATH.REST`, last. A file that changed no
 * lines, a rename alone among them, still marks its directory, with none.
 */
export function pullRequestAreasOf(files: readonly ChangedFileLines[]): PullRequestArea[] {
  const byPath = new Map<string, PullRequestArea>();
  for (const file of files) {
    const path = areaPathOf(file.path);
    const area = byPath.get(path) ?? { path, additions: 0, deletions: 0 };
    byPath.set(path, {
      path,
      additions: area.additions + file.additions,
      deletions: area.deletions + file.deletions,
    });
  }
  const areas = [...byPath.values()].sort(largerFirst);
  if (areas.length <= PULL_REQUEST_AREA_BOUNDS.MAX_AREAS) return areas;
  const kept = areas.slice(0, PULL_REQUEST_AREA_BOUNDS.MAX_AREAS - 1);
  const folded = areas.slice(PULL_REQUEST_AREA_BOUNDS.MAX_AREAS - 1);
  const rest = folded.reduce(
    (sum, area) => ({
      path: AREA_PATH.REST,
      additions: sum.additions + area.additions,
      deletions: sum.deletions + area.deletions,
    }),
    { path: AREA_PATH.REST, additions: 0, deletions: 0 },
  );
  return [...kept, rest];
}
