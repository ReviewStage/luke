import { HOST_TARGET, type HostTarget } from "./host-release.js";

const RELEASE_REPOSITORY = "ReviewStage/vespin";

const CLI_PACKAGE = "vespin";

export const CLI_INSTALL_MODE = "cli";

export const CLI_LINK_FOLDER = "~/.local/bin";

export const CLI_COMMAND = {
  NPM_INSTALL: `npm i -g ${CLI_PACKAGE}`,
  LOGIN: `${CLI_PACKAGE} login`,
} as const;

export interface CliRelease {
  readonly VERSION: string;
  readonly SHA256: { readonly [target in HostTarget]: string };
}

export const CLI_RELEASE: CliRelease | undefined = {
  VERSION: "0.2.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "47415cbc2c021f5d74578be3e81b420d22a2d042b3a4a03dd8a637a0bbc0ce3d",
    [HOST_TARGET.LINUX_ARM64]: "334f659efb1727aed5f1bc0cc44cadad85e6ff4453be5f45ea9eb0af440d7fcc",
    [HOST_TARGET.DARWIN_ARM64]: "d17282b68549ea142014b911904f5130881d1a64371375409484d392e4911df0",
  },
};

function cliReleaseTag(version: string): string {
  return `cli-v${version}`;
}

export function cliTarballName(version: string, target: HostTarget): string {
  return `vespin-${version}-${target}.tar.gz`;
}

export function cliTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${cliReleaseTag(version)}/${cliTarballName(version, target)}`;
}
