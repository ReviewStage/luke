# Security policy

## Supported versions

Luke updates in place, and fixes ship as a new release rather than as patches to
an older one. Only the latest release is supported.

| Version | Supported |
| --- | :---: |
| Latest release | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

Email **founders@stagereview.app**. Please do not open a public issue for a
security report.

Include whatever you have: the Luke version, your macOS version, steps to
reproduce, and what an attacker gains. We will acknowledge the report and keep
you updated until it is resolved.

## What Luke touches

Luke reads coding-agent session files on your Mac and, once you connect them,
cloud provider APIs under keys you supply. Reports about these areas carry the
most weight:

- Provider API keys, OAuth grants, and the desktop's own account tokens are
  encrypted with Electron `safeStorage`, backed by the macOS login Keychain, and
  stay in the main process.
- Renderers run sandboxed with context isolation over a narrow IPC surface.
- Every act against a provider is validated against the latest observed session
  list in the renderer and again in the main process.
- `electron-updater` reads this repository's own release manifest. The archive's
  sha512 must match the manifest, the archive must sit on the same release, and
  Squirrel.Mac refuses a build whose code signature does not match the running
  app.

[PRIVACY.md](PRIVACY.md) describes what leaves your machine and what does not.
