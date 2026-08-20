import path from "node:path";
import { PACKAGED_ARCHITECTURE } from "./package-config.mjs";

export const NOTARY_KEYCHAIN_PROFILE = "luke-notary";
// The version-free asset name every release carries beside the versioned DMG,
// so the download link on the website can point at the latest release forever.
export const RELEASE_LATEST_DMG_FILE_NAME = "Luke.dmg";
// The version-free manifest name every release carries, so the app's update
// feed URL — releases/latest/download/latest-mac.yml — never moves either.
// The name is electron-updater's own convention for a macOS generic feed.
export const RELEASE_UPDATE_FEED_FILE_NAME = "latest-mac.yml";
// The mounted installer volume is not named bare "Luke": it appears beside
// Luke.app in Finder, and both wear Luke's icon.
export const RELEASE_VOLUME_NAME = "Luke Installer";
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

export function releaseDmgFileName(version) {
  return `Luke-${version}-${PACKAGED_ARCHITECTURE}.dmg`;
}

// The zip is the auto-update path's food — Squirrel.Mac updates from an
// archive of the app, never a DMG — so every release carries it beside the
// DMG people actually open.
export function releaseZipFileName(version) {
  return `Luke-${version}-macos-${PACKAGED_ARCHITECTURE}.zip`;
}

export function builderReleaseArtifactDirectory(repoRoot) {
  return path.join(repoRoot, "artifacts", "release-builder");
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
export function notarySubmitArguments(artifactPath, credentials) {
  return [
    "notarytool",
    "submit",
    artifactPath,
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

export function stapleArguments(artifactPath) {
  return ["stapler", "staple", artifactPath];
}
