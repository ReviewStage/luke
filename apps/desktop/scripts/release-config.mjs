import path from "node:path";
import { PACKAGED_ARCHITECTURE, resolveSigningMode, SIGNING_MODE } from "./package-config.mjs";

export const NOTARY_KEYCHAIN_PROFILE = "luke-notary";
export const RELEASE_VOLUME_NAME = "Luke";
export const DMG_STAGING_ENTRIES = [
  { name: "Luke.app", kind: "application" },
  { name: "Applications", kind: "symlink", target: "/Applications" },
];

export function releaseDmgFileName(version) {
  return `Luke-${version}-${PACKAGED_ARCHITECTURE}.dmg`;
}

export function releaseArtifactDirectory(repoRoot) {
  return path.join(repoRoot, "artifacts", "release");
}

export function resolveReleaseSigning(env) {
  const signing = resolveSigningMode(env);
  if (signing.mode !== SIGNING_MODE.DEVELOPER_ID) {
    throw new Error("LUKE_CODESIGN_IDENTITY must name a Developer ID Application identity");
  }
  return { identity: signing.identity };
}

export function releaseSignatureMatchesIdentity({ identity, authority, certificateSha1 }) {
  if (/^[a-f\d]{40}$/i.test(identity)) {
    return (
      typeof certificateSha1 === "string" &&
      certificateSha1.toLowerCase() === identity.toLowerCase()
    );
  }
  return authority === identity;
}

export function codesignDisplayArguments(certificatePrefix, appPath) {
  return ["--display", "--verbose=2", `--extract-certificates=${certificatePrefix}`, appPath];
}

export function hdiutilCreateArguments({ stagingDirectory, dmgPath }) {
  return [
    "create",
    "-volname",
    RELEASE_VOLUME_NAME,
    "-srcfolder",
    stagingDirectory,
    "-fs",
    "APFS",
    "-format",
    "UDZO",
    "-ov",
    dmgPath,
  ];
}

export function dmgCodesignArguments(identity, dmgPath) {
  return ["--sign", identity, "--timestamp", dmgPath];
}

export function notarySubmitArguments(dmgPath) {
  return [
    "notarytool",
    "submit",
    dmgPath,
    "--keychain-profile",
    NOTARY_KEYCHAIN_PROFILE,
    "--wait",
    "--timeout",
    "20m",
    "--output-format",
    "json",
  ];
}

export function notaryLogArguments(submissionId) {
  return ["notarytool", "log", submissionId, "--keychain-profile", NOTARY_KEYCHAIN_PROFILE];
}

export function stapleArguments(dmgPath) {
  return ["stapler", "staple", dmgPath];
}

export function dmgVerificationCommands(dmgPath) {
  return [
    { command: "codesign", arguments: ["--verify", "--strict", dmgPath] },
    {
      command: "spctl",
      arguments: [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "-vv",
        dmgPath,
      ],
    },
    { command: "xcrun", arguments: ["stapler", "validate", dmgPath] },
    { command: "hdiutil", arguments: ["verify", dmgPath] },
  ];
}
