import { describe, expect, it } from "vitest";

import { reachedFrom } from "./launch-bundle.ts";
import { moduleRecord } from "./module-graph.ts";

const SOURCES: Readonly<Record<string, string>> = {
  "app.tsx": [
    'import { shell } from "./shell.js";',
    'import type { Settings } from "./settings.js";',
    'const fixture = () => import("./fixture.js");',
  ].join("\n"),
  "shell.tsx": 'export * from "./pages.js";',
  "pages.ts": 'import "./page.js";',
  "page.ts": "export const page = 1;",
  "settings.tsx": "export type Settings = {};",
  "fixture.ts": "export const fixture = 1;",
};

describe("reachedFrom", () => {
  it("follows static value imports and re-exports, and neither a type-only import nor import()", () => {
    const reached = reachedFrom(
      "app.tsx",
      (file) => moduleRecord(file, SOURCES[file] ?? ""),
      (_, specifier) =>
        Object.keys(SOURCES).find((file) => `./${file.replace(/\.tsx?$/u, ".js")}` === specifier),
    );
    expect([...reached.keys()].sort()).toEqual(["app.tsx", "page.ts", "pages.ts", "shell.tsx"]);
    expect(reached.get("page.ts")).toEqual(["app.tsx", "shell.tsx", "pages.ts", "page.ts"]);
  });
});
