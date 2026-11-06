import { describe, expect, it } from "vitest";
import { githubRepositoryOfRemote } from "./cli-git-remote.js";

describe("githubRepositoryOfRemote", () => {
  it.each([
    ["git@github.com:acme/app.git", "acme/app"],
    ["github.com:acme/app", "acme/app"],
    ["ssh://git@github.com:22/acme/app.git", "acme/app"],
    ["https://github.com/acme/app.js.git", "acme/app.js"],
    ["https://someone@github.com/acme/app/", "acme/app"],
    ["git://github.com/acme/app", "acme/app"],
  ])("reads %s as %s", (remote, repository) => {
    expect(githubRepositoryOfRemote(remote)).toBe(repository);
  });

  it.each([
    "git@gitlab.com:acme/app.git",
    "https://github.com/acme",
    "/home/someone/app",
    "file:///home/someone/github.com/acme/app",
  ])("names no repository for %s", (remote) => {
    expect(githubRepositoryOfRemote(remote)).toBeUndefined();
  });
});
