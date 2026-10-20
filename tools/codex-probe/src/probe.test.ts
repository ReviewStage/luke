import { describe, expect, it } from "vitest";
import { readGithubRepository } from "./probe.js";

describe("readGithubRepository", () => {
  it("takes an owner/name and refuses anything a shell or a URL could read as more", () => {
    expect(readGithubRepository("acme/throw-away.probe_1")).toBe("acme/throw-away.probe_1");
    expect(readGithubRepository(undefined)).toBeUndefined();
    for (const value of [
      "acme/x; rm -rf ~",
      "acme/$(id)",
      "acme",
      "acme/x/y",
      "acme/..",
      "-x/y z",
    ]) {
      expect(() => readGithubRepository(value)).toThrow("owner/name");
    }
  });
});
