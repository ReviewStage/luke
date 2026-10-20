/**
 * fixtures.test.ts -- the committed fixtures are already sanitized: sanitizing them again changes nothing, so no token, account, email, or real id is in them, whoever edited them last.
 *
 * Until the developer's live run records them, each holds a placeholder,
 * which this holds to the same rule.
 */

import { readFileSync } from "node:fs";
import { recordFromJsonLine, valueFromJsonText } from "@luke/wire";
import { describe, expect, it } from "vitest";
import { sanitizer } from "../src/sanitize.js";

const STREAM = new URL("../fixtures/claude-code-stream.jsonl", import.meta.url);
const REPORT = new URL("../fixtures/claude-code-probe-report.json", import.meta.url);

describe("the committed fixtures", () => {
  it("hold a stream whose every line is a sanitized record", () => {
    const lines = readFileSync(STREAM, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    const scrub = sanitizer({ secrets: [], replacements: [] });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const record = recordFromJsonLine(line);
      expect(record).toBeDefined();
      expect(scrub(record ?? null)).toEqual(record);
    }
  });

  it("hold a sanitized report", () => {
    const report = valueFromJsonText(readFileSync(REPORT, "utf8"));

    expect(sanitizer({ secrets: [], replacements: [] })(report)).toEqual(report);
  });
});
