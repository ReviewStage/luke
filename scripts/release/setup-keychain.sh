#!/usr/bin/env bash
set -euo pipefail

for variable_name in \
    MACOS_CERTIFICATE_P12_BASE64 \
    MACOS_CERTIFICATE_PASSWORD \
    RUNNER_TEMP \
    GITHUB_ENV; do
    if [[ -z "${!variable_name:-}" ]]; then
        printf 'error: required environment variable is missing: %s\n' "$variable_name" >&2
        exit 1
    fi
done

keychain_path="$RUNNER_TEMP/luke-release-${GITHUB_RUN_ID:-local}.keychain-db"
certificate_path="$RUNNER_TEMP/luke-release-${GITHUB_RUN_ID:-local}.p12"
keychain_password=$(openssl rand -hex 24)

printf 'LUKE_RELEASE_KEYCHAIN=%s\n' "$keychain_path" >> "$GITHUB_ENV"

cleanup_certificate() {
    rm -f "$certificate_path"
}
trap cleanup_certificate EXIT

printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | /usr/bin/base64 -D > "$certificate_path"
chmod 600 "$certificate_path"

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" \
    -k "$keychain_path" \
    -P "$MACOS_CERTIFICATE_PASSWORD" \
    -T /usr/bin/codesign
security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$keychain_password" \
    "$keychain_path"

search_keychains=("$keychain_path")
while IFS= read -r existing_keychain; do
    existing_keychain=${existing_keychain#\"}
    existing_keychain=${existing_keychain%\"}
    if [[ -n "$existing_keychain" && "$existing_keychain" != "$keychain_path" ]]; then
        search_keychains+=("$existing_keychain")
    fi
done <<< "$(security list-keychains -d user | sed 's/^[[:space:]]*//')"
security list-keychains -d user -s "${search_keychains[@]}"

identity_output=$(security find-identity -v -p codesigning "$keychain_path")
identity_hashes=$(
    printf '%s\n' "$identity_output" |
        sed -n '/Developer ID Application/ s/^[[:space:]]*[0-9]*) \([0-9A-Fa-f]\{40\}\) .*/\1/p'
)
identity_count=$(printf '%s\n' "$identity_hashes" | awk 'NF { count++ } END { print count + 0 }')

if [[ "$identity_count" -eq 0 ]]; then
    printf 'error: imported certificate contains no Developer ID Application identity\n' >&2
    exit 1
fi
if [[ "$identity_count" -ne 1 ]]; then
    printf 'error: imported certificate contains %s Developer ID Application identities; expected one\n' \
        "$identity_count" >&2
    exit 1
fi

{
    printf 'LUKE_CODESIGN_IDENTITY=%s\n' "$identity_hashes"
} >> "$GITHUB_ENV"

printf 'Imported one Developer ID Application identity into the temporary keychain.\n'
