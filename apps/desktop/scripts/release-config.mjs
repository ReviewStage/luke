import fs from "node:fs";
import path from "node:path";
import { PACKAGED_ARCHITECTURE } from "./package-layout.mjs";

const NOTARY_KEYCHAIN_PROFILE = "vespin-notary";
export const RELEASE_LATEST_DMG_FILE_NAME = "Vespin.dmg";
export const RELEASE_UPDATE_FEED_FILE_NAME = "latest-mac.yml";
export const RELEASE_VOLUME_NAME = "Vespin Installer";
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
  return `Vespin-${version}-${PACKAGED_ARCHITECTURE}.dmg`;
}

export function releaseZipFileName(version) {
  return `Vespin-${version}-macos-${PACKAGED_ARCHITECTURE}.zip`;
}

export function builderReleaseArtifactDirectory(repoRoot) {
  return path.join(repoRoot, "artifacts", "release-builder");
}

export function resetBuilderReleaseArtifactDirectory(repoRoot) {
  fs.rmSync(builderReleaseArtifactDirectory(repoRoot), { recursive: true, force: true });
}

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

export function notarySubmitArguments(artifactPath, credentials) {
  return [
    "notarytool",
    "submit",
    artifactPath,
    ...notaryCredentialArguments(credentials),
    "--output-format",
    "json",
    "--no-s3-acceleration",
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

export const STAPLE_ATTEMPTS = 6;
export const STAPLE_RETRY_INTERVAL_MS = 30_000;

export async function stapleWithRetry({ staple, wait, attempts, intervalMs }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return staple();
    } catch (error) {
      if (attempt >= attempts) throw error;
      process.stderr.write(`staple attempt ${attempt} of ${attempts} failed; retrying\n`);
      await wait(intervalMs);
    }
  }
}
