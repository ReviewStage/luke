const RELEASE_REPOSITORY = "ReviewStage/vespin";

export const HOST_TARGET = {
  LINUX_X64: "linux-x64",
  LINUX_ARM64: "linux-arm64",
  DARWIN_ARM64: "darwin-arm64",
} as const;

export type HostTarget = (typeof HOST_TARGET)[keyof typeof HOST_TARGET];

export interface HostRelease {
  readonly VERSION: string;
  readonly SHA256: {
    readonly [HOST_TARGET.LINUX_X64]: string;
    readonly [HOST_TARGET.LINUX_ARM64]: string;
    readonly [HOST_TARGET.DARWIN_ARM64]?: string;
  };
}

export const HOST_RELEASE: HostRelease | undefined = {
  VERSION: "0.10.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "5e8ad1fa4c089f921022c90c47b52308230086e128ddcd70dc655c6bc6ebb8bc",
    [HOST_TARGET.LINUX_ARM64]: "e1e66b5c038ce6aaed5fc9ecc1cc15fa815a628a5537fbe6912fb84894f21aab",
    [HOST_TARGET.DARWIN_ARM64]: "a00dd2fa3de6c500d37bbed41f72e413bd9afb7cc0039c51ee57478d1ef4b4d5",
  },
};

export function hostReleaseTag(version: string): string {
  return `host-v${version}`;
}

export function hostTarballName(version: string, target: HostTarget): string {
  return `vespin-host-${version}-${target}.tar.gz`;
}

export function hostTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${hostReleaseTag(version)}/${hostTarballName(version, target)}`;
}
