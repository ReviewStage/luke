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
  <img src="https://img.shields.io/badge/macOS-14%2B%20%C2%B7%20Apple%20silicon-black" alt="macOS 14 or newer, Apple silicon">
</p>
<p align="center">
  <a href="https://vespin.dev">Website</a> - <a href="https://github.com/ReviewStage/vespin/releases/latest/download/Luke.dmg">Download</a> - <a href="https://vespin.dev/app">Web app</a> - <a href="CHANGELOG.md">Changelog</a> - <a href="https://github.com/ReviewStage/vespin/issues/new/choose">Bug reports</a>
</p>
<p align="center">
  <img src="apps/web/public/changelog/0.24.0/sub-tasks-and-blocked-tasks.png" alt="Vespin: a task's plan with its sub-tasks, each worked on by a coding agent">
</p>

## What's Vespin?

Vespin is an inbox for all your coding agents. An agent posts to your Inbox
when it needs a decision, a manual step, or your eyes on something, and you
answer it there. A task breaks into sub-tasks that agents work on, agents start
and message other agents, and they run on your own Claude or ChatGPT
subscription or API key.

<p align="center">
  <img src="apps/web/public/changelog/0.19.0/inbox-asks.png" width="270" alt="The Inbox: an agent asks which invite email should ship">
  <img src="apps/web/public/changelog/0.19.0/pull-request-chapters.png" width="270" alt="A pull request's Chapters view">
  <img src="apps/web/public/changelog/0.23.0/the-browser-tab.png" width="270" alt="The Browser tab">
</p>

## Features

- **Plans** written with an agent as you talk it through, typed or dictated.
- **Coding agents** that implement the plan in a cloud sandbox and open the pull request.
- **The Inbox**, where agents ask for a decision, a manual step, or your review.
- **Pull request review** with the diff split into chapters, each with its risk.
- **Sub-tasks** that break a task down for several agents to work on.
- **Integrations** with Linear, Notion, Sentry, Vercel, and more through MCP.
- **Your own keys**: agents run on your Claude or ChatGPT subscription or API key.

## Install

1. Download [Vespin for macOS](https://github.com/ReviewStage/vespin/releases/latest/download/Luke.dmg),
   open it, and drag **Vespin** into **Applications**.
2. Open Vespin and sign in with Google or GitHub.
3. In Settings › Workspace, under **Workspace connections**, press **Connect**
   on the GitHub row to install the Vespin GitHub App.

## Documentation

To see what each release added, visit [CHANGELOG.md](CHANGELOG.md).

To see how to contribute, visit [CONTRIBUTING.md](CONTRIBUTING.md).

To see what Vespin stores and every provider it sends data to, visit
[PRIVACY.md](PRIVACY.md).

## Community & Support

- [GitHub Issues](https://github.com/ReviewStage/vespin/issues). Best for: bugs and feature requests.
- [Security](SECURITY.md). Best for: reporting a vulnerability.

## License

The app is open source under the [Apache License 2.0](LICENSE). It signs in to
a hosted service at [vespin.dev](https://vespin.dev), run by Stage Inc., which
is free to use. The service's code is in this repository to read, but running
your own copy of it is not supported yet.

Hosted coding agents run Anthropic's Claude Code through the Claude Agent SDK,
which is proprietary and not covered by this repository's license, or OpenAI's
Codex, depending on the model you pick.

Third-party names and logos, such as those of the integrations above, belong
to their owners. Their use here does not mean those owners endorse Vespin.
