#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

required_files=(
    AGENTS.md
    WORKFLOW.md
    README.md
    Package.swift
    Luke.xcodeproj/project.pbxproj
    .conductor/settings.toml
    .github/pull_request_template.md
    .github/workflows/ci.yml
)

for required_file in "${required_files[@]}"; do
    if [[ ! -f "$SIDECAR_REPO_ROOT/$required_file" ]]; then
        printf 'error: required repository file is missing: %s\n' "$required_file" >&2
        exit 1
    fi
done

find "$SIDECAR_REPO_ROOT/scripts" -type f -name '*.sh' -print0 |
    while IFS= read -r -d '' script; do
        bash -n "$script"
    done

git -C "$SIDECAR_REPO_ROOT" diff --check
printf 'Repository contract checks passed.\n'
