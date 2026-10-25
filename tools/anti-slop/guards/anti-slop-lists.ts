import { existsSync } from "node:fs";
import path from "node:path";

import { ARROW_KEY_BASELINE, ARROW_KEY_EXEMPTIONS } from "../shared/arrow-key-guard.ts";
import { BUSY_BASELINE } from "../shared/busy-guard.ts";
import { KEPT_STORAGE_BASELINE, NOT_VIEW_STORAGE } from "../shared/kept-guard.ts";
import { isDoorFile, LUCIDE_BASELINE } from "../shared/lucide-guard.ts";
import { PRESS_LISTENER_BASELINE } from "../shared/press-listener-guard.ts";
import { RETIRED } from "../shared/retired.ts";
import type { RepositoryGuard } from "./guard.ts";

/**
 * anti-slop-lists.ts -- the lint rules' baselines and exemptions name files that exist.
 *
 * An oxlint rule reads the files it lints, so it lowers a baseline's count
 * only for a file still there: a file deleted or moved leaves its row behind,
 * where it stands as room for the next file of that name. The style guard
 * reads every file and needs no such check; these lists are read by rules
 * alone.
 */

/** A list a rule reads, by name, with the paths it names. */
export interface NamedList {
  readonly name: string;
  readonly paths: readonly string[];
}

/** Each path a list names that is not there, and each file on both of two lists that must not share one. */
export function listProblems(
  lists: readonly NamedList[],
  exists: (file: string) => boolean,
  apart: readonly (readonly [NamedList, NamedList])[],
): readonly string[] {
  const missing = lists.flatMap(({ name, paths }) =>
    paths
      .filter((file) => !exists(file))
      .map((file) => `${name}: ${file} does not exist; delete its row`),
  );
  const shared = apart.flatMap(([left, right]) =>
    left.paths
      .filter((file) => right.paths.includes(file))
      .map((file) => `${file} is on both ${left.name} and ${right.name}`),
  );
  return [...missing, ...shared];
}

async function antiSlopListProblems(root: string): Promise<readonly string[]> {
  const lucide = { name: "lucide-baseline.json", paths: [...LUCIDE_BASELINE.keys()] };
  const keptBaseline = {
    name: "kept-storage-baseline.json",
    paths: Object.keys(KEPT_STORAGE_BASELINE),
  };
  const keptAllowed = { name: "kept-storage-allowed.json", paths: Object.keys(NOT_VIEW_STORAGE) };
  const lists: NamedList[] = [
    lucide,
    keptBaseline,
    keptAllowed,
    { name: "busy-baseline.json", paths: Object.keys(BUSY_BASELINE) },
    { name: "press-listener-baseline.json", paths: Object.keys(PRESS_LISTENER_BASELINE) },
    { name: "arrow-keys.json's baseline", paths: Object.keys(ARROW_KEY_BASELINE) },
    { name: "arrow-keys.json's exemptions", paths: ARROW_KEY_EXEMPTIONS },
    ...RETIRED.map((retirement) => ({
      name: `retired/${retirement.file}'s baseline`,
      paths: Object.keys(retirement.baseline),
    })),
  ];
  const problems = listProblems(lists, (file) => existsSync(path.join(root, file)), [
    [keptBaseline, keptAllowed],
  ]);
  const doors = lucide.paths
    .filter(isDoorFile)
    .map((file) => `lucide-baseline.json: ${file} is a door file, which imports Lucide uncounted`);
  return [...problems, ...doors];
}

export const antiSlopListsGuard: RepositoryGuard = {
  holds: "tools/anti-slop's baselines and exemptions name only files that exist, each on one list",
  problems: antiSlopListProblems,
};
