import { describe, expect, it, test } from "vitest";

// biome-ignore lint/suspicious/noFocusedTests: the fixture shows the shape the rule refuses
describe.only("focused suite", () => {
  it.skip("skipped", () => {});
  test.todo("later");
  it.effect.skip("skipped effect", () => {});
  it(
    "retried",
    () => {
      expect(1).toBe(1);
    },
    { retry: 3 },
  );
  describe("retried suite", { retry: 2 }, () => {});
});
