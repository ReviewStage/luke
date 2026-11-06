import { existsSync } from "node:fs";
import path from "node:path";

import { ARROW_KEY_BASELINE, ARROW_KEY_EXEMPTIONS } from "../shared/arrow-key-guard.ts";
import { BUSY_BASELINE } from "../shared/busy-guard.ts";
import { KEPT_STORAGE_BASELINE, NOT_VIEW_STORAGE } from "../shared/kept-guard.ts";
import { isDoorFile, LUCIDE_BASELINE } from "../shared/lucide-guard.ts";
import { PRESS_LISTENER_BASELINE } from "../shared/press-listener-guard.ts";
import { RETIRED } from "../shared/retired.ts";
import type { RepositoryGuard } from "./guard.ts";

export interface NamedList {
  readonly name: string;
  readonly paths: readonly string[];
}

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
