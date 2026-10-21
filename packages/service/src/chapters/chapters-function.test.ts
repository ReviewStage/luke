import { CHAPTER_GENERATION_STALE_MS } from "@luke/database/models/pull-request-chapters-store";
import { Duration } from "effect";
import { expect, it } from "vitest";
import { PULL_REQUEST_CHAPTERS_FUNCTION } from "./chapters-function.js";
import { CHAPTERS_BOUNDS } from "./chapters-generator.js";

/**
 * chapters-function.test.ts -- the chapters' function outlasts the generation it runs and ends before its claim goes stale.
 */

it("the chapters' function runs longer than a generation may take and ends before its claim may be taken over", () => {
  const runs = Duration.seconds(PULL_REQUEST_CHAPTERS_FUNCTION.MAX_DURATION_SECONDS);
  expect(Duration.isGreaterThan(runs, CHAPTERS_BOUNDS.TIMEOUT)).toBe(true);
  expect(Duration.toMillis(runs)).toBeLessThan(CHAPTER_GENERATION_STALE_MS);
});
