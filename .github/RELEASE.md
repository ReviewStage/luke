# Releasing Luke for macOS

Releases are cut by pushing a `vX.Y.Z` tag. GitHub Actions does the rest: the **Release**
workflow builds, signs, notarizes, staples, and validates an arm64 macOS app with
electron-builder on a `macos-15` runner, then publishes the GitHub Release and uploads
every asset. The Apple, Google, PostHog, and Sentry secrets the workflow needs are configured on
this repository, so the tag push is the whole release.

The workflow's first job asks whether the signing certificate secret exists, because a
job-level `if` cannot read the `secrets` context. It is a guard against a tag pushed
where the credentials are absent — a fork, or a repository whose secrets were cleared —
and it never prints a secret. A manual dispatch bypasses the guard on purpose, so a
rehearsal run without credentials fails loudly at the secret check instead of silently
doing nothing.

## What a release publishes

Six assets, and every one of them is load-bearing:

| Asset | Why it exists |
| --- | --- |
| `Luke-X.Y.Z-arm64.dmg` | The versioned, notarized, stapled disk image |
| `Luke-X.Y.Z-arm64.dmg.sha256` | Its checksum |
| `Luke.dmg` | A version-free copy of the same DMG — the asset the website's download button reaches through `releases/latest/download/Luke.dmg`, which is why its name must never change |
| `Luke-X.Y.Z-macos-arm64.zip` | The archive electron-updater downloads |
| `Luke-X.Y.Z-macos-arm64.zip.sha256` | Its checksum |
| `latest-mac.yml` | The electron-updater manifest the app updates from through `releases/latest/download/latest-mac.yml`; it names the zip beside it with a relative URL and carries its sha512, so its name must never change either |

The workflow verifies all six before it publishes anything: `Luke.dmg` must be byte-identical
to the versioned DMG, both checksums must verify, the DMG must pass `codesign`, `spctl`,
`stapler validate`, and `hdiutil verify`, the app must be arm64-only, hardened-runtime,
`Notarized Developer ID`, and carrying `LUKE-LICENSE.txt`, and `latest-mac.yml` must name
the zip with a relative URL and carry both `sha512` and `size`.

The packaged Sentry SDK uses `production` as its environment and `Luke@X.Y.Z`
as its release. When `SENTRY_AUTH_TOKEN` is present, the final esbuild plugin on
the main, preload, and renderer JavaScript builds uploads their source maps to
that release before electron-builder packages the app. The maps remain excluded
from the app bundle; ordinary local builds need neither Sentry value and upload
nothing.

## Cut a release

1. **Prepare and merge the version PR.** Bump `apps/desktop/package.json` and add the
   release's entry to `CHANGELOG.md` at the repository root in the same change. The
   landing page renders that file at `/changelog`, and `scripts/repository-checks.sh`
   refuses a desktop version the changelog does not name, so a bump cannot land without
   its notes. Merge it through protected `main` like any other change.

2. **Confirm the hosted service is live.** The service deploys from `main` on merge while
   the desktop ships on the tag, so a build released ahead of its service answers 404
   where a feature expected an endpoint. The one endpoint with no fallback at all is
   `/api/voice/introduction-mint` — the spoken introduction runs before any account or
   key exists, so that endpoint is its only possible voice, and a desktop carrying the
   introduction must not be tagged until the service serving it is live.

3. **Tag the merged commit.** The tag must point at the squash-merged commit on `main`
   and its version must match `apps/desktop/package.json` exactly; the workflow refuses a
   tag that does not.

   ```sh
   git fetch origin main
   git tag v0.1.0 origin/main
   ```

4. **Push the tag.** This is the human release decision — the workflow creates no
   credentials and pushes no tags.

   ```sh
   git push origin v0.1.0
   ```

5. **Let Actions finish.** The run bootstraps the workspace, runs `./scripts/check.sh`,
   imports the Developer ID certificate into a throwaway keychain, builds the signed and
   notarized artifacts, validates them, and then creates a published, non-draft release
   titled `Luke X.Y.Z` with generated notes and uploads all six assets. The keychain is
   removed whether the run succeeds or fails.

Re-running the workflow on the same tag is safe: an existing release is reused and its
assets are replaced with `gh release upload --clobber`. The release must stay non-draft
and non-prerelease — `releases/latest` and the app's own update check both ignore drafts
and prereleases, so a draft is a release nobody can reach.

## Rehearse the release

Run the **Release** workflow from the Actions tab with **Run workflow**. A manual dispatch
runs the identical build, signing, notarization, and validation path but publishes
nothing: no release is created and no assets are attached. The six artifacts are kept as a
workflow artifact for 14 days instead.

This is what to run after changing credentials, the signing or notarization setup, the
packaging configuration, or the workflow itself — it proves the whole path works before a
tag commits the repository to a release.

## Verify after a release

Confirm the three consumers see the build:

```sh
curl -sI -o /dev/null -w '%{http_code}\n' \
  https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg
curl -s https://api.github.com/repos/ReviewStage/luke/releases/latest | grep tag_name
curl -sL https://github.com/ReviewStage/luke/releases/latest/download/latest-mac.yml
```

To check a downloaded build by hand, keep the zip and its checksum file in the same
directory and verify the checksum:

```sh
shasum -a 256 -c Luke-0.1.0-macos-arm64.zip.sha256
```

After unzipping, ask Gatekeeper to assess the application:

```sh
spctl -a -t exec -vv Luke.app
```

A successful assessment identifies the source as `Notarized Developer ID`.

## GitHub Actions secrets

All nine are configured. This section is for rotating them or standing the workflow up
somewhere else; the workflow fails its secret check if any one is missing.

| Secret | Purpose | Source |
| --- | --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate and private key | A `.p12` export from Keychain Access or Xcode |
| `MACOS_CERTIFICATE_PASSWORD` | Password protecting the `.p12` export | The password chosen during export |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API private key | The downloaded `.p8` file from App Store Connect |
| `APPLE_API_KEY_ID` | Identifies the App Store Connect API key | App Store Connect, Users and Access, Integrations |
| `APPLE_API_ISSUER_ID` | Identifies the App Store Connect API key issuer | App Store Connect, Users and Access, Integrations |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` | Google Calendar desktop OAuth client secret, baked into the app bundle at package time; a build without it ships no calendar sign-in | Google Cloud console, the Luke project's Desktop client under APIs & Services → Credentials |
| `POSTHOG_PROJECT_API_KEY` | PostHog project key, baked into the renderer at build time; a build without it records nothing at all, silently | PostHog, Project settings → Project API key |
| `SENTRY_DSN` | Sentry project DSN, baked into main; a build without it sends no crash reports | Sentry, `luke-desktop` → Client Keys |
| `SENTRY_AUTH_TOKEN` | Secret build token used only to upload source maps for `Luke@X.Y.Z` | Sentry, Organization Settings → Auth → Auth Tokens |

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
base64 -i AuthKey_KEYID.p8 | gh secret set APPLE_API_KEY_P8_BASE64
printf '%s' 'KEYID' | gh secret set APPLE_API_KEY_ID
printf '%s' 'issuer-uuid' | gh secret set APPLE_API_ISSUER_ID
gh secret set MACOS_CERTIFICATE_PASSWORD
gh secret set GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET
gh secret set POSTHOG_PROJECT_API_KEY
gh secret set SENTRY_DSN
gh secret set SENTRY_AUTH_TOKEN
```

The commands use macOS `base64`, where `-i` names an input file. The final five read the
value from a prompt rather than from shell history, which is how any secret worth
protecting should be entered.

After rotating anything here, dispatch a rehearsal run before the next tag.

## Emergency fallback: release from a Mac

**Use this only when Actions cannot cut the release** — the hosted path above is the
release process. Everything below runs from a Mac holding the Developer ID identity and a
stored `luke-notary` notarytool profile
(`xcrun notarytool store-credentials luke-notary`), plus a `gh` login with write access.

```sh
export LUKE_CODESIGN_IDENTITY='Your Name (TEAMID)'
export GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET='GOCSPX-…'   # from the Google Cloud console
export POSTHOG_PROJECT_API_KEY='phc_…'                  # from PostHog project settings
export SENTRY_DSN='https://…'                            # from the luke-desktop project
export SENTRY_AUTH_TOKEN='sntrys_…'                     # source-map upload token
pnpm release:macos                    # signs, notarizes, staples; writes the DMG, zip, and manifest
git tag v0.1.1 && git push origin v0.1.1
./scripts/release/publish-github.sh   # creates the release and uploads every asset
```

`LUKE_CODESIGN_IDENTITY` goes to electron-builder's `mac.identity` unchanged, which
expects the identity's name **without** the `Developer ID Application:` prefix — the
common name and team identifier alone, as in `Your Name (TEAMID)`. Run
`security find-identity -v -p codesigning` to read the exact name off the certificate.

The calendar, PostHog, and Sentry values are supplied while packaging, and
`scripts/release-macos.sh` refuses to run without them rather than shipping a
DMG whose calendar sign-in, analytics, crash reporting, or symbolication is
silently missing. They are the same values the Actions secrets hold.

Electron-builder writes the distribution artifacts under `artifacts/release-builder/`, and
the publish script is what knows the asset set: it refuses to publish unless all six are
present, refuses a tag that does not match `apps/desktop/package.json`, refuses a tag that
does not exist, and creates a published, non-draft release. Re-running it is safe: assets
are replaced with `--clobber`.

Then run the checks under "Verify after a release" above, and afterwards find out why
Actions could not cut the release — a hand-cut release is a workflow bug left standing.
