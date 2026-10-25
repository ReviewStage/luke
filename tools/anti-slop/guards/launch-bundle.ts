import path from "node:path";

import type { RepositoryGuard } from "./guard.ts";
import { type ModuleRecord, readModule, resolveRelative } from "./module-graph.ts";

/**
 * launch-bundle.ts -- what the panel's `app.tsx` imports statically is what every launch of the window parses.
 *
 * The settings pages behind Settings' `lazy()` boundary and a fixture run's
 * synthetic tasks, which a live run never draws, stay out of that reach,
 * loaded by a dynamic `import()` where they are drawn. A module reached only
 * through `import()`, a type-only import, or another package is not followed.
 */

const PANEL_SOURCE = "packages/panel/src";
const ENTRY = "app.tsx";

/** What the launch never parses; the settings panel imports every page statically, so reaching it reaches them all. */
const KEPT_OUT = ["settings/settings-panel.tsx", "tasks/tasks-fixture.ts"] as const;

/** The files an entry reaches through static value imports of its own relative modules, each with the chain that reached it. */
export function reachedFrom(
  entry: string,
  read: (file: string) => ModuleRecord,
  resolve: (from: string, specifier: string) => string | undefined,
): ReadonlyMap<string, readonly string[]> {
  const reached = new Map<string, readonly string[]>([[entry, [entry]]]);
  const pending = [entry];
  for (const file of pending) {
    const module = read(file);
    for (const edge of [...module.imports, ...module.reexports]) {
      if (edge.typeOnly) continue;
      const target = resolve(file, edge.specifier);
      if (target === undefined || reached.has(target)) continue;
      reached.set(target, [...(reached.get(file) ?? []), target]);
      pending.push(target);
    }
  }
  return reached;
}

async function launchProblems(root: string): Promise<readonly string[]> {
  const source = path.join(root, PANEL_SOURCE);
  const reached = reachedFrom(path.join(source, ENTRY), readModule, resolveRelative);
  return KEPT_OUT.flatMap((file) => {
    const chain = reached.get(path.join(source, file));
    if (chain === undefined) return [];
    const steps = chain.map((step) => path.relative(source, step)).join(" → ");
    return [
      `${PANEL_SOURCE}/${file}: reached statically from ${ENTRY} (${steps}); load it with import() where it is drawn`,
    ];
  });
}

export const launchBundleGuard: RepositoryGuard = {
  holds: "the panel's launch bundle reaches no settings page and no fixture's tasks",
  problems: launchProblems,
};
