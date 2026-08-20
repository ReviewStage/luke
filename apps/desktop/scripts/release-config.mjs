import path from "node:path";
import { DMG_WINDOW } from "../../../design/dmg-window.mjs";
import { PACKAGED_ARCHITECTURE, resolveSigningMode, SIGNING_MODE } from "./package-config.mjs";

export const NOTARY_KEYCHAIN_PROFILE = "luke-notary";
// The version-free asset name every release carries beside the versioned DMG,
// so the download link on the website can point at the latest release forever.
export const RELEASE_LATEST_DMG_FILE_NAME = "Luke.dmg";
// The version-free manifest name every release carries, so the app's update
// feed URL — releases/latest/download/latest-mac.yml — never moves either.
// The name is electron-updater's own convention for a macOS generic feed.
export const RELEASE_UPDATE_FEED_FILE_NAME = "latest-mac.yml";
export const NOTARY_CREDENTIAL_SOURCE = {
  KEYCHAIN_PROFILE: "keychain-profile",
  KEY_FILE: "key-file",
};
export const NOTARY_SUBMISSION_STATUS = {
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In Progress",
  INVALID: "Invalid",
  REJECTED: "Rejected",
};
export const NOTARY_POLL_INTERVAL_MS = 30_000;
export const NOTARY_POLL_TIMEOUT_MS = 20 * 60_000;
export const RELEASE_VOLUME_NAME = "Luke";
export const DMG_MOUNT_POINT = `/Volumes/${RELEASE_VOLUME_NAME}`;
export const DMG_STAGING_ENTRIES = [
  { name: "Luke.app", kind: "application" },
  { name: "Applications", kind: "symlink", target: "/Applications" },
];
// The name Finder reads a volume's icon from, at the volume root. The file
// alone is not enough: Finder only looks for it once the root directory's
// custom-icon bit is set, which can only happen on a mounted volume — see
// volumeCustomIconArguments.
export const DMG_VOLUME_ICON_FILE_NAME = ".VolumeIcon.icns";

export function releaseDmgFileName(version) {
  return `Luke-${version}-${PACKAGED_ARCHITECTURE}.dmg`;
}

// The zip is the auto-update path's food — Squirrel.Mac updates from an
// archive of the app, never a DMG — so every release carries it beside the
// DMG people actually open.
export function releaseZipFileName(version) {
  return `Luke-${version}-macos-${PACKAGED_ARCHITECTURE}.zip`;
}

/**
 * The update manifest a release publishes beside its archive, in the
 * `latest-mac.yml` shape electron-builder writes and electron-updater reads.
 * The archive URL is the bare file name on purpose: the generic provider
 * resolves it against the feed's own address, `releases/latest/download/`,
 * so the manifest and the archive can only ever be read from the same
 * release. The sha512 is what makes a truncated or substituted download a
 * refusal rather than an install.
 */
export function releaseUpdateManifest({ version, sha512, size, releaseDate }) {
  const zipFileName = releaseZipFileName(version);
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${zipFileName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipFileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
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
      Object.prototype.toString.call(certificateSha1) === "[object String]" &&
      certificateSha1.toLowerCase() === identity.toLowerCase()
    );
  }
  return authority === identity;
}

export function codesignDisplayArguments(certificatePrefix, appPath) {
  return ["--display", "--verbose=2", `--extract-certificates=${certificatePrefix}`, appPath];
}

export function hdiutilCreateArguments({ stagingDirectory, imagePath }) {
  return [
    "create",
    "-volname",
    RELEASE_VOLUME_NAME,
    "-srcfolder",
    stagingDirectory,
    "-fs",
    "APFS",
    "-format",
    "UDRW",
    "-ov",
    imagePath,
  ];
}

export function hdiutilAttachArguments(imagePath) {
  return [
    "attach",
    imagePath,
    "-readwrite",
    "-noverify",
    "-noautoopen",
    "-nobrowse",
    "-mountpoint",
    DMG_MOUNT_POINT,
    "-plist",
  ];
}

function plistString(entity, key) {
  const match = entity.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function parseHdiutilAttachPlist(xml) {
  const mountKey = xml.indexOf("<key>mount-point</key>");
  if (mountKey >= 0) {
    const entityStart = xml.lastIndexOf("<dict>", mountKey);
    const entityEnd = xml.indexOf("</dict>", mountKey);
    if (entityStart >= 0 && entityEnd >= 0) {
      const entity = xml.slice(entityStart, entityEnd + "</dict>".length);
      const mountPoint = plistString(entity, "mount-point");
      const device = plistString(entity, "dev-entry");
      if (mountPoint && device) return { mountPoint, device };
    }
  }
  throw new Error(`hdiutil did not report a mounted volume:\n${xml}`);
}

export async function withMountedDmg({ attach, detach, use }) {
  const attachOutput = attach();
  let mountPoint = DMG_MOUNT_POINT;
  let result;
  try {
    ({ mountPoint } = parseHdiutilAttachPlist(attachOutput));
    result = await use(mountPoint);
  } catch (error) {
    try {
      detach(mountPoint);
    } catch (detachError) {
      error.cause ??= detachError;
    }
    throw error;
  }
  detach(mountPoint);
  return result;
}

export function hdiutilDetachArguments(mountPoint, { force = false } = {}) {
  return ["detach", mountPoint, ...(force ? ["-force"] : [])];
}

export function hdiutilConvertArguments({ imagePath, dmgPath }) {
  return [
    "convert",
    imagePath,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-ov",
    "-o",
    dmgPath,
  ];
}

export function tiffutilHiDpiArguments({ pngPath, png2xPath, tiffPath }) {
  return ["-cathidpicheck", pngPath, png2xPath, "-out", tiffPath];
}

export function dmgStoreLayout(mountPoint) {
  return {
    version: 1,
    backgroundPath: path.join(
      mountPoint,
      DMG_WINDOW.BACKGROUND.DIRECTORY,
      DMG_WINDOW.BACKGROUND.FILE_NAME,
    ),
    iconSize: DMG_WINDOW.ICON_SIZE,
    textSize: DMG_WINDOW.TEXT_SIZE,
    window: {
      x: DMG_WINDOW.BOUNDS.LEFT,
      y: DMG_WINDOW.BOUNDS.BOTTOM,
      width: DMG_WINDOW.BOUNDS.WIDTH,
      height: DMG_WINDOW.BOUNDS.HEIGHT,
    },
    icons: [
      {
        name: DMG_STAGING_ENTRIES.find((entry) => entry.kind === "application").name,
        ...DMG_WINDOW.POSITIONS.APP,
      },
      {
        name: DMG_STAGING_ENTRIES.find((entry) => entry.kind === "symlink").name,
        ...DMG_WINDOW.POSITIONS.APPLICATIONS,
      },
    ],
  };
}

// Sets the custom-icon Finder bit on the mounted volume's root, which is what
// makes Finder read DMG_VOLUME_ICON_FILE_NAME beside it. Run through xcrun:
// SetFile ships with the developer tools rather than on the system path. Both
// the bit and the icon file survive the UDZO conversion.
export function volumeCustomIconArguments(mountPoint) {
  return ["SetFile", "-a", "C", mountPoint];
}

export function dmgCodesignArguments(identity, dmgPath) {
  return ["--sign", identity, "--timestamp", dmgPath];
}

// A developer's Mac holds a stored notarytool profile; a CI runner has only
// the repository secrets, decoded into a key file for the run. Either form
// names the same App Store Connect key — the env only says where it lives.
export function resolveNotaryCredentials(env) {
  const keyPath = env.APPLE_API_KEY_PATH?.trim();
  const keyId = env.APPLE_API_KEY_ID?.trim();
  const issuerId = env.APPLE_API_ISSUER_ID?.trim();
  const provided = [keyPath, keyId, issuerId].filter(Boolean);
  if (provided.length === 0) {
    return { source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE };
  }
  if (provided.length < 3) {
    throw new Error(
      "APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER_ID must be provided together",
    );
  }
  return { source: NOTARY_CREDENTIAL_SOURCE.KEY_FILE, keyPath, keyId, issuerId };
}

function notaryCredentialArguments(credentials) {
  if (credentials.source === NOTARY_CREDENTIAL_SOURCE.KEY_FILE) {
    return [
      "--key",
      credentials.keyPath,
      "--key-id",
      credentials.keyId,
      "--issuer",
      credentials.issuerId,
    ];
  }
  return ["--keychain-profile", NOTARY_KEYCHAIN_PROFILE];
}

// notarytool's own --wait crashes with SIGBUS on most runs, and the upload has
// already reached Apple by the time it does, so resubmitting would only
// duplicate a submission that is already queued: submit once, then poll.
export function notarySubmitArguments(dmgPath, credentials) {
  return [
    "notarytool",
    "submit",
    dmgPath,
    ...notaryCredentialArguments(credentials),
    "--output-format",
    "json",
  ];
}

export function notaryInfoArguments(submissionId, credentials) {
  return [
    "notarytool",
    "info",
    submissionId,
    ...notaryCredentialArguments(credentials),
    "--output-format",
    "json",
  ];
}

export function notaryLogArguments(submissionId, credentials) {
  return ["notarytool", "log", submissionId, ...notaryCredentialArguments(credentials)];
}

// A status Apple has not documented here is treated as still running rather
// than as a failure, so an unfamiliar name costs the release a wait instead of
// the whole build.
export async function awaitNotarizationDecision({
  readStatus,
  wait,
  intervalMs = NOTARY_POLL_INTERVAL_MS,
  timeoutMs = NOTARY_POLL_TIMEOUT_MS,
}) {
  for (let waited = 0; ; waited += intervalMs) {
    const status = readStatus();
    if (status === NOTARY_SUBMISSION_STATUS.ACCEPTED) {
      return status;
    }
    if (
      status === NOTARY_SUBMISSION_STATUS.INVALID ||
      status === NOTARY_SUBMISSION_STATUS.REJECTED
    ) {
      throw new Error(`Notarization failed with status: ${status}`);
    }
    if (waited + intervalMs >= timeoutMs) {
      throw new Error(
        `Apple did not finish notarization within ${timeoutMs / 60_000} minutes; last status: ${status ?? "unknown"}`,
      );
    }
    await wait(intervalMs);
  }
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
