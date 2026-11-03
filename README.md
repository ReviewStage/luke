<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/brand/assets/logo/logo-dark.svg">
    <img src="packages/brand/assets/logo/logo-light.svg" alt="Vespin" width="360">
  </picture>
</p>
<p align="center">
  An inbox for all your coding agents.
</p>
<p align="center">
  <a href="https://github.com/ReviewStage/vespin/actions/workflows/ci.yml?query=event%3Amerge_group"><img src="https://github.com/ReviewStage/vespin/actions/workflows/ci.yml/badge.svg?event=merge_group" alt="CI"></a>
  <a href="https://github.com/ReviewStage/vespin/releases/latest"><img src="https://img.shields.io/github/v/release/ReviewStage/vespin?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0"></a>
</p>
<p align="center">
  <a href="https://vespin.dev">Website</a> - <a href="https://github.com/ReviewStage/vespin/releases/latest">Download</a> - <a href="https://vespin.dev/app">Web app</a> - <a href="CHANGELOG.md">Changelog</a>
</p>
<p align="center">
  <img src="apps/web/public/changelog/0.24.0/sub-tasks-and-blocked-tasks.png" alt="Vespin: a task broken into sub-tasks, each worked on by a coding agent">
</p>

## What's Vespin?

Vespin lets you work with many coding agents at once. Instead of jumping
between chats, your agents post to one inbox when they need a decision, a
to-do, or your review, and you reply there.

## Features

- **One inbox** for every agent's questions, to-dos, and updates.
- **Built-in task management**: agents break work into sub-tasks and hand them to other agents.
- **Agents that work together**: they start other agents, message each other, and manage your task board.
- **Cloud agents** that run Claude Code or Codex, open pull requests, and fix failing checks.
- **Pull request review** in the app, with the diff split into chapters.
- **Your own subscription**: agents run on your Claude or ChatGPT plan or API key.

## Get started

Download the [Mac app](https://github.com/ReviewStage/vespin/releases/latest)
(Apple silicon, macOS 14 or newer) or open [vespin.dev/app](https://vespin.dev/app).
Sign in, then connect GitHub in Settings › Workspace.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md). [PRIVACY.md](PRIVACY.md) lists what Vespin stores
and where it sends it.

## License

[Apache License 2.0](LICENSE). Hosted agents run Claude Code through
Anthropic's Claude Agent SDK, which is proprietary and not covered by this
license.
