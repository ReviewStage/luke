import { describe, expect, it } from "vitest";

import { fixtureProblems } from "./probe-fixtures.ts";

describe("fixtureProblems", () => {
  it("names what the probe's leak guard finds, and the lines its sanitizer would still change", () => {
    const fixtures = [
      { file: "stream.jsonl", text: '{"path":"/Users/someone/x"}\n{"ok":1}\n' },
      { file: "report.json", text: '{"token":"leaked"}' },
    ];
    const findLeaks = (text: string) => (text.includes("leaked") ? ["a token"] : []);
    const scrub = (value: unknown) =>
      JSON.parse(JSON.stringify(value).replace("/Users/someone", "~")) as unknown;
    expect(fixtureProblems(fixtures, findLeaks, scrub)).toEqual([
      "stream.jsonl: 1 value(s) the probe's sanitizer would still change",
      "report.json: the probe's leak guard names a token",
    ]);
  });
});
