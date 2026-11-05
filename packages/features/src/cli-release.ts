/**
 * cli-release.ts -- the `vespin` command's release the install script's `cli` mode serves: its version and each tarball's SHA-256, and where CI publishes them.
 *
 * CI builds the command's bundle once and publishes it to npm as `vespin`,
 * and packs it with the Node it runs on into one tarball per target the host
 * is released for, published to a GitHub release of its own, tagged
 * `cli-v<version>` (`.github/workflows/release-cli.yml`,
 * `apps/cli/scripts/package.ts`), never marked the repository's latest, since
 * the desktop's download link and its updater read that one. The web app
 * writes the release named here into the install script it serves
 * (`packages/service/src/agents/host-install-script-app.ts`), whose `cli`
 * mode checks the tarball it downloads against the digest it carries before
 * anything of it is installed, and `vespin update` runs that same script. A
 * release moves `CLI_RELEASE` whole, its digests read off the release CI
 * published, as `HOST_RELEASE` moves (`./host-release.ts`).
 */

import { HOST_TARGET, type HostTarget } from "./host-release.js";

/** The repository whose releases carry the command's tarballs. */
const RELEASE_REPOSITORY = "ReviewStage/vespin";

/** A published release of the command: its version, and each of the host's targets' tarball by its SHA-256 in hex. */
export interface CliRelease {
  readonly VERSION: string;
  readonly SHA256: { readonly [target in HostTarget]: string };
}

/**
 * The release the install script installs; none until the first is
 * published, and the script served meanwhile says there is none yet.
 */
export const CLI_RELEASE: CliRelease | undefined = {
  VERSION: "0.1.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "6538a6d8df7f93a40743592c0643de38f13ad393291532d5c3ac7d7da73b887f",
    [HOST_TARGET.LINUX_ARM64]: "2b5d4789023f8c50abba34822c7b242d272b596dcd4e886fa850bc87e49e3104",
    [HOST_TARGET.DARWIN_ARM64]: "df384d3f11aa3c3ad674f7ab824f4a0e74cd5e754064c0aa9fe317bf5d500ca2",
  },
};

/** The release's tag, apart from the desktop's `v<version>` and the host's `host-v<version>`. */
function cliReleaseTag(version: string): string {
  return `cli-v${version}`;
}

/** One target's tarball, by its file name, whose one top folder is `vespin`. */
export function cliTarballName(version: string, target: HostTarget): string {
  return `vespin-${version}-${target}.tar.gz`;
}

/** Where the release keeps one target's tarball. */
export function cliTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${cliReleaseTag(version)}/${cliTarballName(version, target)}`;
}
