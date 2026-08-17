# Luke

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/luke-wordmark-dark.svg">
    <img src="design/brand/luke-wordmark-light.svg" alt="Luke" width="360">
  </picture>
</p>

**Your AI engineering manager.**

Luke is an open-source macOS app that watches your coding-agent sessions and
shows you which ones need your attention. It sits beside the MacBook camera
housing and works without changing how your agents run.

Luke v0.1 is an Apple Silicon developer preview for macOS 14 and newer.

## Download

Download the latest build from
[GitHub Releases](https://github.com/ReviewStage/luke/releases).

Visit [tryluke.dev](https://tryluke.dev) to see Luke in action.

## Features

- See local and cloud coding-agent sessions in one place.
- Know which sessions are working, waiting, complete, or failed.
- Review current activity, errors, repository context, and turn recaps.
- Filter and sort sessions by location, provider, urgency, or recency.
- Ask Luke about supported local sessions by voice or text.
- Send messages and supported controls only when you explicitly ask Luke to.
- Receive optional spoken announcements — and a pressable notice at the
  notch — when a session needs you.
- View assigned Linear issues and, when asked, update their state or add a
  comment.

## Supported integrations

| Integration | Support | Credential required |
| --- | --- | --- |
| Claude Code | Local sessions | No |
| Codex | Local sessions | No |
| Conductor | Cloud sessions | Yes |
| GitHub Copilot | Cloud agent tasks | Yes |
| Cursor | Local and cloud sessions | Cloud only |
| Devin | Cloud sessions | Yes |
| Jules | Cloud sessions | Yes |
| OpenCode | Local sessions | No |
| Linear | Assigned issues | Yes |

Cloud integrations remain inactive until you add their credentials in Luke's
Settings. Voice and optional attention review require an OpenAI API key.

## Privacy

Luke observes provider state without changing provider transcripts or session
files. Its one provider-side write is an observation hook registered for
Claude Code and Codex in their own hook settings — it records a session's
status, never its conversation, and Codex asks you to trust it before it
runs. Local session data stays on your Mac unless you start a feature that
requires an external service. Messages, controls, workspace creation, and issue
updates run only when you explicitly request them, and Luke reads a local
session's transcript only when you ask about that session.

See [PRIVACY.md](PRIVACY.md) for the data sent by each optional integration and
how credentials are stored.

## Build from source

### Requirements

- Apple Silicon Mac running macOS 14 or newer
- Node.js 22.12 or newer
- pnpm 9.15.0
- Xcode Command Line Tools

From a fresh checkout:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
./scripts/run.sh
```

`./scripts/run.sh` replaces any running Luke instance by default and stops the
app when you press Control-C. Pass `--keep-running` to leave an existing
instance in place.

Run the complete macOS validation suite with:

```sh
./scripts/verify.sh
```

Run the website locally with:

```sh
pnpm --filter @luke/web dev
```

## Project structure

- `apps/desktop/` — Electron app, renderer, native macOS helper, and packaging
- `apps/web/` — public website
- `packages/sidecar-core/` — shared session and attention models
- `scripts/` — development and validation commands

## Contributing

See [WORKFLOW.md](WORKFLOW.md) for the issue-to-pull-request workflow.

## Documentation

- [Privacy details](PRIVACY.md)
- [Maintainer release guide](.github/RELEASE.md)

## License

Luke is licensed under the [Apache License 2.0](LICENSE).
