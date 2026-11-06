import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { Effect, Exit } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import type { LocalAgentCommand } from "./effect/seams.js";

const AGENT_FOLDER = { HOME: "home", CACHE: "cache" } as const;

const HOME_FOLDER = { PNPM: ".local/share/pnpm", NPM: ".npm-global", GH: ".config/gh" } as const;

const BOX_FOLDER = {
  PNPM_STORE: "agent-packages/pnpm-store",
  NPM_CACHE: "agent-packages/npm-cache",
} as const;

const PNPM_CONFIG_FOLDER = {
  [DEVICE_PLATFORM.DARWIN]: "Library/Preferences/pnpm",
  [DEVICE_PLATFORM.LINUX]: ".config/pnpm",
} as const satisfies Record<DevicePlatform, string>;

const PNPM_FILE = { RC: "rc", CONFIG: "config.yaml" } as const;

const NPMRC = ".npmrc";

const GIT_FILE = { GLOBAL: ".gitconfig", XDG: ".config/git/config" } as const;

const GH_FILE = { HOSTS: "hosts.yml", CONFIG: "config.yml" } as const;

const GH_CONFIG = 'version: "1"\n';

const GITHUB = { HOST: "github.com", USER: "x-access-token" } as const;

const CREDENTIAL_HELPER_KEY = "credential.https://github.com.helper";

const HELPER_VARIABLE = "APP_GIT_CREDENTIAL_HELPER";

export const AGENT_GIT_HELPER_SCRIPT = [
  "set -e",
  `git config --unset-all '${CREDENTIAL_HELPER_KEY}' || [ $? -eq 5 ]`,
  `git config --add '${CREDENTIAL_HELPER_KEY}' ''`,
  `git config --add '${CREDENTIAL_HELPER_KEY}' "$${HELPER_VARIABLE}"`,
].join("\n");

function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

function parentOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf("/"), 1));
}

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

export interface AgentBox {
  readonly stateRoot: string;
  readonly platform: DevicePlatform;
}

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

const replaced = (target: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const writing = `${target}.writing`;
    yield* fileSystem.writeFileString(writing, contents, { mode: 0o600 });
    yield* fileSystem.chmod(writing, 0o600);
    yield* fileSystem.rename(writing, target);
  });

export const agentGithubWritten = (
  folder: string,
  token: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const config = agentFolders(folder).gh;
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

export const agentGithubForgotten = (folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const config = agentFolders(folder).gh;
    if (Exit.isSuccess(yield* Effect.exit(fileSystem.readLink(config)))) return;
    yield* fileSystem.remove([config, GH_FILE.HOSTS].join("/"), { force: true });
  }).pipe(Effect.ignore);

function gitQuoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

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
    yield* fileSystem.remove(folders.gh, { recursive: true, force: true });
    yield* fileSystem.makeDirectory(parentOf(folders.gh), { recursive: true, mode: 0o700 });
    yield* fileSystem.symlink(target, folders.gh);
  });

function helperOf(gh: string): string {
  return `!${shellQuoted(gh)} auth git-credential`;
}

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

export function agentGitHelperEnv(gh: string): Readonly<Record<string, string>> {
  return { [HELPER_VARIABLE]: helperOf(gh) };
}
