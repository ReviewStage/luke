import path from "node:path";

import type { RepositoryGuard } from "./guard.ts";
import { type ModuleRecord, readModule, resolveRelative } from "./module-graph.ts";

const PANEL_SOURCE = "packages/panel/src";
const ENTRY = "app.tsx";

const KEPT_OUT = ["settings/settings-panel.tsx", "tasks/tasks-fixture.ts"] as const;

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
