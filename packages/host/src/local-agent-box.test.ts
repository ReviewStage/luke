/**
 * local-agent-box.test.ts -- an agent's folders as a host makes them on a real temporary folder: settings it wrote itself are kept, and an agent on the box's own GitHub sign-in reads the box user's Git and gh as real Git reads them, its commit identity its repository's own.
 */
import { execFileSync } from "node:child_process";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CHECKOUT_IDENTITY_SCRIPT, checkoutIdentityEnv } from "@repo/features/checkout-identity";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import {
  agentFolders,
  agentFoldersMade,
  agentGithubForgotten,
  agentOwnSignInWritten,
} from "./local-agent-box.js";

/** Who the box's user is in their own Git settings, and the credential helper they keep there. */
const BOX_GITCONFIG = [
  "[user]",
  "\tname = Box User",
  "\temail = box@example.test",
  "[credential]",
  "\thelper = box-helper",
  "",
].join("\n");

/** Who the agent's commits are by, as its launch line names it. */
const IDENTITY = { name: "Ada Lovelace", email: "7001+ada@users.noreply.github.com" };

/** The box user's gh sign-in, a synthetic one. */
const BOX_GH_HOSTS = "github.com:\n    user: box-user\n";

// Note that a test here runs real Git, which a macOS runner has taken past vitest's 5s default.
const GIT_DEADLINE = 30_000;

/** What an agent wrote into its own `.npmrc`, a registry of its project's. */
const OWN_NPMRC = "registry=https://npm.example.test/\n";

describe("an agent's folders made on the box", () => {
  it.effect("keep the .npmrc the agent wrote", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* temporaryDirectoryScoped("agent-box-");
      const home = `${root}/agent/home`;
      yield* fileSystem.makeDirectory(home, { recursive: true });
      yield* fileSystem.writeFileString(`${home}/.npmrc`, OWN_NPMRC);

      yield* agentFoldersMade(`${root}/agent`, {
        stateRoot: `${root}/state`,
        platform: DEVICE_PLATFORM.LINUX,
      });

      expect(yield* fileSystem.readFileString(`${home}/.npmrc`)).toBe(OWN_NPMRC);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );
});

describe("an agent on the box's own GitHub sign-in", () => {
  it.effect(
    "reads the box user's Git settings and gh sign-in, its repository's commit identity winning, and keeps their sign-in when its turn is let go of",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* temporaryDirectoryScoped("agent-box-own-");
        const boxHome = `${root}/box`;
        const folder = `${root}/agent`;
        yield* fileSystem.makeDirectory(`${boxHome}/.config/gh`, { recursive: true });
        yield* fileSystem.writeFileString(`${boxHome}/.gitconfig`, BOX_GITCONFIG);
        yield* fileSystem.writeFileString(`${boxHome}/.config/gh/hosts.yml`, BOX_GH_HOSTS);
        yield* agentFoldersMade(folder, {
          stateRoot: `${root}/state`,
          platform: DEVICE_PLATFORM.LINUX,
        });

        yield* agentOwnSignInWritten(folder, boxHome);

        const repository = `${root}/repository`;
        yield* fileSystem.makeDirectory(repository);
        const env = {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: agentFolders(folder).home,
          GIT_CONFIG_NOSYSTEM: "1",
        };
        const git = (args: readonly string[]) =>
          execFileSync("git", args, { cwd: repository, env, encoding: "utf8" }).trim();
        git(["init", "--quiet"]);
        execFileSync("/bin/bash", ["-c", CHECKOUT_IDENTITY_SCRIPT], {
          cwd: repository,
          env: { ...env, ...checkoutIdentityEnv(IDENTITY) },
        });
        expect(git(["config", "user.name"])).toBe(IDENTITY.name);
        expect(git(["config", "user.email"])).toBe(IDENTITY.email);
        expect(git(["config", "credential.helper"])).toBe("box-helper");
        expect(yield* fileSystem.readFileString(`${agentFolders(folder).gh}/hosts.yml`)).toBe(
          BOX_GH_HOSTS,
        );

        yield* agentGithubForgotten(folder);

        expect(yield* fileSystem.readFileString(`${boxHome}/.config/gh/hosts.yml`)).toBe(
          BOX_GH_HOSTS,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    GIT_DEADLINE,
  );
});
