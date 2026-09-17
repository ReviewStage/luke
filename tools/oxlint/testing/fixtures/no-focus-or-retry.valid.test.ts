import { describe, expect, it } from "vitest";

const noMac = process.platform !== "darwin";

describe("suite", () => {
  it.skipIf(noMac)("needs a Mac", () => {
    expect(1).toBe(1);
  });
  it(
    "has a timeout, which is not a retry",
    () => {
      expect(1).toBe(1);
    },
    { timeout: 100 },
  );
});
