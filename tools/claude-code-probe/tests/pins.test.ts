/**
 * pins.test.ts -- the repository the probe clones and opens its firewall to is exactly one GitHub repository named owner/name.
 */

import { describe, expect, it } from "vitest";
import { isRepositoryName } from "../src/pins.js";

describe("isRepositoryName", () => {
  it("takes GitHub's owner/name", () => {
    expect(isRepositoryName("octo-dev/scratch")).toBe(true);
    expect(isRepositoryName("octo-dev/scratch.repo_1")).toBe(true);
  });

  it("refuses anything that would reach another path or repository", () => {
    for (const text of [
      "octo-dev",
      "octo-dev/scratch/extra",
      "octo-dev/..",
      "octo-dev/scratch.git",
      "octo-dev/scratch?x=1",
      "https://github.com/octo-dev/scratch",
      "-octo/scratch",
      "octo-dev/scratch\n",
      "",
    ]) {
      expect(isRepositoryName(text)).toBe(false);
    }
  });
});
