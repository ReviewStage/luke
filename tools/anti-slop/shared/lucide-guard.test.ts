import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isDoorFile, LUCIDE_BASELINE, parseBaseline } from "./lucide-guard.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("the lucide baseline", () => {
  it("holds only files that exist, since the rule reads the files it lints and a deleted one leaves its row behind", () => {
    const missing = [...LUCIDE_BASELINE.keys()].filter(
      (file) => !existsSync(path.join(REPOSITORY_ROOT, file)),
    );
    expect(missing).toEqual([]);
  });

  it("holds no file of the door, which imports Lucide without being counted", () => {
    expect([...LUCIDE_BASELINE.keys()].filter(isDoorFile)).toEqual([]);
  });

  it("refuses a count that is not a whole number of imports", () => {
    expect(() => parseBaseline('{"a.ts": 0}')).toThrow();
    expect(() => parseBaseline('{"a.ts": 1.5}')).toThrow();
    expect(parseBaseline('{"a.ts": 2}').get("a.ts")).toBe(2);
  });
});
