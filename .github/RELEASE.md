# Releasing Luke for macOS

The release workflow builds, signs, notarizes, staples, and validates an arm64 macOS app. It
then creates `Luke-X.Y.Z-macos-arm64.zip` with a matching `.sha256` file, and a notarized
`Luke-X.Y.Z-arm64.dmg` with its own `.sha256` plus a version-free copy named `Luke.dmg` —
the asset the website's download button reaches through
`releases/latest/download/Luke.dmg`, which is why its name must never change.

Pushing a `vX.Y.Z` tag publishes or updates a GitHub Release. A manual
`workflow_dispatch` run performs the same release rehearsal without publishing; its zip,
DMG, and checksums are retained as workflow artifacts for 14 days.

While the Apple secrets below are not configured, a tag push skips the workflow cleanly
and releases are cut by hand instead — see "Manual release" below. Configuring the
secrets is what turns the tag push into the whole release.

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
workflow is safe: an existing release is reused and its assets are replaced with
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

## Manual release

Until the workflow's secrets exist, the whole release runs from a Mac holding the
Developer ID identity and a stored `luke-notary` notarytool profile
(`xcrun notarytool store-credentials luke-notary`), plus a `gh` login with write access.

```sh
export LUKE_CODESIGN_IDENTITY='Developer ID Application: …'
pnpm release:macos                    # signs, notarizes, staples; writes the DMG and zip
git tag v0.1.1 && git push origin v0.1.1
./scripts/release/publish-github.sh   # creates the release and uploads every asset
```

The builder writes both distribution artifacts under `artifacts/release/`, and the
publish script is what knows the asset set: the versioned DMG and zip with their
checksums, plus the version-free `Luke.dmg` the website's download link depends on. It
refuses to publish when the tag does not match `apps/desktop/package.json`, and it
creates a published, non-draft release — the `releases/latest` link and the app's own
update check both ignore drafts and prereleases, so a draft is a release nobody can
reach. Re-running it is safe: assets are replaced with `--clobber`.

Afterwards, confirm the two consumers see the build:

```sh
curl -sI -o /dev/null -w '%{http_code}\n' \
  https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg
curl -s https://api.github.com/repos/ReviewStage/luke/releases/latest | grep tag_name
```
