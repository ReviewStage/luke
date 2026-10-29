/**
 * state.test.ts -- an agent's state as `state pack`, `verify` and `restore` keep it: every kind of work comes back in a repository made at the remote commit it sits on, a credential file never enters a pack, and a state over the cap is refused.
 *
 * Each test builds its own world in a temporary folder: a bare repository
 * standing in for GitHub, and an agent's folder whose repository is made
 * from it the way a device makes one, a partial clone of a remote head.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectory } from "@luke/wire/testing";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { STATE_CAP_BYTES } from "./protocol.js";
import { packState, restoreState, verifyState } from "./state.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Agent",
  GIT_AUTHOR_EMAIL: "agent@example.com",
  GIT_COMMITTER_NAME: "Agent",
  GIT_COMMITTER_EMAIL: "agent@example.com",
} as const;

/** A secret's bytes, which must appear nowhere in a pack. */
const SECRET = "sk-ant-oat01-never-packed";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Keeps every git, the code's and the test's, off the machine's own config. */
function ownGit(): void {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
}

function write(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** A bare repository standing in for GitHub, its `main` one commit: a file, a folder, an executable script. */
function remoteRepository(root: string): string {
  const seed = join(root, "seed");
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "init", "-q", "-b", "main", seed);
  write(join(seed, "README.md"), "hello\n");
  write(join(seed, "src/app.ts"), "export const app = 1;\n");
  write(join(seed, "src/old.ts"), "export const old = 1;\n");
  write(join(seed, "run.sh"), "#!/bin/sh\necho run\n");
  chmodSync(join(seed, "run.sh"), 0o755);
  write(join(seed, ".gitignore"), "*.log\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "first");
  git(seed, "push", "-q", remote, "main");
  return remote;
}

/** The agent's repository made from the remote as a device makes it: partial, its head fetched, checked out detached. */
function madeRepository(remote: string, repository: string, head: string): void {
  mkdirSync(repository, { recursive: true });
  git(repository, "init", "-q");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "config", "core.repositoryformatversion", "1");
  git(repository, "config", "extensions.partialClone", "origin");
  git(repository, "config", "remote.origin.promisor", "true");
  git(repository, "config", "remote.origin.partialCloneFilter", "blob:none");
  git(
    repository,
    "config",
    "remote.origin.uploadpack",
    "git -c uploadpack.allowFilter=true -c uploadpack.allowAnySHA1InWant=true upload-pack",
  );
  git(
    repository,
    "fetch",
    "-q",
    "--no-tags",
    "--filter=blob:none",
    "origin",
    `+${head}:refs/remotes/origin/main`,
  );
  git(repository, "checkout", "-q", "--detach", "refs/remotes/origin/main");
}

/** How a path of a folder reads: missing, a link and its target, or a file's executable bit and bytes. */
function read(path: string): string {
  if (!existsSync(path) && !isLink(path)) return "missing";
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return `link ${readlinkSync(path)}`;
  return `${(info.mode & 0o111) === 0 ? "-" : "x"} ${readFileSync(path).toString("base64")}`;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

const provided = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
  effect.pipe(Effect.provide(NodeServices.layer));

// Note that this case runs some sixty git commands, which takes a few seconds on CI; one case holding every kind of work is cheaper than one per kind.
it.effect(
  "restores every kind of work, and verify refuses a pack the folder has moved on from",
  (ctx) =>
    provided(
      Effect.gen(function* () {
        ownGit();
        const root = yield* Effect.promise(() => temporaryDirectory(ctx, "luke-state-"));
        const remote = remoteRepository(root);
        const base = git(remote, "rev-parse", "main").trim();
        const agent = join(root, "agent");
        const repository = join(agent, "repository");
        madeRepository(remote, repository, "refs/heads/main");

        // Commits not on the remote, on a branch with an upstream, a second branch, and a tag.
        git(repository, "switch", "-q", "-c", "work");
        git(repository, "branch", "-q", "--set-upstream-to=origin/main");
        write(join(repository, "src/app.ts"), "export const app = 2;\n");
        write(join(repository, "logo.bin"), new Uint8Array([0, 255, 1, 254, 0, 0, 7]));
        symlinkSync("src/app.ts", join(repository, "app-link"));
        git(repository, "add", "-A");
        git(repository, "commit", "-q", "-m", "second");
        git(repository, "tag", "-a", "-m", "mine", "local-tag");
        git(repository, "branch", "-q", "side", "HEAD~1");
        // Two stashes, one with an untracked file.
        write(join(repository, "README.md"), "stashed\n");
        git(repository, "stash", "push", "-q", "-m", "first stash");
        write(join(repository, "stashed-new.txt"), "untracked in a stash\n");
        git(repository, "stash", "push", "-q", "-u", "-m", "second stash");
        // Staged, then edited again; an unstaged edit; a staged deletion and an unstaged one.
        write(join(repository, "src/app.ts"), "export const app = 3;\n");
        git(repository, "add", "src/app.ts");
        write(join(repository, "src/app.ts"), "export const app = 4;\n");
        write(join(repository, "README.md"), "edited\n");
        git(repository, "rm", "-q", "src/old.ts");
        rmSync(join(repository, "run.sh"));
        // Untracked: a file, an executable, a link, a binary; and a file Git ignores.
        write(join(repository, "notes/todo.md"), "untracked\n");
        write(join(repository, "tool.sh"), "#!/bin/sh\n");
        chmodSync(join(repository, "tool.sh"), 0o755);
        symlinkSync("../README.md", join(repository, "notes/readme-link"));
        write(join(repository, "notes/blob.bin"), new Uint8Array([9, 0, 9, 0, 255]));
        write(join(repository, "debug.log"), "ignored\n");
        // The harnesses' session files and an attachment.
        const carried = [
          "home/.claude/projects/-work/session.jsonl",
          "home/.claude/tasks/session/1.json",
          "home/.codex/sessions/2026/10/29/rollout-thread.jsonl",
          "home/.codex/thread_history_1.sqlite",
          "attachments/line/picture.png",
        ];
        for (const path of carried) write(join(agent, path), `${path}\n`);

        const pack = join(root, "state.tar.zst");
        yield* packState(agent, pack);
        yield* verifyState(agent, pack);

        const fresh = join(root, "fresh");
        madeRepository(remote, join(fresh, "repository"), base);
        yield* restoreState(fresh, pack);

        const restored = join(fresh, "repository");
        const same = (...args: string[]) =>
          assert.equal(git(restored, ...args), git(repository, ...args), args.join(" "));
        same("status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all");
        same(
          "for-each-ref",
          "--format=%(refname) %(objectname)",
          "refs/heads",
          "refs/tags",
          "refs/remotes",
        );
        same("symbolic-ref", "HEAD");
        same("stash", "list", "--format=%H %gs");
        same("ls-files", "-s");
        for (const path of [
          "src/app.ts",
          "README.md",
          "logo.bin",
          "app-link",
          "src/old.ts",
          "run.sh",
        ]) {
          assert.equal(read(join(restored, path)), read(join(repository, path)), path);
        }
        for (const path of ["notes/todo.md", "tool.sh", "notes/readme-link", "notes/blob.bin"]) {
          assert.equal(read(join(restored, path)), read(join(repository, path)), path);
        }
        assert.equal(read(join(restored, "debug.log")), "missing");
        for (const path of carried)
          assert.equal(read(join(fresh, path)), read(join(agent, path)), path);

        write(join(repository, "notes/later.md"), "written after the pack\n");
        const refused = yield* Effect.flip(verifyState(agent, pack));
        assert.equal(refused._tag, "StateFailed");
      }),
    ),
);

it.effect("never packs a credential file or a gh sign-in beside the session files", (ctx) =>
  provided(
    Effect.gen(function* () {
      ownGit();
      const agent = yield* Effect.promise(() => temporaryDirectory(ctx, "luke-state-"));
      write(join(agent, "home/.claude/projects/-work/session.jsonl"), "{}\n");
      write(join(agent, "home/.codex/sessions/rollout.jsonl"), "{}\n");
      for (const path of [
        "home/.claude/.credentials.json",
        "home/.claude/oauth.json",
        "home/.netrc",
        "home/.claude/projects/-work/.credentials.json",
        "home/.codex/auth.json",
        "home/.codex/sessions/auth.json",
        "home/.config/gh/hosts.yml",
        "gh/hosts.yml",
        "attachments/line/gh/hosts.yml",
      ]) {
        write(join(agent, path), SECRET);
      }

      const pack = join(agent, "state.tar.zst");
      yield* packState(agent, pack);

      const unpacked = zstdDecompressSync(readFileSync(pack));
      assert.equal(unpacked.includes(SECRET), false);
      assert.equal(unpacked.includes("session.jsonl"), true);
    }),
  ),
);

it.effect("refuses a state over the cap, naming its largest part, and writes no pack", (ctx) =>
  provided(
    Effect.gen(function* () {
      ownGit();
      const agent = yield* Effect.promise(() => temporaryDirectory(ctx, "luke-state-"));
      write(join(agent, "home/.claude/projects/-work/session.jsonl"), "{}\n");
      write(join(agent, "attachments/line/huge.bin"), "");
      truncateSync(join(agent, "attachments/line/huge.bin"), STATE_CAP_BYTES + 1);

      const pack = join(agent, "state.tar.zst");
      const refused = yield* Effect.flip(packState(agent, pack));

      assert.equal(refused._tag, "StateTooLarge");
      assert.match(refused.detail, /attachments\/line/u);
      assert.equal(existsSync(pack), false);
    }),
  ),
);
