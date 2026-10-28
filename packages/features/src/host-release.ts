import type { DeviceArch } from "./device-agent-wire.js";

/**
 * host-release.ts -- the host daemon's release the install script serves: its version and each tarball's SHA-256, and where CI publishes them.
 *
 * CI builds one tarball per architecture a host runs on and publishes them
 * to a GitHub release of their own, tagged `host-v<version>`
 * (`.github/workflows/release-host.yml`, `apps/host/scripts/package.ts`),
 * never marked the repository's latest, since the desktop's download link
 * and its updater read that one. The web app serves the install script with
 * the release named here written into it (`apps/web/scripts/install-script.ts`),
 * which checks the tarball it downloads against the digest it carries before
 * anything of it is installed. A release moves `HOST_RELEASE` whole, its
 * digests read off the release CI published, as a tool's pin moves
 * (`@luke/agent-runner/pins`).
 */

/** The repository whose releases carry the host's tarballs. */
const RELEASE_REPOSITORY = "ReviewStage/luke";

/** A published release of the host daemon: its version, and each architecture's tarball by its SHA-256 in hex. */
export interface HostRelease {
  readonly VERSION: string;
  readonly SHA256: Readonly<Record<DeviceArch, string>>;
}

/**
 * The release the install script installs; none until the first is
 * published, and the script served meanwhile says there is none yet.
 */
export const HOST_RELEASE: HostRelease | undefined = {
  VERSION: "0.1.0",
  SHA256: {
    x64: "ec50beda036fc04757c40eb83de2cea09b357713e957cf90629e9f8e52cd2ce3",
    arm64: "796e6c5a12338f290cc10504ec954f020ec85d46279f6c058481795387b7baa2",
  },
};

/** The release's tag, apart from the desktop's `v<version>`. */
export function hostReleaseTag(version: string): string {
  return `host-v${version}`;
}

/** One architecture's tarball, by its file name, whose one top folder is `luke-host`. */
export function hostTarballName(version: string, arch: DeviceArch): string {
  return `luke-host-${version}-linux-${arch}.tar.gz`;
}

/** Where the release keeps one architecture's tarball. */
export function hostTarballUrl(version: string, arch: DeviceArch): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${hostReleaseTag(version)}/${hostTarballName(version, arch)}`;
}
