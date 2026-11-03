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
 */

/** The repository whose releases carry the host's tarballs. */
const RELEASE_REPOSITORY = "ReviewStage/vespin";

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
  VERSION: "0.7.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "c44f741153b1282ae50066b97a0d33deb0287031bf7a4d7220c176a7b5d75104",
    [HOST_TARGET.LINUX_ARM64]: "a995a3a7f14b31a0be2d373cfa728ff70cd377ff6909522d773a2ddc276cb5bb",
    [HOST_TARGET.DARWIN_ARM64]: "23b06bc1a63cd69004bd0c52f7a66922ecde33477f93b3c744a43fc765ddb65d",
  },
};

/** The release's tag, apart from the desktop's `v<version>`. */
export function hostReleaseTag(version: string): string {
  return `host-v${version}`;
}

/** One target's tarball, by its file name, whose one top folder is `luke-host`. Note that both keep the old name though the program is `vespin-host` from 0.7.0 on, since a host through 0.6.0 fetches and unpacks its update by them. */
export function hostTarballName(version: string, target: HostTarget): string {
  return `luke-host-${version}-${target}.tar.gz`;
}

/** Where the release keeps one target's tarball. */
export function hostTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${hostReleaseTag(version)}/${hostTarballName(version, target)}`;
}
