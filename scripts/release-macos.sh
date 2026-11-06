#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_macos
if [[ -z "${APP_CODESIGN_IDENTITY:-}" ]]; then
    printf 'error: APP_CODESIGN_IDENTITY must name a Developer ID Application identity\n' >&2
    exit 1
fi
if [[ -z "${POSTHOG_PROJECT_API_KEY:-}" ]]; then
    printf 'error: POSTHOG_PROJECT_API_KEY must hold the PostHog project key\n' >&2
    exit 1
fi
if [[ -z "${SENTRY_DSN:-}" ]]; then
    printf 'error: SENTRY_DSN must hold the Sentry project DSN\n' >&2
    exit 1
fi
if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
    printf 'error: SENTRY_AUTH_TOKEN must hold the Sentry source-map upload token\n' >&2
    exit 1
fi

"$SCRIPT_DIRECTORY/bootstrap.sh"
"$SCRIPT_DIRECTORY/check.sh"

cd "$APP_REPO_ROOT"
pnpm --filter @repo/desktop release "$@"
