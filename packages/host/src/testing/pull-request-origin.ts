/**
 * pull-request-origin.ts -- a repository on disk that stands in for GitHub in the run tests: commits made to order on its branches, the patches between them an agent's sandbox would send, and a pull request's head ref moved to any of them.
 *
 * Every Git it runs reads no system or global configuration and names its
 * own author, so a test holds the same on any machine. Synthetic files and
 * commits throughout.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GitTool } from "../pr-run-checkout.js";

/** The environment every fixture Git runs under. */
const FIXTURE_GIT_ENVIRONMENT = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@luke.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@luke.test",
} as const;

/** The Git the module under test runs, as a test hands it. */
export function fixtureGitTool(home: string): GitTool {
  return { path: "git", environment: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home } };
}

/** One Git run in `folder`, its standard output answered. */
export function fixtureGit(folder: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: folder,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...FIXTURE_GIT_ENVIRONMENT },
    encoding: "utf8",
  }).trim();
}

export interface PullRequestOrigin {
  readonly folder: string;
  /** The binary patch from one commit to another, as an agent's sandbox sends its work. */
  diff(from: string, to: string): Buffer;
  /** A branch made at the commit and checked out, where later commits land. */
  branch(name: string): void;
  /** A commit of the files given over the last one, answered by its id. */
  commit(files: Readonly<Record<string, string>>, message?: string): string;
  /** The pull request's head ref moved to the commit. */
  pointPullRequest(number: number, sha: string): void;
}

/** A fresh origin repository in `folder`, on a branch of its own. */
export function pullRequestOrigin(folder: string): PullRequestOrigin {
  mkdirSync(folder, { recursive: true });
  fixtureGit(folder, ["init", "--quiet", "--initial-branch=main"]);
  return {
    folder,
    diff: (from, to) =>
      execFileSync("git", ["diff", "--binary", from, to], {
        cwd: folder,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...FIXTURE_GIT_ENVIRONMENT },
      }),
    branch: (name) => {
      fixtureGit(folder, ["checkout", "--quiet", "-b", name]);
    },
    commit: (files, message = "change") => {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
        writeFileSync(path.join(folder, file), text);
      }
      fixtureGit(folder, ["add", "--all", "--force"]);
      fixtureGit(folder, ["commit", "--quiet", "--allow-empty", "-m", message]);
      return fixtureGit(folder, ["rev-parse", "HEAD"]);
    },
    pointPullRequest: (number, sha) => {
      fixtureGit(folder, ["update-ref", `refs/pull/${number}/head`, sha]);
    },
  };
}
