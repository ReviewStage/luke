import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

/**
 * launch-bundle.test.ts -- what `app.tsx` imports statically is what every
 * launch of the window parses, so the settings pages behind Settings' `lazy()`
 * boundary and a fixture run's synthetic tasks, which a live run never draws,
 * stay out of that reach, loaded by a dynamic `import()` where they are drawn.
 * Reads the panel's own source: a module reached only through `import()`,
 * a type-only import, or another package is not followed.
 */

const SOURCE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"(\.[^"]+)"|^import\s+"(\.[^"]+)"/gm;

/** The panel's source files `entry` reaches through static imports of its own relative modules. */
function reachedFrom(entry: string): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [entry];
  for (const file of pending) {
    if (reached.has(file)) continue;
    reached.add(file);
    const source = readFileSync(path.join(SOURCE, file), "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2] ?? "";
      const target = path
        .join(path.dirname(file), specifier.replace(/\.js$/, ""))
        .split(path.sep)
        .join("/");
      for (const extension of [".tsx", ".ts"]) {
        try {
          readFileSync(path.join(SOURCE, target + extension));
          pending.push(target + extension);
          break;
        } catch {
          // Not this extension.
        }
      }
    }
  }
  return reached;
}

it("the app's static imports reach no settings page and no fixture's tasks", () => {
  const reached = reachedFrom("app.tsx");
  // The panel statically imports every page, so reaching it is reaching them all.
  assert.equal(reached.has("settings/settings-panel.tsx"), false);
  assert.equal(reached.has("tasks/tasks-fixture.ts"), false);
});
