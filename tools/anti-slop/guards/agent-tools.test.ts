import { describe, expect, it } from "vitest";

import { keptLocals, packagesImported, undeclared } from "./agent-tools.ts";
import { setDrift } from "./guard.ts";

describe("the coding agent's tool checks", () => {
  it("name a tool file the registry lacks and a registered tool no file offers", () => {
    expect(setDrift("tools", ["bash", "nap"], ["bash", "sleep"])).toEqual([
      "tools: nap is not expected",
      "tools: sleep is missing",
    ]);
  });

  it("read the packages a bundle imports by their directory under node_modules", () => {
    const code = [
      'import { drizzle } from "/repo/node_modules/.pnpm/drizzle-orm@1/node_modules/drizzle-orm/index.js";',
      'import "/repo/node_modules/@scope/pkg/dist/x.js";',
      'const lazy = await import("ws");',
    ].join("\n");
    expect([...packagesImported(code)].sort()).toEqual(["@scope/pkg", "drizzle-orm", "ws"]);
  });

  it("read the locals eve keeps beside a hoisted callback", () => {
    expect(
      keptLocals("const { tool } = __vars;\nconst run = 1;\nconst { a, b } = __vars;"),
    ).toEqual(["{ tool }", "{ a, b }"]);
  });

  it("name an external dependency the agent's manifest does not declare", () => {
    expect(undeclared(["pg", "ws"], { pg: "8.0.0" })).toEqual(["ws"]);
  });
});
