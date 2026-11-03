/**
 * host-release.ts -- the host daemon's release the install script serves: its version and each tarball's SHA-256, and where CI publishes them.
 *
 * CI builds one tarball per platform and architecture a host runs on and
 * publishes them to a GitHub release of their own, tagged `host-v<version>`
 * (`.github/workflows/release-host.yml`, `apps/host/scripts/package.ts`),
 * never marked the repository's latest, since the desktop's download link
 * and its updater read that one. The web app serves the install script with
 * the release named here written into it
 * (`packages/service/src/agents/host-install-script-app.ts`), which checks the
 * tarball it downloads against the digest it carries before
 * anything of it is installed. A release moves `HOST_RELEASE` whole, its
 * digests read off the release CI published, as a tool's pin moves
 * (`@luke/agent-runner/pins`).
 *
 * The host's program was named `luke-host` through 0.6.0 and is
 * `vespin-host` from `HOST_RENAMED_IN` on, its tarballs among it. A host
 * through 0.6.0 updates itself with the code it shipped with, which fetches a
 * release by the old name, unpacks its one `luke-host/` folder, and runs its
 * `bin/luke-host`, so every release from the rename on keeps all three
 * (`apps/host/scripts/package.ts`) until the host floor passes 0.6.0.
 */

/** The repository whose releases carry the host's tarballs. */
const RELEASE_REPOSITORY = "ReviewStage/vespin";

/** The first release whose program, command, and tarballs are named `vespin-host` rather than `luke-host`. */
export const HOST_RENAMED_IN = "0.7.0";

/** What a release's tarballs are named by, before the rename and from it on. */
const TARBALL_PREFIX = { BEFORE_RENAME: "luke-host", RENAMED: "vespin-host" } as const;

/** A daemon's version, as `MAJOR.MINOR.PATCH` with no leading zeros. */
const HOST_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;

/** Each platform and architecture the host is released for, as its tarball's name spells it. */
export const HOST_TARGET = {
  LINUX_X64: "linux-x64",
  LINUX_ARM64: "linux-arm64",
  DARWIN_ARM64: "darwin-arm64",
} as const;

export type HostTarget = (typeof HOST_TARGET)[keyof typeof HOST_TARGET];

/**
 * A published release of the host daemon: its version, and each target's
 * tarball by its SHA-256 in hex. A Mac's is optional, since the releases
 * before the first Mac package (`host-v0.1.0`) carry none.
 */
export interface HostRelease {
  readonly VERSION: string;
  readonly SHA256: {
    readonly [HOST_TARGET.LINUX_X64]: string;
    readonly [HOST_TARGET.LINUX_ARM64]: string;
    readonly [HOST_TARGET.DARWIN_ARM64]?: string;
  };
}

/**
 * The release the install script installs; none until the first is
 * published, and the script served meanwhile says there is none yet.
 */
export const HOST_RELEASE: HostRelease | undefined = {
  VERSION: "0.6.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "38cad2e94244b58b143a5b1b63bf977166b33e04fed41dbefe315089367d6090",
    [HOST_TARGET.LINUX_ARM64]: "b53686afc632f6333845b47011f2ad1c17cc8ee6f1b7f52c379dc849f94cf2fd",
    [HOST_TARGET.DARWIN_ARM64]: "502b819af8d551103ab331a9f00fef44053f0087315111dc46435dea67079fcc",
  },
};

/** A daemon's version as its three numbers, or nothing where it is not `MAJOR.MINOR.PATCH`. */
export function readHostVersion(version: string): readonly [number, number, number] | undefined {
  const parts = HOST_VERSION.exec(version.trim());
  if (parts === null) return undefined;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/** Whether the version given is at or past the floor given, both `MAJOR.MINOR.PATCH`; a version that does not read is below any floor. */
export function hostVersionMeets(version: string, floor: string): boolean {
  const read = readHostVersion(version);
  const wanted = readHostVersion(floor);
  if (read === undefined || wanted === undefined) return false;
  for (let place = 0; place < 3; place += 1) {
    const [have, need] = [read[place] ?? 0, wanted[place] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

/** Whether the release of the version given names its program `vespin-host`. */
export function hostRenamed(version: string): boolean {
  return hostVersionMeets(version, HOST_RENAMED_IN);
}

/** The release's tag, apart from the desktop's `v<version>`. */
export function hostReleaseTag(version: string): string {
  return `host-v${version}`;
}

/** One target's tarball, by the file name a host fetches it by (`hostTarballUrl`): `vespin-host-…` from `HOST_RENAMED_IN` on and `luke-host-…` before. Its one top folder is `luke-host` either way. */
function hostTarballName(version: string, target: HostTarget): string {
  const prefix = hostRenamed(version) ? TARBALL_PREFIX.RENAMED : TARBALL_PREFIX.BEFORE_RENAME;
  return `${prefix}-${version}-${target}.tar.gz`;
}

/**
 * Every name one target's tarball is published under: its own
 * (`hostTarballName`), and from the rename on a byte-identical copy under the
 * old name, which a host through 0.6.0 fetches it by.
 */
export function hostTarballNames(
  version: string,
  target: HostTarget,
): readonly [string, ...string[]] {
  const named = hostTarballName(version, target);
  const before = `${TARBALL_PREFIX.BEFORE_RENAME}-${version}-${target}.tar.gz`;
  return named === before ? [named] : [named, before];
}

/** Where the release keeps one target's tarball. */
export function hostTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${hostReleaseTag(version)}/${hostTarballName(version, target)}`;
}
