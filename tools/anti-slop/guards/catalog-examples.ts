import path from "node:path";

import { type RepositoryGuard, readJson, record, texts } from "./guard.ts";
import { type ModuleRecord, namesUsed, readModule, resolveRelative } from "./module-graph.ts";

const UI_BARREL = "packages/ui/src/index.ts";
const UI_PACKAGE = "@repo/ui";
const REGISTRY = "apps/catalog/src/examples.ts";
const EXAMPLES = "apps/catalog/src/examples";
const EXEMPT = "tools/anti-slop/catalog-exempt.json";

const PASCAL_CASE = /^[A-Z][a-z0-9]/u;

const GLYPH_SUFFIX = "Icon";

export function exportedValues(
  barrel: string,
  read: (file: string) => ModuleRecord,
  resolve: (from: string, specifier: string) => string | undefined,
): ReadonlySet<string> {
  const names = new Set<string>();
  const visited = new Set<string>();
  const walk = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const module = read(file);
    for (const { name, typeOnly } of module.declared)
      if (!typeOnly && name !== "*") names.add(name);
    for (const edge of module.reexports) {
      if (edge.typeOnly) continue;
      const target = resolve(file, edge.specifier);
      for (const { imported, local } of edge.names) {
        if (imported === "*" && local === "*" && target !== undefined) walk(target);
        else if (local !== "*") names.add(local);
      }
    }
  };
  walk(barrel);
  return names;
}

export function componentsOf(names: ReadonlySet<string>): readonly string[] {
  return [...names].filter((name) => PASCAL_CASE.test(name) && !name.endsWith(GLYPH_SUFFIX)).sort();
}

export function drawnFrom(module: ModuleRecord): ReadonlySet<string> {
  const used = namesUsed(module.program);
  const drawn = new Set<string>();
  for (const edge of module.imports) {
    if (edge.specifier !== UI_PACKAGE || edge.typeOnly) continue;
    for (const { imported, local } of edge.names) if (used.has(local)) drawn.add(imported);
  }
  return drawn;
}

function exampleFiles(registry: string, examples: string): readonly string[] {
  const module = readModule(registry);
  const used = namesUsed(module.program);
  const queue = module.imports
    .filter((edge) => !edge.typeOnly && edge.names.some(({ local }) => used.has(local)))
    .flatMap((edge) => resolveRelative(registry, edge.specifier) ?? []);
  const seen = new Set(queue);
  for (const file of queue) {
    for (const edge of readModule(file).imports) {
      const target = resolveRelative(file, edge.specifier);
      if (target === undefined || !target.startsWith(examples + path.sep) || seen.has(target))
        continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

export function catalogProblems(
  components: readonly string[],
  drawn: ReadonlySet<string>,
  exempt: {
    readonly notAComponent: readonly string[];
    readonly awaitingAnExample: readonly string[];
  },
): readonly string[] {
  const rows = new Set([...exempt.notAComponent, ...exempt.awaitingAnExample]);
  const missing = components
    .filter((name) => !drawn.has(name) && !rows.has(name))
    .map(
      (name) =>
        `${name}: no example in ${REGISTRY} draws it; add one, or name it in ${EXEMPT}'s notAComponent with why`,
    );
  const exported = new Set(components);
  const stale = [...rows]
    .filter((name) => !exported.has(name) || drawn.has(name))
    .map((name) => `${EXEMPT}: ${name} is gone from the barrel or now drawn; delete its row`);
  return [...missing, ...stale];
}

async function catalogExampleProblems(root: string): Promise<readonly string[]> {
  const components = componentsOf(
    exportedValues(path.join(root, UI_BARREL), readModule, resolveRelative),
  );
  const files = exampleFiles(path.join(root, REGISTRY), path.join(root, EXAMPLES));
  if (files.length === 0)
    return [`${REGISTRY}: no registered example file was found, so the reading is blind`];
  const drawn = new Set(files.flatMap((file) => [...drawnFrom(readModule(file))]));
  const exempt = readJson(root, EXEMPT);
  return catalogProblems(components, drawn, {
    notAComponent: Object.keys(record(exempt.notAComponent, "notAComponent")),
    awaitingAnExample: texts(exempt.awaitingAnExample, "awaitingAnExample"),
  });
}

export const catalogExamplesGuard: RepositoryGuard = {
  holds:
    "every component @repo/ui exports is drawn by a catalog example, or exempt with its reason",
  problems: catalogExampleProblems,
};
