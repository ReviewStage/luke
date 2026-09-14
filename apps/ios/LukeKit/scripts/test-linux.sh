#!/usr/bin/env bash
set -euo pipefail

# Runs LukeKit's suites on Linux, where there is no Xcode and no simulator, so
# CI compiles and exercises the package a pull request changes. A Mac still
# runs `swift test` over the whole package, and is the only place the files
# Linux leaves out compile at all.
#
# Which files those are is `Package.swift`'s own `#if os(Linux)`, each with its
# reason, so a plain `swift test` on Linux builds the same thing this does. All
# this adds is the pinned toolchain and the suites below.

# The version fetched where no toolchain is on the PATH, and the one CI's image
# carries. A toolchain already on the PATH is used as it stands, which is why
# the run prints the version it got.
SWIFT_VERSION=6.3.1

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

# Suites Linux compiles but cannot answer for. They are skipped at the run
# rather than excluded from the build, so the compiler still checks them on
# every pull request; a Mac is what gives them their verdict.
SKIPPED=(
    "DeviceSettingsSyncTests|LUKE-162: swift-corelibs-foundation's UserDefaults posts no didChangeNotification, so the sync's local-change relay publishes nothing here and five of the ten cases fail, the first at the force unwrap in testAChangeMadeAfterSyncingBeatsAPreSyncCopy."
)

printf 'LukeKit on Linux, Swift %s pinned.\n\nCompiled but not run here:\n' "$SWIFT_VERSION"
skip_arguments=()
for entry in "${SKIPPED[@]}"; do
    printf '  %s\n    %s\n\n' "${entry%%|*}" "${entry#*|}"
    skip_arguments+=(--skip "${entry%%|*}")
done

if ! command -v swift >/dev/null 2>&1; then
    # No toolchain on the PATH: fetch the pinned one for this distribution.
    # Swift.org's Linux builds link against the host's own libcurl, libxml2,
    # and C++ runtime, so a host without the dependencies swift.org documents
    # for it compiles and then fails to link.
    # shellcheck disable=SC1091
    distribution=$(. /etc/os-release && printf '%s:%s' "$ID" "$VERSION_ID")
    case "$distribution" in
    amzn:2023) platform=amazonlinux2 archive=amazonlinux2 ;;
    ubuntu:24.04) platform=ubuntu2404 archive=ubuntu24.04 ;;
    *)
        printf 'error: no Swift %s build is named here for %s; put a toolchain on the PATH\n' \
            "$SWIFT_VERSION" "$distribution" >&2
        exit 1
        ;;
    esac
    toolchain="${XDG_CACHE_HOME:-$HOME/.cache}/luke/swift-$SWIFT_VERSION-$platform"
    if [[ ! -x "$toolchain/usr/bin/swift" ]]; then
        printf 'Fetching Swift %s for %s\n' "$SWIFT_VERSION" "$platform"
        # Unpacked beside its home and moved into place whole, so an
        # interrupted fetch leaves no half a toolchain the next run believes.
        rm -rf "$toolchain" "$toolchain.partial"
        mkdir -p "$toolchain.partial"
        curl -fsSL \
            "https://download.swift.org/swift-$SWIFT_VERSION-release/$platform/swift-$SWIFT_VERSION-RELEASE/swift-$SWIFT_VERSION-RELEASE-$archive.tar.gz" |
            tar xz -C "$toolchain.partial" --strip-components 1
        mv "$toolchain.partial" "$toolchain"
    fi
    PATH="$toolchain/usr/bin:$PATH"
    export PATH
fi

swift --version

exec swift test --package-path "$PACKAGE_DIRECTORY" "${skip_arguments[@]}" "$@"
