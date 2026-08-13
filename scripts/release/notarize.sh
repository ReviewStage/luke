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

submit_exit=0
xcrun notarytool submit "$submission_path" \
    --key "$key_path" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER_ID" \
    --wait \
    --timeout 20m \
    --output-format json > "$result_path" || submit_exit=$?

cat "$result_path"
submission_id=$(jq -r '.id // empty' "$result_path")
status=$(jq -r '.status // empty' "$result_path")

if [[ "$submit_exit" -ne 0 || "$status" != "Accepted" ]]; then
    if [[ -n "$submission_id" ]]; then
        printf 'Notarization failed; fetching Apple log for submission %s.\n' "$submission_id" >&2
        xcrun notarytool log "$submission_id" \
            --key "$key_path" \
            --key-id "$APPLE_API_KEY_ID" \
            --issuer "$APPLE_API_ISSUER_ID" || true
    else
        printf 'error: notarization failed before Apple returned a submission ID\n' >&2
    fi
    exit 1
fi

printf 'Apple accepted notarization submission %s.\n' "$submission_id"
