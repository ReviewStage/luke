#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
    printf 'usage: %s <submission.zip>\n' "$0" >&2
    exit 2
fi

for variable_name in \
    APPLE_API_KEY_P8_BASE64 \
    APPLE_API_KEY_ID \
    APPLE_API_ISSUER_ID \
    RUNNER_TEMP; do
    if [[ -z "${!variable_name:-}" ]]; then
        printf 'error: required environment variable is missing: %s\n' "$variable_name" >&2
        exit 1
    fi
done

submission_path=$1
if [[ ! -f "$submission_path" ]]; then
    printf 'error: notarization submission does not exist: %s\n' "$submission_path" >&2
    exit 1
fi

key_directory=$(mktemp -d "$RUNNER_TEMP/luke-notary.XXXXXX")
key_path="$key_directory/AuthKey_$APPLE_API_KEY_ID.p8"
result_path="$key_directory/result.json"

cleanup_key() {
    rm -f "$key_path" "$result_path"
    rmdir "$key_directory" 2>/dev/null || true
}
trap cleanup_key EXIT

printf '%s' "$APPLE_API_KEY_P8_BASE64" | /usr/bin/base64 -D > "$key_path"
chmod 600 "$key_path"

notary_credentials=(
    --key "$key_path"
    --key-id "$APPLE_API_KEY_ID"
    --issuer "$APPLE_API_ISSUER_ID"
)

# notarytool's own --wait crashes with SIGBUS on most runs, and the upload has
# already reached Apple by the time it does, so resubmitting would only
# duplicate a submission that is already queued: submit once, then poll.
submit_exit=0
xcrun notarytool submit "$submission_path" \
    "${notary_credentials[@]}" \
    --output-format json > "$result_path" || submit_exit=$?

cat "$result_path"
submission_id=$(jq -r '.id // empty' "$result_path")

if [[ "$submit_exit" -ne 0 || -z "$submission_id" ]]; then
    printf 'error: notarization failed before Apple returned a submission ID\n' >&2
    exit 1
fi

poll_interval_seconds=30
poll_attempts=40
status=""

for ((attempt = 1; attempt <= poll_attempts; attempt++)); do
    if xcrun notarytool info "$submission_id" \
        "${notary_credentials[@]}" \
        --output-format json > "$result_path"; then
        status=$(jq -r '.status // empty' "$result_path")
    fi
    # An undocumented status is treated as still running, so an unfamiliar name
    # costs the release a wait rather than the whole build.
    case "$status" in
        Accepted | Invalid | Rejected) break ;;
    esac
    if [[ "$attempt" -lt "$poll_attempts" ]]; then
        sleep "$poll_interval_seconds"
    fi
done

cat "$result_path"

if [[ "$status" != "Accepted" ]]; then
    printf 'Notarization failed with status: %s; fetching Apple log for submission %s.\n' \
        "${status:-unknown}" "$submission_id" >&2
    xcrun notarytool log "$submission_id" "${notary_credentials[@]}" || true
    exit 1
fi

printf 'Apple accepted notarization submission %s.\n' "$submission_id"
