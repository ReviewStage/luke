#!/usr/bin/env bash
set -euo pipefail

# Builds the coding agent's OCI image for one platform from the sandbox's own
# preparation (packages/service/src/agents/sandbox-oci-image.ts), and with
# --push publishes it, or joins the platforms' images under its key:
#
#   ./scripts/sandbox-image.sh build linux/arm64          # build, publish nothing
#   ./scripts/sandbox-image.sh build linux/arm64 --push   # publish <key>-arm64
#   ./scripts/sandbox-image.sh publish                    # join them as <key>
#
# Each command first asks the registry for the key's image and does nothing
# where it is published already, so a key is written once and never over,
# and a run whose preparation is unchanged builds nothing. Every step writes
# the key and reference to $GITHUB_OUTPUT, and `publish` the image's digest
# to $GITHUB_STEP_SUMMARY, where those name files. Pushing needs a
# `docker login ghcr.io` with write access to the package; reading it, once
# the package is public, needs none.

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

PLATFORMS=(linux/amd64 linux/arm64)
BUILDER=luke-sandbox-image

usage() {
    printf 'usage: %s build <linux/amd64|linux/arm64> [--push] | publish\n' "$0" >&2
    exit 2
}

# The platform's tag suffix: the architecture, after the OS.
architecture() {
    printf '%s' "${1#linux/}"
}

published() {
    docker buildx imagetools inspect "$1" >/dev/null 2>&1
}

# Prints the size of each layer of the image in an OCI layout, as a box
# downloads it and as it unpacks, and adds the table to the run's summary,
# so what a change costs a box that pulls it again can be read off.
layers() {
    local layout=$1 manifest table digest size unpacked index=0
    manifest=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).manifests[0].digest.slice(7)' "$layout/index.json")
    table=$'| Layer | Download | Unpacked |\n| --- | --- | --- |\n'
    # Note that eve's own layers are zstd, and the ones built here gzip.
    while read -r digest size media; do
        if [[ $media == *zstd ]]; then
            unpacked=$(zstd -dc "$layout/blobs/sha256/$digest" | wc -c)
        else
            unpacked=$(gzip -dc "$layout/blobs/sha256/$digest" | wc -c)
        fi
        table+=$(printf '| %s | %s MB | %s MB |' "$index" "$((size / 1000000))" "$((unpacked / 1000000))")$'\n'
        index=$((index + 1))
    done < <(node -e 'for (const l of JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).layers) console.log(l.digest.slice(7), l.size, l.mediaType)' "$layout/blobs/sha256/$manifest")
    printf '%s\n' "$table"
    if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
        printf '%s, layers bottom first:\n\n%s\n' "$2" "$table" >>"$GITHUB_STEP_SUMMARY"
    fi
}

output() {
    printf '%s=%s\n' "$1" "$2"
    if [[ -n ${GITHUB_OUTPUT:-} ]]; then
        printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
    fi
}

command=${1:-}
[[ $command == build || $command == publish ]] || usage
luke_require_command docker

context=$(mktemp -d)
trap 'rm -rf "$context"' EXIT
recorded=$(cd "$LUKE_REPO_ROOT/apps/web" && pnpm exec tsx scripts/sandbox-image.ts "$context")
key=$(sed -n 's/^key=//p' <<<"$recorded")
reference=$(sed -n 's/^reference=//p' <<<"$recorded")
repository=${reference%:*}
output key "$key"
output reference "$reference"

if published "$reference"; then
    printf '%s is published already\n' "$reference"
    output built false
    exit 0
fi
output built true

if [[ $command == build ]]; then
    platform=${2:-}
    [[ " ${PLATFORMS[*]} " == *" $platform "* ]] || usage
    push=false
    if [[ ${3:-} == --push ]]; then push=true; fi
    # The preparation's last check takes a capability, which BuildKit grants a
    # step only on a builder of its own that allows the insecure entitlement.
    if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
        docker buildx create --name "$BUILDER" --driver docker-container \
            --buildkitd-flags '--allow-insecure-entitlement security.insecure' >/dev/null
    fi
    # Each step is a layer that a box pulls again only once it changes, which
    # holds only where an unchanged step is the very layer the build before
    # wrote: so every build reads BuildKit's cache from the registry, and a
    # publishing one writes it back. Its tag names it a cache, never an image,
    # and no host resolves it.
    cache="$repository:buildkit-cache-$(architecture "$platform")"
    caching=(--cache-from "type=registry,ref=$cache")
    if [[ $push == true ]]; then
        caching+=(--cache-to "type=registry,ref=$cache,mode=max,image-manifest=true,oci-mediatypes=true")
    fi
    # Note that provenance and SBOM manifests are left out, so each platform's
    # tag is one plain image manifest, which the publish step joins into the
    # index. The image is written as an OCI layout too, which `layers` reads.
    layout=$(mktemp -d)
    trap 'rm -rf "$context" "$layout"' EXIT
    docker buildx build --builder "$BUILDER" --platform "$platform" \
        --allow security.insecure --provenance=false --sbom=false "${caching[@]}" \
        --output "type=image,name=$reference-$(architecture "$platform"),push=$push" \
        --output "type=oci,dest=$layout,tar=false" \
        --file "$context/Dockerfile" "$context"
    layers "$layout" "$reference-$(architecture "$platform")"
    exit 0
fi

sources=()
for platform in "${PLATFORMS[@]}"; do
    sources+=("$reference-$(architecture "$platform")")
done
docker buildx imagetools create --tag "$reference" "${sources[@]}"
digest=$(docker buildx imagetools inspect "$reference" --format '{{json .Manifest}}' |
    node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).digest)')
output digest "$digest"
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf 'Published `%s` as `%s@%s`\n' "$reference" "$repository" "$digest" >>"$GITHUB_STEP_SUMMARY"
fi
