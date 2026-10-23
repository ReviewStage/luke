import { describe, expect, it } from "vitest";

import { baselineProblems, shrunkBaseline } from "./baseline.ts";

const counts = (entries: Record<string, number>): ReadonlyMap<string, number> =>
  new Map(Object.entries(entries));

describe("baselineProblems", () => {
  it("passes a file that holds exactly its baseline", () => {
    expect(baselineProblems(counts({ "a.css": 3 }), { "a.css": 3 }, true)).toEqual([]);
  });

  it("refuses a place past the baseline, and one in a file it does not name", () => {
    const problems = baselineProblems(counts({ "a.css": 4, "b.css": 1 }), { "a.css": 3 }, true);
    expect(problems.map(({ file, grew }) => [file, grew])).toEqual([
      ["a.css", true],
      ["b.css", true],
    ]);
  });

  it("refuses a baseline above what a file holds, so a fix lowers it", () => {
    const problems = baselineProblems(counts({ "a.css": 1 }), { "a.css": 3, "gone.css": 2 }, true);
    expect(problems.map(({ file, grew }) => [file, grew])).toEqual([
      ["a.css", false],
      ["gone.css", false],
    ]);
  });

  it("refuses any entry for a rule that started clean", () => {
    const problems = baselineProblems(counts({ "a.css": 1 }), { "a.css": 1 }, false);
    expect(problems.map(({ file, grew }) => [file, grew])).toEqual([
      ["a.css", false],
      ["a.css", true],
    ]);
  });

  it("refuses a count that is no whole number above 0", () => {
    expect(baselineProblems(counts({}), { "a.css": 0 }, true)).toHaveLength(1);
    expect(baselineProblems(counts({ "a.css": 1 }), { "a.css": 1.5 }, true)).toHaveLength(1);
  });
});

describe("shrunkBaseline", () => {
  it("lowers a count to what the file holds and drops a file at zero", () => {
    expect(shrunkBaseline(counts({ "b.css": 1 }), { "b.css": 3, "a.css": 2 })).toEqual({
      "b.css": 1,
    });
  });

  it("never raises a count or adds a file", () => {
    expect(shrunkBaseline(counts({ "a.css": 5, "new.css": 1 }), { "a.css": 2 })).toEqual({
      "a.css": 2,
    });
  });
});
