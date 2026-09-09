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
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="mailto:founders@stagereview.app">Contact</a>
</p>

![Luke's panel expanded under the notch, listing local and cloud agent sessions with their status and workspace grouping, with the Ask Luke field at its foot.](docs/media/luke-panel.png)

## Features

### Talk to Luke

Hold <kbd>⌥</kbd><kbd>Space</kbd> to talk to Luke from any app, or press
<kbd>⌥</kbd><kbd>L</kbd> to type to him instead. He can tell you about the
status of your agents, kick fresh ones off for you, or message them on your
behalf.

The **Conversation** tab keeps your conversations with Luke on your Mac, across
launches, drawing its 200 most recent entries and nothing older than a
fortnight while keeping every entry stored, beside a transcript of Luke's own
turns that a compaction never erases. Its one control, Clear, removes the
conversation behind a compressed recovery archive kept on your Mac. The 20
most recent entries ride into Luke's next call beside his working memory of
what he read, said, and did, which lives in the same database and never
resets on its own: it stands until you clear it. Luke also silently keeps a
small local memory of useful preferences, personal context, goals, and
recurring constraints; ask him what he remembers, correct something, or tell
him to forget it.

![Luke's capsule under the notch, captioning a briefing about which sessions finished, which is still packaging, and which are waiting on you.](docs/media/luke-talking.png)

### Announcements

Luke speaks up when an agent is waiting for you, hits an error, or finishes. For
a local agent whose transcript he can read (Claude Code, Codex, and OMP today)
he reads what the transcript gained since he last looked; for a cloud agent he
goes by what its provider reports about it, and for a Conductor agent he can
also read the conversation itself when the status is not enough. Either way he judges whether it is
worth interrupting you for, and says everything worth saying in one breath
rather than a sentence per event.

### Compatible with every agent and platform

Luke works with any agent, both locally and in the cloud. See a full list
of supported agents below.

### Works around your schedule

Connect your calendar and Luke stays quiet until your meeting is over.

## Supported agents and platforms

<!-- provider-agents:start -->
| Agent | Local | Cloud |
| --- | :---: | :---: |
| Claude Code | ✅ |  |
| Codex | ✅ | ✅ |
| Conductor |  | ✅ |
| OMP | ✅ |  |
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
- Customize Luke's voice, keyboard shortcuts, appearance, and workspace
  defaults.

Local agents are detected automatically and do not require API keys.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
to get set up, and [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## Built by

[Charles Pan](https://x.com/ceefryingpan) and
[Dean Stratakos](https://x.com/DeanStratakos).

## License

Luke is licensed under the [Apache License 2.0](LICENSE).
