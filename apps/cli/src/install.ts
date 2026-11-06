import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

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

const CURL_RELEASES = [".local", "share", "vespin-cli", "versions"] as const;

const CURL_LINK = [".local", "bin", "vespin"] as const;

const PACKAGE_FOLDER = `${sep}node_modules${sep}vespin${sep}`;

const PACKAGE_MANAGER_MARKS = [
  { mark: `${sep}_npx${sep}`, kind: INSTALL_KIND.NPX },
  { mark: `${sep}.bun${sep}`, kind: INSTALL_KIND.BUN },
  { mark: `${sep}pnpm${sep}`, kind: INSTALL_KIND.PNPM },
  { mark: `${sep}yarn${sep}`, kind: INSTALL_KIND.YARN },
] as const;

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

function resolvedHome(): string {
  try {
    return realpathSync(homedir());
  } catch {
    return homedir();
  }
}

export function curlReleases(): string {
  return `${join(resolvedHome(), ...CURL_RELEASES)}${sep}`;
}

export function curlLink(): string {
  return join(homedir(), ...CURL_LINK);
}

function bundlePath(): string | undefined {
  const entry = process.argv[1];
  if (entry === undefined) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return undefined;
  }
}

export function installKind(): InstallKind {
  const path = bundlePath();
  if (path === undefined) return INSTALL_KIND.SOURCE;
  if (path.startsWith(curlReleases())) return INSTALL_KIND.CURL;
  if (!path.includes(PACKAGE_FOLDER)) return INSTALL_KIND.SOURCE;
  return PACKAGE_MANAGER_MARKS.find((each) => path.includes(each.mark))?.kind ?? INSTALL_KIND.NPM;
}
