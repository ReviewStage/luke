import { describe, expect, it } from "vitest";

import { listProblems } from "./anti-slop-lists.ts";

describe("listProblems", () => {
  it("names a row for a file that is gone, and a file two lists that must stay apart share", () => {
    const baseline = { name: "baseline.json", paths: ["a.ts", "gone.ts"] };
    const allowed = { name: "allowed.json", paths: ["a.ts"] };
    expect(
      listProblems([baseline, allowed], (file) => file !== "gone.ts", [[baseline, allowed]]),
    ).toEqual([
      "baseline.json: gone.ts does not exist; delete its row",
      "a.ts is on both baseline.json and allowed.json",
    ]);
  });
});
