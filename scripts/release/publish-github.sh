#!/usr/bin/env bash
set -euo pipefail

# Publishes a manual macOS release from what pnpm release:macos just built.
# The asset set is load-bearing on both ends and encoded here so a by-hand
# release cannot break either: the version-free Luke.dmg is what the website's
# download link reaches through releases/latest, and the version-free
# latest-mac.yml is the electron-updater manifest the app updates from — so
# the release must be a published, non-draft, non-prerelease one whose tag
# matches the desktop version exactly.

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
cd "$REPO_ROOT"

if [[ "$#" -ne 0 ]]; then
    printf 'usage: %s\n' "$0" >&2
    exit 2
fi

VERSION=$(node -p "require('./apps/desktop/package.json').version")
TAG="v$VERSION"
DMG_ASSET_NAME=$(node -e "import('./apps/desktop/scripts/release-config.mjs').then((config) => process.stdout.write(config.releaseDmgFileName(process.argv[1])))" "$VERSION")
ZIP_ASSET_NAME=$(node -e "import('./apps/desktop/scripts/release-config.mjs').then((config) => process.stdout.write(config.releaseZipFileName(process.argv[1])))" "$VERSION")
LATEST_DMG_ASSET_NAME=$(node -e "import('./apps/desktop/scripts/release-config.mjs').then((config) => process.stdout.write(config.RELEASE_LATEST_DMG_FILE_NAME))")
UPDATE_FEED_ASSET_NAME=$(node -e "import('./apps/desktop/scripts/release-config.mjs').then((config) => process.stdout.write(config.RELEASE_UPDATE_FEED_FILE_NAME))")
ARTIFACT_DIRECTORY=$(node -e "import('./apps/desktop/scripts/release-config.mjs').then((config) => process.stdout.write(config.builderReleaseArtifactDirectory(process.cwd())))")
DMG_PATH="$ARTIFACT_DIRECTORY/$DMG_ASSET_NAME"
ZIP_PATH="$ARTIFACT_DIRECTORY/$ZIP_ASSET_NAME"
LATEST_DMG_PATH="$ARTIFACT_DIRECTORY/$LATEST_DMG_ASSET_NAME"
UPDATE_FEED_PATH="$ARTIFACT_DIRECTORY/$UPDATE_FEED_ASSET_NAME"

for artifact_path in "$DMG_PATH" "$ZIP_PATH"; do
    if [[ ! -f "$artifact_path" ]]; then
        printf 'error: %s does not exist. Run pnpm release:macos for version %s first.\n' \
            "$artifact_path" "$VERSION" >&2
        exit 1
    fi
done
for artifact_path in \
    "$LATEST_DMG_PATH" \
    "$UPDATE_FEED_PATH" \
    "$DMG_PATH.sha256" \
    "$ZIP_PATH.sha256"; do
    if [[ ! -f "$artifact_path" ]]; then
        printf 'error: electron-builder release output is missing %s\n' "$artifact_path" >&2
        exit 1
    fi
done

if ! git rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
    printf 'error: tag %s does not exist. The tag push is the release decision:\n' "$TAG" >&2
    printf '  git tag %s && git push origin %s\n' "$TAG" "$TAG" >&2
    exit 1
fi

staging_directory=$(mktemp -d)
trap 'rm -rf "$staging_directory"' EXIT
cp "$DMG_PATH" "$staging_directory/$DMG_ASSET_NAME"
cp "$ZIP_PATH" "$staging_directory/$ZIP_ASSET_NAME"
cp "$LATEST_DMG_PATH" "$staging_directory/$LATEST_DMG_ASSET_NAME"
cp "$UPDATE_FEED_PATH" "$staging_directory/$UPDATE_FEED_ASSET_NAME"
cp "$DMG_PATH.sha256" "$staging_directory/$DMG_ASSET_NAME.sha256"
cp "$ZIP_PATH.sha256" "$staging_directory/$ZIP_ASSET_NAME.sha256"

if ! gh release view "$TAG" > /dev/null 2>&1; then
    gh release create "$TAG" \
        --verify-tag \
        --title "Luke $VERSION" \
        --generate-notes
fi
gh release upload "$TAG" \
    "$staging_directory/$DMG_ASSET_NAME" \
    "$staging_directory/$DMG_ASSET_NAME.sha256" \
    "$staging_directory/$LATEST_DMG_ASSET_NAME" \
    "$staging_directory/$ZIP_ASSET_NAME" \
    "$staging_directory/$ZIP_ASSET_NAME.sha256" \
    "$staging_directory/$UPDATE_FEED_ASSET_NAME" \
    --clobber

printf 'Published %s. The website reaches this build at:\n' "$TAG"
printf '  https://github.com/ReviewStage/luke/releases/latest/download/%s\n' "$LATEST_DMG_ASSET_NAME"
