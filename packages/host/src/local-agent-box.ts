import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { Effect, Exit } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import type { LocalAgentCommand } from "./effect/seams.js";

/**
 * local-agent-box.ts -- a local agent as a host runs it straight on the box: each of its processes started in its own folder as the host's own user, with its home, caches, and pnpm's and npm's global folders inside that folder, the box's one pnpm store and npm cache named in its home, the pinned `gh` first on its `PATH`, and its GitHub token where its `git` and `gh` read it, which the host rewrites as it renews.
 *
 * The agent's sessions, caches, and what a global install puts down stay
 * in its folder (`HOME`, `XDG_CACHE_HOME`, `PNPM_HOME`,
 * `NPM_CONFIG_PREFIX`), so they go with it and no two agents
 * share one. What its package managers fetch is the box's: pnpm's store
 * and npm's cache stand under the host's state, which no clearing of an
 * agent's folder reaches, so a second agent's install of the same lockfile
 * links what the first fetched. They are named in pnpm's and npm's own
 * settings in its home rather than its environment, since the one variable
 * pnpm 10 reads its store from has npm warn on every command, and Codex's
 * commands inherit only the core variables, `HOME` among them. Nothing hides the
 * box from it: it runs as the host's user, with full access to whatever
 * that user reaches.
 *
 * Its GitHub token is a file in its own home, gh's own config
 * (`hosts.yml` under `.config/gh`, which gh reads where `GH_CONFIG_DIR`
 * names nothing, as Codex's commands, which inherit only the core
 * variables, never name it), rewritten whole on every renewal; and its
 * repository's `git` reads the same token through gh's own credential
 * helper, set in the repository's config, so a renewal reaches a turn's
 * every later `git` and `gh`, a partial clone's lazy fetches among them,
 * with nothing restarted. `GH_TOKEN` is never set, since gh prefers it over
 * its config and a running agent would keep the first token past its
 * hour. A git run before the repository stands, as the repository's
 * script runs, names the same config and helper in its environment.
 *
 * An agent whose repository is reached on its starter's own token, which
 * never leaves the service for a device, is handed no token at all: it
 * reaches GitHub as whoever is signed in on the box
 * (`agentOwnSignInWritten`). Its home's Git settings include the box
 * user's own (`~/.gitconfig` and `~/.config/git/config`), so its `git`
 * reads their credential helper and their URL rewrites, and its gh config
 * folder is a link to the box user's own, so its `gh`, and gh's helper
 * where their Git names it, read their sign-in. SSH reads the box user's
 * `~/.ssh` whatever the agent's home is, and their agent where the host
 * hands its socket on. So such an agent holds the box user's whole GitHub
 * sign-in, every repository it reaches and not one alone, as anything they
 * run themselves does. Who its commits are by is set in its repository's own
 * config, which Git reads over the box user's.
 */

/** The folders under the agent's own its home and caches are kept in. */
const AGENT_FOLDER = { HOME: "home", CACHE: "cache" } as const;

/** Where under the agent's home pnpm and npm keep what a global install puts there, and gh its config. */
const HOME_FOLDER = { PNPM: ".local/share/pnpm", NPM: ".npm-global", GH: ".config/gh" } as const;

/** The folders under the host's state every agent on the box shares: pnpm's store and npm's cache, each safe for installs side by side. */
const BOX_FOLDER = {
  PNPM_STORE: "agent-packages/pnpm-store",
  NPM_CACHE: "agent-packages/npm-cache",
} as const;

/** Where under a home pnpm 10 and 11 alike read their own settings on each OS, where `XDG_CONFIG_HOME` names none, as it never does for Codex's commands (pnpm's `getConfigDir`). */
const PNPM_CONFIG_FOLDER = {
  [DEVICE_PLATFORM.DARWIN]: "Library/Preferences/pnpm",
  [DEVICE_PLATFORM.LINUX]: ".config/pnpm",
} as const satisfies Record<DevicePlatform, string>;

/** pnpm's settings files in its config folder: pnpm 10's ini `rc` and pnpm 11's `config.yaml`, each version reading its store from its own alone. */
const PNPM_FILE = { RC: "rc", CONFIG: "config.yaml" } as const;

/** npm's settings in a home. */
const NPMRC = ".npmrc";

/** Where under a home Git reads its global settings beside `.gitconfig` (`$XDG_CONFIG_HOME/git/config`, where that names none), which the box writes for an agent on the box's own sign-in, leaving `.gitconfig` the agent's own. */
const GIT_FILE = { GLOBAL: ".gitconfig", XDG: ".config/git/config" } as const;

/** gh's files in its config folder: its sign-ins, and its own settings, whose version keeps gh from migrating the sign-ins (`cli/cli`'s `internal/config/migration`). */
const GH_FILE = { HOSTS: "hosts.yml", CONFIG: "config.yml" } as const;

/** The settings gh is handed where its config folder holds none: the version its multi-account migration leaves, so it never asks GitHub who the token is. */
const GH_CONFIG = 'version: "1"\n';

/** The host GitHub's token is for, and the user gh and git name it under for an installation token. */
const GITHUB = { HOST: "github.com", USER: "x-access-token" } as const;

/** The git config key of the helper that answers for GitHub's HTTPS remotes. */
const CREDENTIAL_HELPER_KEY = "credential.https://github.com.helper";

/** The variable the repository's helper script reads the helper from, so no path is spliced into shell text. */
const HELPER_VARIABLE = "APP_GIT_CREDENTIAL_HELPER";

/**
 * What sets gh's helper in the agent's repository, run in it: any helper
 * before it emptied, so none of the box's own stands ahead of it, as `gh
 * auth setup-git` writes it into a file.
 */
export const AGENT_GIT_HELPER_SCRIPT = [
  "set -e",
  `git config --unset-all '${CREDENTIAL_HELPER_KEY}' || [ $? -eq 5 ]`,
  `git config --add '${CREDENTIAL_HELPER_KEY}' ''`,
  `git config --add '${CREDENTIAL_HELPER_KEY}' "$${HELPER_VARIABLE}"`,
].join("\n");

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The folder a path stands in, as `/` joins it. */
function parentOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf("/"), 1));
}

/** The agent's own folders, inside its folder: its home, its caches, and pnpm's and npm's global folders. */
export function agentFolders(folder: string) {
  const home = [folder, AGENT_FOLDER.HOME].join("/");
  return {
    home,
    cache: [folder, AGENT_FOLDER.CACHE].join("/"),
    pnpm: [home, HOME_FOLDER.PNPM].join("/"),
    npm: [home, HOME_FOLDER.NPM].join("/"),
    gh: [home, HOME_FOLDER.GH].join("/"),
  };
}

/**
 * A command run as the agent on the box, with the environment given: its
 * home and caches in its folder, and pnpm's and npm's global folders, then
 * the folder of the `gh` given, ahead of the `PATH` it was handed.
 */
export function agentOnBox(
  command: {
    readonly folder: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  },
  gh: string,
): LocalAgentCommand {
  const folders = agentFolders(command.folder);
  const path = [folders.pnpm, `${folders.npm}/bin`, parentOf(gh), command.env.PATH]
    .filter((each) => each !== undefined && each.length > 0)
    .join(":");
  return {
    command: command.command,
    args: command.args,
    env: {
      ...command.env,
      HOME: folders.home,
      XDG_CACHE_HOME: folders.cache,
      PNPM_HOME: folders.pnpm,
      NPM_CONFIG_PREFIX: folders.npm,
      PATH: path,
    },
  };
}

/** What of the box an agent's folders are made for: the host's state, under which its agents share their stores, and its OS, which names where pnpm reads its settings. */
export interface AgentBox {
  readonly stateRoot: string;
  readonly platform: DevicePlatform;
}

/**
 * The agent's home and caches made where they are not, so its first
 * command finds them, and the box's pnpm store and npm cache named in its
 * home: pnpm's store in both pnpm's settings files, and npm's cache in its
 * `.npmrc`, each written only where it stands nowhere, so whatever the
 * agent set there itself is kept. A value is quoted as JSON, which ini and
 * YAML both read, since the state root's path may hold a space.
 */
export const agentFoldersMade = (folder: string, box: AgentBox) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const folders = agentFolders(folder);
    for (const each of [folders.home, folders.cache]) {
      yield* fileSystem.makeDirectory(each, { recursive: true, mode: 0o700 });
    }
    const pnpmStore = JSON.stringify([box.stateRoot, BOX_FOLDER.PNPM_STORE].join("/"));
    const npmCache = JSON.stringify([box.stateRoot, BOX_FOLDER.NPM_CACHE].join("/"));
    const pnpmConfig = [folders.home, PNPM_CONFIG_FOLDER[box.platform]].join("/");
    yield* fileSystem.makeDirectory(pnpmConfig, { recursive: true, mode: 0o700 });
    const settings: [string, string][] = [
      [[folders.home, NPMRC].join("/"), `cache=${npmCache}\n`],
      [[pnpmConfig, PNPM_FILE.RC].join("/"), `store-dir=${pnpmStore}\n`],
      [[pnpmConfig, PNPM_FILE.CONFIG].join("/"), `storeDir: ${pnpmStore}\n`],
    ];
    for (const [file, contents] of settings) {
      if (!(yield* fileSystem.exists(file))) yield* replaced(file, contents);
    }
  });

/** A file written whole beside its place and moved over it, readable by the box's user alone, so gh, pnpm, or npm never reads half of one. */
const replaced = (target: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const writing = `${target}.writing`;
    yield* fileSystem.writeFileString(writing, contents, { mode: 0o600 });
    yield* fileSystem.chmod(writing, 0o600);
    yield* fileSystem.rename(writing, target);
  });

/**
 * The agent's GitHub token written where its `gh` and `git` read it, in gh's
 * config in its home, replacing the last, so a renewal needs no restart;
 * gh's settings written beside it where they stand nowhere yet. The token
 * is written as a YAML double-quoted scalar, which JSON's quoting is.
 */
export const agentGithubWritten = (
  folder: string,
  token: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const config = agentFolders(folder).gh;
    // Note that a link left by a launch on the box's own sign-in is taken away first, never written through, so a token never lands in the box user's own gh config.
    if (Exit.isSuccess(yield* Effect.exit(fileSystem.readLink(config)))) {
      yield* fileSystem.remove(config);
    }
    yield* fileSystem.makeDirectory(config, { recursive: true, mode: 0o700 });
    const quoted = JSON.stringify(token);
    yield* replaced(
      [config, GH_FILE.HOSTS].join("/"),
      [
        `${GITHUB.HOST}:`,
        "    users:",
        `        ${GITHUB.USER}:`,
        `            oauth_token: ${quoted}`,
        "    git_protocol: https",
        `    oauth_token: ${quoted}`,
        `    user: ${GITHUB.USER}`,
        "",
      ].join("\n"),
    );
    const settings = [config, GH_FILE.CONFIG].join("/");
    if (!(yield* fileSystem.exists(settings))) yield* replaced(settings, GH_CONFIG);
  });

/**
 * The agent's GitHub token let go of once no turn of its runs, its settings
 * kept. Note that an agent on the box's own sign-in has nothing to let go
 * of, because its gh config folder is a link to the box user's own
 * (`agentOwnSignInWritten`), whose sign-in nothing here ever removes.
 */
export const agentGithubForgotten = (folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const config = agentFolders(folder).gh;
    if (Exit.isSuccess(yield* Effect.exit(fileSystem.readLink(config)))) return;
    yield* fileSystem.remove([config, GH_FILE.HOSTS].join("/"), { force: true });
  }).pipe(Effect.ignore);

/** A path quoted as a Git config value, which reads backslash escapes inside double quotes. */
function gitQuoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The agent, whose repository is reached on its starter's own token, set to
 * reach GitHub on the box's own sign-in, in its home made before
 * (`agentFoldersMade`): its home's Git settings include the box user's own
 * from the box's home given, rewritten whole on every launch, with an empty
 * `.gitconfig` where it has none, so the agent's own `git config --global`
 * lands there rather than in what the next launch rewrites; and its gh
 * config folder a link to the box user's own, in place of anything a host
 * wrote there. A missing include is skipped by Git, and a link to a folder
 * not there yet reads as gh signed in to nothing.
 */
export const agentOwnSignInWritten = (
  folder: string,
  boxHome: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const folders = agentFolders(folder);
    const xdg = [folders.home, GIT_FILE.XDG].join("/");
    yield* fileSystem.makeDirectory(parentOf(xdg), { recursive: true, mode: 0o700 });
    yield* replaced(
      xdg,
      [
        "[include]",
        `\tpath = ${gitQuoted([boxHome, GIT_FILE.GLOBAL].join("/"))}`,
        `\tpath = ${gitQuoted([boxHome, GIT_FILE.XDG].join("/"))}`,
        "",
      ].join("\n"),
    );
    const own = [folders.home, GIT_FILE.GLOBAL].join("/");
    if (!(yield* fileSystem.exists(own))) yield* replaced(own, "");
    const target = [boxHome, HOME_FOLDER.GH].join("/");
    const linked = yield* Effect.exit(fileSystem.readLink(folders.gh));
    if (Exit.isSuccess(linked) && linked.value === target) return;
    // Note that a link is taken away without following it, so only the host's own copy of gh's settings, or a link to elsewhere, is removed.
    yield* fileSystem.remove(folders.gh, { recursive: true, force: true });
    yield* fileSystem.makeDirectory(parentOf(folders.gh), { recursive: true, mode: 0o700 });
    yield* fileSystem.symlink(target, folders.gh);
  });

/** The helper git asks for the agent's token: the `gh` given, reading its config. */
function helperOf(gh: string): string {
  return `!${shellQuoted(gh)} auth git-credential`;
}

/**
 * What a git run on the box for the agent adds to its environment to read
 * its token through the `gh` given, never naming it: gh's config folder and
 * its helper over git's environment-borne config, the empty helper first,
 * so no helper of the box's stands before it.
 */
export function agentGithubEnv(folder: string, gh: string): Readonly<Record<string, string>> {
  return {
    GH_CONFIG_DIR: agentFolders(folder).gh,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: CREDENTIAL_HELPER_KEY,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: CREDENTIAL_HELPER_KEY,
    GIT_CONFIG_VALUE_1: helperOf(gh),
  };
}

/** The variables `AGENT_GIT_HELPER_SCRIPT` reads, for the `gh` given. */
export function agentGitHelperEnv(gh: string): Readonly<Record<string, string>> {
  return { [HELPER_VARIABLE]: helperOf(gh) };
}
