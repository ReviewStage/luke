<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/brand/assets/luke-wordmark-dark.svg">
    <img src="packages/brand/assets/luke-wordmark-light.svg" alt="Luke" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/ReviewStage/luke/actions/workflows/ci.yml"><img src="https://github.com/ReviewStage/luke/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ReviewStage/luke/releases/latest"><img src="https://img.shields.io/github/v/release/ReviewStage/luke?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/macOS-14%2B%20%C2%B7%20Apple%20silicon-black" alt="macOS 14 or newer, Apple silicon">
</p>

Luke is a macOS app for planning a change with coding agents, handing it to
them to build, and reviewing what they ship.

**Status:** an early MVP. It runs on Apple silicon Macs with macOS 14 or newer,
and nowhere else yet. It is free.

You describe the change to a coding agent, typed or dictated. It reads the
repository, asks about what you left open, and writes the plan as a design doc
as you go. Press **Start** and a coding agent implements the plan in a cloud
sandbox and opens a pull request. Its questions come back to your Inbox, and
you review the pull request without leaving the app. Or copy the plan into
Claude Code, Codex, or any other agent.

## How it works

1. **Discuss.** Create a task on a GitHub repository and message a coding
   agent on it, typing or dictating. It reads the repository in a sandbox of
   its own, and hands longer searches to read-only workers so the
   conversation keeps going.
2. **Plan.** The agent writes what you settle into the task's plan: a
   Markdown document you can edit, comment on, and restore from version
   history. Each section says who last wrote it: you, a teammate, or an
   agent.
3. **Build.** **Start** hands the plan to a coding agent on the Claude or GPT
   model you pick. It works on a full checkout in a sandbox of its own, runs
   the tests, pushes a branch, opens the pull request as you with Luke as
   co-author, and fixes the checks that fail. You can message it mid-run or
   open a terminal in its sandbox.
4. **Review.** When an agent needs a decision, a manual step, or your eyes on
   something, it posts to the Inbox with the lines of code or the screenshot
   it is about, and your answer goes back to it. The pull request opens in a
   tab with its conversation, checks, and diff, and a review left on GitHub
   reaches the agent too.

## Features

- **Plans** start empty, and hold pictures and Mermaid diagrams.
- **Coding agents** hand scoped work to read-only subagents on a model and
  effort they choose, message and start other agents in the workspace, and
  show you screenshots or an interactive HTML page of what they built.
- **Workspaces** share tasks and agents with your team, on the repositories
  of the GitHub account or organization the workspace connects.
- **Integrations** reach Linear, Notion, Sentry, Slack, GitHub, Granola,
  Mercury, Neon, PostHog, Supabase, Vercel, Y Combinator, and Executor through
  each service's own MCP server, for every agent.
- **Skills** in the repository's `.agents/skills` or `.claude/skills` are
  offered to agents, and `/` in an agent's message box picks one.
- **Run on this Mac** checks an agent's branch out in a local worktree with
  your own git login and opens a terminal on it inside Luke.
- **Your own keys**: coding agents run on your Claude or ChatGPT subscription
  or on your Anthropic or OpenAI API key, added in Settings › Agents. Luke
  pays for no model calls.
- **Automations** start agents on a schedule, a GitHub event, an
  integration's event, or a webhook.

![The Inbox: a coding agent asks whether invite links should expire after 7 or 14 days, over the two lines of code that decide it, with your pick and your reply.](apps/web/public/changelog/0.13.0/the-inbox-one-item-at-a-time.png)

## Install

Requires an Apple silicon Mac on macOS 14 or newer.

1. Download [Luke.dmg](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg),
   open it, and drag **Luke** into **Applications**.
2. Open Luke and sign in with Google or GitHub.
3. Connect GitHub in Settings › Workspace › Integrations, which installs the
   Luke GitHub App on the account or organization whose repositories you want
   to work on. A workspace's owner or an admin connects it.

Luke asks for microphone access the first time you dictate, and updates
itself.

## Where your code and data go

Luke is a desktop app backed by a hosted service, and both are in this
repository.

- **Your code** is read in a [Vercel Sandbox](https://vercel.com/docs/sandbox),
  not on your Mac. The GitHub App mints a token for that one repository, and
  the service sets it at the sandbox's network firewall, so it never enters
  the sandbox. Each coding agent gets a sandbox of its own and pushes through
  the same App.
- **Models.** Every model call runs on your own keys or subscriptions, added
  in Settings › Agents; Luke pays for none. Dictation runs on OpenAI, on your
  OpenAI API key, and is off without one; the recording goes through Luke's
  service to OpenAI. Coding agents run on Anthropic or OpenAI, depending on the
  model you pick, on your subscription or API key.
- **Commands on your Mac.** Coding agents can run shell commands on your
  Mac, in your login shell, and what they print goes to the model. This is
  how an agent reads a local checkout or a server you have running. Luke asks
  before each command by default; choose Always allow or Never in Settings ›
  This Mac.

[PRIVACY.md](PRIVACY.md) lists everything Luke stores, every provider it sends
data to, and how long each keeps it.

## Open source and the hosted service

The app is open source under the [Apache License 2.0](LICENSE). It signs in to
a hosted service at [tryluke.dev](https://tryluke.dev), run by Stage Inc.,
which is free to use. The service's code is in this repository to read, but
running your own copy of it is not supported yet.

Hosted coding agents run Anthropic's Claude Code through the Claude Agent SDK,
which is proprietary and not covered by this repository's license, or OpenAI's
Codex, depending on the model you pick.

Third-party names and logos, such as those of the integrations above, belong
to their owners. Their use here does not mean those owners endorse Luke.

## Contributing

Setup, repository layout, and checks are in [CONTRIBUTING.md](CONTRIBUTING.md).
[CHANGELOG.md](CHANGELOG.md) describes every release and links the pull
requests behind it. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
