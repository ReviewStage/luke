/**
 * install.ts -- how this `vespin` was installed, read off the bundle's own real path, and how each kind of install is updated.
 *
 * A curl install (the install script's `cli` mode, `apps/web/install/install.sh`)
 * runs the bundle from a release folder under
 * `~/.local/share/vespin-cli/versions/`, its launcher handing it that real
 * path (`scripts/vespin.sh`), and updates itself by running that script
 * again. A package manager's install runs it from a `node_modules/vespin`
 * folder, and is that package manager's to update, so `vespin update` only
 * says the command. Anything else, such as a build run from a checkout, is a
 * source install, updated by building it again.
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Each kind of install `vespin version` names. */
export const INSTALL_KIND = {
  CURL: "curl",
  NPX: "npx",
  NPM: "npm",
  PNPM: "pnpm",
  YARN: "yarn",
  BUN: "bun",
  SOURCE: "source",
} as const;

export type InstallKind = (typeof INSTALL_KIND)[keyof typeof INSTALL_KIND];

/** A curl install's releases, under the home, as the install script names them. */
const CURL_RELEASES = [".local", "share", "vespin-cli", "versions"] as const;

/** A curl install's command, under the home, as the install script links it. */
const CURL_LINK = [".local", "bin", "vespin"] as const;

/** The folder npm and its peers install the package in. */
const PACKAGE_FOLDER = `${sep}node_modules${sep}vespin${sep}`;

/** A folder each package manager keeps its global or one-off installs under, by the kind it marks, first match wins. */
const PACKAGE_MANAGER_MARKS = [
  { mark: `${sep}_npx${sep}`, kind: INSTALL_KIND.NPX },
  { mark: `${sep}.bun${sep}`, kind: INSTALL_KIND.BUN },
  { mark: `${sep}pnpm${sep}`, kind: INSTALL_KIND.PNPM },
  { mark: `${sep}yarn${sep}`, kind: INSTALL_KIND.YARN },
] as const;

/** What updates each kind of install that `vespin update` does not update itself. */
export const UPDATE_COMMAND: Readonly<
  Record<Exclude<InstallKind, typeof INSTALL_KIND.CURL>, string>
> = {
  [INSTALL_KIND.NPX]: "npx vespin@latest",
  [INSTALL_KIND.NPM]: "npm i -g vespin@latest",
  [INSTALL_KIND.PNPM]: "pnpm add -g vespin@latest",
  [INSTALL_KIND.YARN]: "yarn global add vespin@latest",
  [INSTALL_KIND.BUN]: "bun add -g vespin@latest",
  [INSTALL_KIND.SOURCE]: "pnpm --filter @repo/vespin-cli build",
};

/** A curl install's releases folder, ending in the separator, under this account's home. */
export function curlReleases(): string {
  return `${join(homedir(), ...CURL_RELEASES)}${sep}`;
}

/** A curl install's command link, under this account's home. */
export function curlLink(): string {
  return join(homedir(), ...CURL_LINK);
}

/** The real path of the bundle this process runs, or none where it cannot be read. */
function bundlePath(): string | undefined {
  const entry = process.argv[1];
  if (entry === undefined) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return undefined;
  }
}

/** How this `vespin` was installed, by where its bundle really stands. */
export function installKind(): InstallKind {
  const path = bundlePath();
  if (path === undefined) return INSTALL_KIND.SOURCE;
  if (path.startsWith(curlReleases())) return INSTALL_KIND.CURL;
  if (!path.includes(PACKAGE_FOLDER)) return INSTALL_KIND.SOURCE;
  return PACKAGE_MANAGER_MARKS.find((each) => path.includes(each.mark))?.kind ?? INSTALL_KIND.NPM;
}
