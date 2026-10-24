// @vitest-environment jsdom

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ui from "@luke/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test, vi } from "vitest";
import { EXAMPLES } from "./examples.js";

/**
 * every-component-has-an-example.test.ts -- a component cannot join `@luke/ui`
 * without the catalog drawing it. The names are read off the barrel's own
 * exports and the coverage off the example files `examples.ts` registers, so
 * there is no list of components here to forget a name in; what is listed is
 * only what the reading cannot tell, each name with its reason.
 */

const SOURCE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(SOURCE, "examples.ts");

/** An import statement, whole; one of a relative module; one from the `@luke/ui` barrel, its braces' words captured. */
const IMPORT_STATEMENT = /^import[^;]*?from\s+"[^"]+";?$/gmu;
const NAMED_RELATIVE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s+"(\.[^"]*)";?$/gmu;
const RELATIVE_IMPORT = /^import[^;]*?from\s+"(\.[^"]*)";?$/gmu;
const UI_IMPORT = /^import\s*\{([^}]*)\}\s*from\s+"@luke\/ui";?$/gmu;

/**
 * PascalCase exports that are not drawable components, so no example could
 * draw them. Each is named with why. A name here that the barrel no longer
 * exports, or that an example now draws, fails the test: delete the row.
 */
const NOT_A_COMPONENT: Readonly<Record<string, string>> = {
  AvatarVoice: "draws one hidden <audio> element, which has nothing to look at",
  DisclosureFind: "a context provider: draws only its children",
  DisclosureScope: "a context provider: draws only its children",
  RevealArea: "a context provider: draws only its children",
};

/**
 * Components still drawn by no example. This list may only shrink: a
 * component never joins it, and one an example now draws leaves it.
 */
const AWAITING_AN_EXAMPLE: readonly string[] = [
  "MenuRowList",
  "RowHint",
  "RowHintOptions",
  "SettingsControlSkeleton",
  "SettingsPageSkeleton",
  "TooltipPill",
];

/** A glyph is named `…Icon`: the icons example draws every one the barrel exports, which the last test reads off its page. */
const GLYPH_SUFFIX = "Icon";

/** A component's name reads PascalCase; a constant is SCREAMING_SNAKE and a hook or helper is camelCase. */
const PASCAL_CASE = /^[A-Z][a-z0-9]/u;

/** The callable PascalCase names `@luke/ui` exports, glyphs aside. */
function exportedComponents(): readonly string[] {
  return exportedCallables().filter((name) => !name.endsWith(GLYPH_SUFFIX));
}

function exportedCallables(): readonly string[] {
  return Object.entries(ui)
    .filter(([name, value]) => PASCAL_CASE.test(name) && typeof value === "function")
    .map(([name]) => name)
    .sort();
}

/** `file`'s text with its comments taken out, so a name only a comment mentions is not drawn. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

/** The file a relative specifier from `from` names, which the catalog writes without its extension. */
function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/u, ""));
  return [`${base}.tsx`, `${base}.ts`].find((candidate) => existsSync(candidate));
}

/** The example files the registry lists: those whose example `EXAMPLES` names, and what those import beside them. */
function exampleFiles(): readonly string[] {
  const examplesDirectory = path.join(SOURCE, "examples") + path.sep;
  const registry = codeOf(REGISTRY);
  const listed = registry.replace(IMPORT_STATEMENT, "");
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const [, names, specifier] of registry.matchAll(NAMED_RELATIVE_IMPORT)) {
    const target = resolveRelative(REGISTRY, specifier ?? "");
    const named = (names ?? "").split(",").map((name) => name.trim());
    if (
      target === undefined ||
      !named.some((name) => new RegExp(`\\b${name}\\b`, "u").test(listed))
    )
      continue;
    seen.add(target);
    queue.push(target);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined) break;
    for (const [, specifier] of codeOf(file).matchAll(RELATIVE_IMPORT)) {
      const target = resolveRelative(file, specifier ?? "");
      if (target === undefined || !target.startsWith(examplesDirectory) || seen.has(target))
        continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

/** The `@luke/ui` names `file` imports and then draws, by the name the barrel exports them under. */
function drawnFrom(file: string): ReadonlySet<string> {
  const code = codeOf(file);
  const rest = code.replace(IMPORT_STATEMENT, "");
  const drawn = new Set<string>();
  for (const [, clause] of code.matchAll(UI_IMPORT)) {
    for (const part of (clause ?? "").split(",")) {
      if (/^\s*type\s/u.test(part)) continue;
      const [exported, local = exported] = part.trim().split(/\s+as\s+/u);
      if (exported === undefined || exported === "") continue;
      // Note that a component is drawn as a JSX tag, or handed on as a value.
      if (new RegExp(`<${local}[\\s/>.]|[{=(,:]\\s*${local}\\s*[,)}\\]]`, "u").test(rest))
        drawn.add(exported);
    }
  }
  return drawn;
}

/** Every `@luke/ui` name some registered example draws. */
function drawnByExamples(): ReadonlySet<string> {
  return new Set(exampleFiles().flatMap((file) => [...drawnFrom(file)]));
}

test("the examples are read from the registry's files", () => {
  assert.ok(exampleFiles().length > 50, "the registry's example files are found");
  assert.ok(drawnByExamples().has("Button"), "the reading finds a component the catalog draws");
});

test("every component @luke/ui exports has an example, or is named as exempt", () => {
  const drawn = drawnByExamples();
  const missing = exportedComponents().filter(
    (name) => !drawn.has(name) && !(name in NOT_A_COMPONENT) && !AWAITING_AN_EXAMPLE.includes(name),
  );
  assert.deepEqual(
    missing,
    [],
    "add an example to apps/catalog/src/examples.ts for each; a name that is no component goes in NOT_A_COMPONENT with its reason",
  );
});

test("the exemptions only shrink: each names an export that still lacks an example", () => {
  const drawn = drawnByExamples();
  const exported = new Set(exportedComponents());
  const stale = [...Object.keys(NOT_A_COMPONENT), ...AWAITING_AN_EXAMPLE].filter(
    (name) => !exported.has(name) || drawn.has(name),
  );
  assert.deepEqual(stale, [], "delete these rows: they are gone from the barrel or now drawn");
});

test("the icons example draws every glyph the barrel exports", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const icons = EXAMPLES.find((example) => example.id === "icons");
  assert.ok(icons, "the icons example is registered");
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(createElement(icons.Render)));
  const page = container.textContent ?? "";
  const undrawn = exportedCallables().filter(
    (name) => name.endsWith(GLYPH_SUFFIX) && !page.includes(name),
  );
  act(() => root.unmount());
  vi.unstubAllGlobals();
  assert.deepEqual(undrawn, []);
});
