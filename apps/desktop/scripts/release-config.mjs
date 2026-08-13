import path from "node:path";
import { DMG_WINDOW } from "../../../design/dmg-window.mjs";
import { PACKAGED_ARCHITECTURE, resolveSigningMode, SIGNING_MODE } from "./package-config.mjs";

export const NOTARY_KEYCHAIN_PROFILE = "luke-notary";
export const RELEASE_VOLUME_NAME = "Luke";
export const DMG_MOUNT_POINT = `/Volumes/${RELEASE_VOLUME_NAME}`;
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
