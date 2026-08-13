# Releasing Luke for macOS

The release workflow builds, signs, notarizes, staples, and validates an arm64 macOS app. It
then creates `Luke-X.Y.Z-macos-arm64.zip` and a matching `.sha256` file.

Pushing a `vX.Y.Z` tag publishes or updates a GitHub Release. A manual
`workflow_dispatch` run performs the same release rehearsal without publishing; its zip and
checksum are retained as workflow artifacts for 14 days.

## Required GitHub Actions secrets

| Secret | Purpose | Source |
| --- | --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate and private key | A `.p12` export from Keychain Access or Xcode |
| `MACOS_CERTIFICATE_PASSWORD` | Password protecting the `.p12` export | The password chosen during export |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API private key | The downloaded `.p8` file from App Store Connect |
| `APPLE_API_KEY_ID` | Identifies the App Store Connect API key | App Store Connect, Users and Access, Integrations |
| `APPLE_API_ISSUER_ID` | Identifies the App Store Connect API key issuer | App Store Connect, Users and Access, Integrations |

### Export the signing certificate

Install or create the **Developer ID Application** certificate through Xcode's account
settings or the Apple Developer portal. In Keychain Access, select the certificate and its
private key, export both as a password-protected `.p12`, and keep the export out of the
repository.

Create a team App Store Connect API key under **Users and Access → Integrations** with the
Developer role. Download its `.p8` file immediately; Apple only offers the private key for
download once. Record its key ID and issuer ID.

From macOS, set the repository secrets with the GitHub CLI:

```sh
base64 -i DeveloperIDApplication.p12 | gh secret set MACOS_CERTIFICATE_P12_BASE64
printf '%s' 'the-p12-password' | gh secret set MACOS_CERTIFICATE_PASSWORD
base64 -i AuthKey_KEYID.p8 | gh secret set APPLE_API_KEY_P8_BASE64
printf '%s' 'KEYID' | gh secret set APPLE_API_KEY_ID
printf '%s' 'issuer-uuid' | gh secret set APPLE_API_ISSUER_ID
```

The commands use macOS `base64`, where `-i` names an input file. Entering the certificate
password interactively instead of placing it in shell history is safer:

```sh
gh secret set MACOS_CERTIFICATE_PASSWORD
```

## Rehearse the release

Run the **Release** workflow from the Actions tab with **Run workflow**. This checks the
credentials and performs the entire signing and notarization path, but only uploads a
workflow artifact. It does not create a GitHub Release.

## Cut a release

First land the version bump and packaging changes. The tag must exactly match
`apps/desktop/package.json`; for version `0.1.0`:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag push is the human release decision. The workflow does not create credentials or
push tags. It creates a published, non-draft release with generated notes. Re-running the
workflow is safe: an existing release is reused and its two assets are replaced with
`gh release upload --clobber`.

## Verify a download

Keep the zip and checksum file in the same directory, then verify the checksum:

```sh
shasum -a 256 -c Luke-0.1.0-macos-arm64.zip.sha256
```

After unzipping, ask Gatekeeper to assess the application:

```sh
spctl -a -t exec -vv Luke.app
```

A successful assessment identifies the source as `Notarized Developer ID`.

## Local DMG release

The GitHub Actions flow above produces a zip and uses App Store Connect API-key
secrets. The separate local `pnpm release:macos` flow produces a DMG under
`artifacts/release/` and uses the `luke-notary` keychain profile. It does not
upload or publish the DMG; distribution remains a separate deliberate step.
