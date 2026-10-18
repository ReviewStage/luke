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

Luke is a macOS app for planning a change by talking it through, then handing
it to coding agents and reviewing what they ship.

You describe the change out loud. Luke reads the repository while you talk,
asks about what you left open, and writes the plan as a design doc during the
call. Press **Start** and a coding agent implements the plan in a cloud
sandbox and opens a pull request. Its questions come back to your Inbox, and
you review the pull request without leaving the app. Or copy the plan into
Claude Code, Codex, or any other agent.

![A task's plan, written during a call: Context, Goal, Approach, Interfaces, and Alternatives, with the task's coding agents open as tabs beside it.](apps/web/public/changelog/0.12.0/the-plan-is-one-document.png)

## How it works

1. **Talk.** Create a task on a GitHub repository and press the microphone, or
   hold ⌥Space from any app. Luke answers by voice. While you talk he runs
   `grep`, `cat`, and `git log` on a checkout of the repository, and hands
   longer searches to background workers so the call keeps going.
2. **Plan.** A second model writes what the call settles into the task's plan:
   a Markdown document you can edit, comment on, and restore from version
   history. Each section says who last wrote it: you, Luke, a teammate, or an
   agent.
3. **Build.** **Start** hands the plan to a coding agent on the Claude or GPT
   model you pick. It works on a full checkout in a sandbox of its own, runs
   the tests, pushes a branch, opens the pull request as you with Luke as
   co-author, and fixes the checks that fail. You can message it mid-run, open
   a terminal in its sandbox, or ask Luke on a call how it is doing.
4. **Review.** When an agent needs a decision, a manual step, or your eyes on
   something, it posts to the Inbox with the lines of code or the screenshot
   it is about, and your answer goes back to it. The pull request opens in a
   tab with its conversation, checks, and diff, and a review left on GitHub
   reaches the agent too.

![The Call tab: two calls about the same task, with the commands, a background worker, and a command run on your Mac folded under the question that asked for them.](apps/web/public/changelog/0.12.0/the-call-tab.png)

## Features

- **Plans** start from a template you set in Settings › Plan template. The
  default reads like a design doc: Context, Goal, Approach, Interfaces,
  Alternatives, Hard parts, Not doing, Plan of attack, Testing, Open
  questions, and Assumptions. Plans hold pictures and Mermaid diagrams.
- **Coding agents** hand scoped work to read-only subagents on a model and
  effort they choose, message and start other agents in the workspace, and
  show you screenshots or an interactive HTML page of what they built.
- **Workspaces** share tasks, agents, and calls with your team, on the
  repositories of the GitHub account or organization the workspace connects.
- **Integrations** reach Linear, Notion, Sentry, Slack, GitHub, Granola,
  Mercury, Neon, PostHog, Supabase, Vercel, Y Combinator, and Executor through
  each service's own MCP server, for Luke and every agent. A task can start
  from a Linear issue.
- **Skills** in the repository's `.agents/skills` or `.claude/skills` are
  offered to Luke and agents, and `/` in an agent's message box picks one.
- **Run on this Mac** checks an agent's branch out in a local worktree with
  your own git login and opens a terminal on it inside Luke.
- **Your own API keys**: coding agents run on your Anthropic or OpenAI key if
  you add one in Settings › Coding agents, and on Luke's otherwise.

Automations (agents started on a schedule, a GitHub event, or a webhook),
issue tracking, and video calls are behind Settings › Experimental.

![The Inbox: a coding agent asks whether invite links should expire after 7 or 14 days, over the two lines of code that decide it, with your pick and your reply.](apps/web/public/changelog/0.13.0/the-inbox-one-item-at-a-time.png)

## Install

Requires an Apple silicon Mac on macOS 14 or newer.

1. Download [Luke.dmg](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg),
   open it, and drag **Luke** into **Applications**.
2. Open Luke and sign in with Google or GitHub.
3. Connect GitHub in Settings › Workspace › Integrations, which installs the
   Luke GitHub App on the account or organization whose repositories you want
   to work on. A workspace's owner or an admin connects it.

Luke asks for microphone access the first time you start a call, and updates
itself.

## Where your code and data go

Luke is a desktop app backed by a hosted service, and both are in this
repository.

- **Your code** is read in a [Vercel Sandbox](https://vercel.com/docs/sandbox),
  not on your Mac. The GitHub App mints a token for that one repository, and
  the service sets it at the sandbox's network firewall, so it never enters
  the sandbox. Each coding agent gets a sandbox of its own and pushes through
  the same App.
- **Models.** Voice and Luke's reasoning run on OpenAI, on Luke's key. Coding
  agents run on Anthropic or OpenAI, depending on the model you pick. Your
  voice streams to OpenAI and does not pass through Luke's service.
- **Commands on your Mac.** Luke and coding agents can run shell commands on
  your Mac, in your login shell and without asking, and what they print goes
  to the model. This is how an agent reads a local checkout or a server you
  have running. It is on by default; turn it off in Settings › This Mac › Let
  agents run commands on this Mac.

[PRIVACY.md](PRIVACY.md) lists everything Luke stores, every provider it sends
data to, and how long each keeps it.

## Contributing

Setup, repository layout, and checks are in [CONTRIBUTING.md](CONTRIBUTING.md).
[CHANGELOG.md](CHANGELOG.md) describes every release and links the pull
requests behind it. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
