<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/luke-wordmark-dark.svg">
    <img src="design/brand/luke-wordmark-light.svg" alt="Luke" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/ReviewStage/luke/actions/workflows/ci.yml"><img src="https://github.com/ReviewStage/luke/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ReviewStage/luke/releases/latest"><img src="https://img.shields.io/github/v/release/ReviewStage/luke?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/macOS-14%2B%20%C2%B7%20Apple%20silicon-black" alt="macOS 14 or newer, Apple silicon">
</p>

<p align="center">
  <strong>An engineering manager for your coding agents.</strong><br>
  A macOS voice agent that keeps you in the loop with your agents.
</p>

<p align="center">
  <a href="https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg"><picture><source media="(prefers-color-scheme: dark)" srcset="design/brand/button/luke-cta-download-dark.svg"><img src="design/brand/button/luke-cta-download-light.svg" alt="Download for macOS"></picture></a>
</p>

<p align="center">
  <a href="https://tryluke.dev">Website</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

![Luke's panel expanded from the notch, listing local and cloud agent sessions with their status, recaps, and workspace grouping.](docs/media/luke-panel.png)

## Features

### Talk to Luke

Hold <kbd>⌥</kbd><kbd>Space</kbd> to talk to Luke from any app, or press
<kbd>⌥</kbd><kbd>L</kbd> to type to him instead. He can tell you about the
status of your agents, kick fresh ones off for you, or message them on your
behalf.

![Luke's capsule under the notch, speaking a summary of which sessions finished and which are waiting.](docs/media/luke-talking.png)

### Announcements

Luke speaks up when an agent is waiting for you, hits an error, or finishes.

### Compatible with every agent and platform

Luke works with any agent, both locally and in the cloud. See a full list
of supported agents below.

### Works around your schedule

Connect your calendar and Luke stays quiet until your meeting is over.

## Supported agents and platforms

<!-- provider-agents:start -->
| Agent | Local | Cloud |
| --- | :---: | :---: |
| Antigravity | ✅ |  |
| Claude Code | ✅ |  |
| Codex | ✅ | ✅ |
| Conductor |  | ✅ |
| Copilot |  | ✅ |
| Cursor | ✅ | ✅ |
| Devin | ✅ | ✅ |
| Gemini CLI | ✅ |  |
| Grok Build | ✅ |  |
| Jules |  | ✅ |
| OpenCode | ✅ |  |
| Radius | ✅ |  |
| Replicas |  | ✅ |
<!-- provider-agents:end -->

## Install

Luke runs on Apple Silicon Macs with macOS 14 or newer.

1. [Download Luke](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg).
2. Open the DMG and drag **Luke** into **Applications**.
3. Launch Luke and sign in with Google or GitHub.

Optional: open **Settings** in Luke to:

- Connect supported cloud agents with their API keys.
- Connect Apple or Google Calendar.
- Connect Linear.
- Add an OpenAI API key for usage billed directly to your OpenAI account.
- Customize Luke's voice, keyboard shortcuts, appearance, workspace defaults,
  and data-sharing preferences.

Local agents are detected automatically and do not require API keys.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
to get set up, and [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## License

Luke is licensed under the [Apache License 2.0](LICENSE).
