#!/usr/bin/env bash

# Uploads an eve root's source maps to Sentry's `luke-web` project after its
# `eve build`, so a stack trace from the luke or dev service reads as the
# source rather than as `_libs/eve.mjs`. Each service's build command in the
# root `vercel.json` runs it from the service's root, after the build:
#
#   pnpm exec eve build && pnpm exec bash ../../scripts/eve-source-maps.sh
#
# where `pnpm exec` puts the service's own `sentry-cli` (`@sentry/cli`, a dev
# dependency of each eve root) on the PATH.
# It is the eve roots' counterpart of the web functions' upload
# (`apps/web/scripts/bundle-functions.ts`), on the same terms: only a build
# that holds `SENTRY_AUTH_TOKEN` uploads, and any other build is left exactly
# as `eve build` wrote it. Each eve root's `nitro.config.ts` writes the maps
# on the same condition, hidden, beside the bundles.
#
# The output is where eve publishes it: the directory Vercel names in
# `EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY`, else `.vercel/output` on Vercel and
# `.output` anywhere else. Every function there that is a directory rather
# than a link to one is a bundle of its own (the server and the workflow's
# `flow.func`, which `sentry-cli` would skip as hidden if it were left to
# walk the tree), and the dependencies traced beside each under
# `node_modules` are not ours to touch. Each bundle is given a debug ID,
# which is what Sentry matches a frame to its map by, the maps are uploaded
# under the release the SDK reports (`VERCEL_GIT_COMMIT_SHA`), and then
# deleted, so none ships in a function. Sentry is not the build's to wait
# on: a failed inject or upload, or a token-holding build with no map to
# upload, prints a warning and the build goes on, its traces unreadable but
# its deployment shipped. The maps are deleted whether the upload succeeded
# or not.

set -euo pipefail

SENTRY_ORG=stage-review
SENTRY_PROJECT=luke-web

if [[ -z ${SENTRY_AUTH_TOKEN:-} ]]; then
    printf 'eve-source-maps: no SENTRY_AUTH_TOKEN, so no source maps are uploaded\n'
    exit 0
fi

# Only a production build uploads: a Preview's traces are read rarely, and
# the maps cost every Preview build time. Each root's nitro.config.ts writes
# no maps outside production either.
if [[ ${VERCEL_ENV:-} != production ]]; then
    printf 'eve-source-maps: not a production build, so no source maps are uploaded\n'
    exit 0
fi

if [[ -n ${EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY:-} ]]; then
    output=$EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY
elif [[ -n ${VERCEL:-} ]]; then
    output=.vercel/output
else
    output=.output
fi

bundles=()
if [[ -d $output/functions ]]; then
    while IFS= read -r -d '' bundle; do
        bundles+=("$bundle")
    done < <(find "$output/functions" -name node_modules -prune -o -type d -name '*.func' -print0)
fi
maps=0
if ((${#bundles[@]} > 0)); then
    maps=$(find "${bundles[@]}" -name node_modules -prune -o -type f -name '*.map' -print | wc -l)
fi
if ((maps == 0)); then
    printf 'eve-source-maps: warning: no source maps under %s/functions to upload; is the root missing its nitro.config.ts?\n' \
        "$output" >&2
    exit 0
fi

release=()
if [[ -n ${VERCEL_GIT_COMMIT_SHA:-} ]]; then
    release=(--release "$VERCEL_GIT_COMMIT_SHA")
fi

uploaded=true
if ! sentry-cli sourcemaps inject --ignore node_modules "${bundles[@]}"; then
    uploaded=false
elif ! sentry-cli sourcemaps upload --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" \
    ${release[@]+"${release[@]}"} --ignore node_modules "${bundles[@]}"; then
    uploaded=false
fi
find "${bundles[@]}" -name node_modules -prune -o -type f -name '*.map' -exec rm -f {} +
if [[ $uploaded == true ]]; then
    printf 'eve-source-maps: uploaded %s source maps from %s and removed them from the output\n' \
        "$(echo "$maps" | tr -d ' ')" "$output"
else
    printf 'eve-source-maps: warning: sentry-cli failed, so %s source maps from %s were not uploaded; removed them from the output and went on\n' \
        "$(echo "$maps" | tr -d ' ')" "$output" >&2
fi
