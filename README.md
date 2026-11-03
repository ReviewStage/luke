<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/brand/assets/logo/logo-dark.svg">
    <img src="packages/brand/assets/logo/logo-light.svg" alt="Vespin" width="360">
  </picture>
</p>

<h3 align="center">An inbox for all your coding agents.</h3>

<p align="center">
  Plan a change with an agent, hand it to coding agents that open the pull requests,<br>
  and answer them from one inbox when they need you.
</p>

<p align="center">
  <a href="https://vespin.dev"><strong>Website</strong></a> ·
  <a href="https://github.com/ReviewStage/vespin/releases/latest/download/Luke.dmg"><strong>Download for macOS</strong></a> ·
  <a href="https://vespin.dev/app"><strong>Open in the browser</strong></a> ·
  <a href="CHANGELOG.md"><strong>Changelog</strong></a> ·
  <a href="CONTRIBUTING.md"><strong>Contributing</strong></a>
</p>

<p align="center">
  <a href="https://github.com/ReviewStage/vespin/actions/workflows/ci.yml?query=event%3Amerge_group"><img src="https://github.com/ReviewStage/vespin/actions/workflows/ci.yml/badge.svg?event=merge_group" alt="CI"></a>
  <a href="https://github.com/ReviewStage/vespin/releases/latest"><img src="https://img.shields.io/github/v/release/ReviewStage/vespin?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/macOS-14%2B%20%C2%B7%20Apple%20silicon-black" alt="macOS 14 or newer, Apple silicon">
  <a href="https://github.com/ReviewStage/vespin/stargazers"><img src="https://img.shields.io/github/stars/ReviewStage/vespin?style=flat" alt="GitHub stars"></a>
</p>

<p align="center">
  <img src="apps/web/public/changelog/0.24.0/sub-tasks-and-blocked-tasks.png" alt="Vespin on a Mac: a task's plan with its sub-tasks, each worked on by a coding agent, and the workspace's tasks in the sidebar." width="900">
</p>

---

## What is Vespin?

Vespin is a macOS app, with a web app beside it, for working through a task
with coding agents. You describe the change, typed or dictated. An agent reads
the repository, asks about what you left open, and writes the plan as you go.
Press **Start** and a coding agent implements the plan in a cloud sandbox and
opens a pull request, which you review without leaving the app.

An agent posts to your **Inbox** when it needs a decision, a manual step, or
your eyes on something, and you answer it there. A task breaks into sub-tasks
that agents work on, agents start and message other agents, and every one of
them runs on your own Claude or ChatGPT subscription or API key.

> [!NOTE]
> Vespin is an early MVP. It runs on Apple silicon Macs with macOS 14 or newer
> and in a browser at [vespin.dev/app](https://vespin.dev/app). It is free.

## Quick start

1. **Download** [Vespin for macOS](https://github.com/ReviewStage/vespin/releases/latest/download/Luke.dmg),
   open it, and drag **Vespin** into **Applications**.
2. **Sign in** with Google or GitHub.
3. **Connect GitHub.** In Settings › Workspace, under **Workspace
   connections**, press **Connect** on the GitHub row to install the Vespin
   GitHub App on the account or organization whose repositories you work on.
   A workspace's owner or an admin connects it.
4. **Add your model.** In Settings › Agents, connect your Claude or ChatGPT
   subscription, or an Anthropic or OpenAI API key.
5. **Create a task** on a repository and start talking to an agent.

Vespin asks for microphone access the first time you dictate, and updates
itself.

## How it works

| | Step | What happens |
| --- | --- | --- |
| 💬 | **Discuss** | Create a task on a GitHub repository and message a coding agent on it. It reads the repository in a sandbox of its own and hands longer searches to read-only workers, so the conversation keeps going. |
| 📝 | **Plan** | The agent writes what you settle into the task's plan: a Markdown document you can edit, comment on, and restore from version history. Each section says who last wrote it: you, a teammate, or an agent. |
| 🛠️ | **Build** | **Start** hands the plan to a coding agent on the Claude or GPT model you pick. It works on a full checkout in a sandbox, runs the tests, opens the pull request under your GitHub account, and fixes the checks that fail. Message it mid-run or open a terminal in its sandbox. |
| ✅ | **Review** | When an agent needs you, it posts to the Inbox with the lines of code or the screenshot it is about. The pull request opens in a tab with its conversation, checks, diff, and a Chapters view that splits the diff into chapters, each with its risk. |

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="apps/web/public/changelog/0.19.0/inbox-asks.png" alt="An Inbox thread: a coding agent shows two invite emails it built and asks which should ship, with its recommendation.">
      <p align="center"><b>The Inbox</b>: agents ask, you answer.</p>
    </td>
    <td width="50%" valign="top">
      <img src="apps/web/public/changelog/0.19.0/pull-request-chapters.png" alt="A pull request's Chapters view: the diff split into chapters, each with a summary, its risk, and what to review.">
      <p align="center"><b>Chapters</b>: review a pull request one part at a time.</p>
    </td>
  </tr>
</table>

## Features

- 📥 **The Inbox.** Threads your agents open, each with the lines of code or
  the screenshot it is about. Pick an option, fill in a form, mark a step
  done, or reply, and your answer goes back to the agent.
- 🌳 **Sub-tasks and blocked tasks.** Break a task down, nest sub-tasks under
  it, and make a task wait on others. Agents make sub-tasks and set blocks too.
- 🤖 **Coding agents** hand scoped work to read-only subagents, message and
  start other agents in the workspace, and show you screenshots or an
  interactive HTML page of what they built.
- 🔍 **Pull request review** in a tab with the conversation, checks, diff, and
  Chapters. A review left on GitHub reaches the agent too.
- 🌐 **The Browser tab** shows an agent's cloud browser live beside the plan.
  Press **Take over** to sign in or steer it, then **Hand back**.
- 🖼️ **Plans** hold pictures and Mermaid diagrams.
- 👥 **Workspaces** share tasks and agents with your team, on the repositories
  of the GitHub account or organization the workspace connects.
- 🔌 **Integrations** reach Linear, Notion, Sentry, GitHub, Granola, Mercury,
  Neon, PostHog, Stripe, Supabase, Vercel, Y Combinator, and Executor through
  each service's own MCP server, for every agent. Gmail, Google Calendar, and
  Google Drive are offered to some accounts so far, and Slack to none yet.
- 🧩 **Skills** in the repository's `.agents/skills` or `.claude/skills` are
  offered to agents.
- 🔑 **Your own keys.** Coding agents run on your Claude or ChatGPT
  subscription or your Anthropic or OpenAI API key. Vespin pays for no model
  calls.
- ⏰ **Automations** start agents on a schedule, a GitHub event, an
  integration's event, or a webhook.
- 🧪 **Experiments** in Settings › Experimental, each off until you turn it
  on: **Pilot**, which plans a new task, splits it into sub-tasks, and runs an
  agent on each; **Memory**, facts agents keep about how your team works;
  **Skills** you install in Settings › Skills and pick with `/`; and **Bring
  your own host**, below.

See [CHANGELOG.md](CHANGELOG.md) for what each release added.

## Where your code and data go

Vespin is a desktop app and a web app backed by a hosted service, and all
three are in this repository.

- **Your code** is read in a [Vercel Sandbox](https://vercel.com/docs/sandbox),
  not on your Mac. The GitHub App mints a token for that one repository, and
  the sandbox's firewall adds it to the sandbox's outbound requests to GitHub,
  so code in the sandbox never sees it. Each coding agent gets a sandbox of its
  own and pushes through the same App.
- **Models.** Every model call runs on your own keys or subscriptions, added
  in Settings › Agents; Vespin pays for none. Dictation runs on OpenAI, on your
  OpenAI API key, and is off without one; the recording goes through Vespin's
  service to OpenAI. Coding agents run on Anthropic or OpenAI, depending on the
  model you pick, on your subscription or API key.
- **Commands on your Mac.** Vespin asks before each command an agent runs on
  your Mac; choose Always allow or Never for "Let agents run commands on this
  Mac" in Settings › This Mac. Commands run in your login shell, and what they
  print goes to the model. This is how an agent reads a local checkout or a
  server you have running.
- **Agents on your own machines** (experimental). With Bring your own host on
  in Settings › Experimental, an agent can run on This Mac, or on a Mac or
  Linux machine you add in Settings › Hosts, instead of in a sandbox. It runs
  straight on that machine, as you or the user Vespin's host program runs as,
  with full access to whatever that account can reach. Its work stays on the
  machine; its transcript and the files its tools read still reach Vespin's
  service.
- **Telemetry.** Vespin sends PostHog counts of which features you use, under
  your account and never what you type. It also records what its own panel
  draws for PostHog, with every word masked, only while you are signed in, and
  files the recording under your account with your name and email. It sends
  Sentry crash, error, and performance reports, which name your account by its
  id. Turn the usage counts off with "Share usage data" in Settings › Account;
  it is on by default in the app you download and off in a build you run from
  source.

[PRIVACY.md](PRIVACY.md) lists everything Vespin stores, every provider it
sends data to, and how long each keeps it.

## Build from source

You need an Apple silicon Mac on macOS 14 or newer with the Xcode Command Line
Tools, Node.js 24 or newer, and the pnpm version the root `package.json` pins
(`corepack enable` installs it).

```sh
git clone https://github.com/ReviewStage/vespin.git
cd vespin
./scripts/bootstrap.sh              # install pinned workspace dependencies
./scripts/run.sh --fixture smoke    # run the app on fixture data, no account needed
./scripts/run.sh                    # run the app against vespin.dev
```

The checks also run on Linux. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
repository layout, the checks, and how to open a pull request.

## Repository layout

| Path | What it holds |
| --- | --- |
| [`apps/desktop`](apps/desktop) | The Electron app for macOS |
| [`apps/web`](apps/web) | The web app, the website, and the hosted service's routes |
| [`apps/host`](apps/host) | `vespin-host`, which runs agents on your own Mac or Linux machine |
| [`apps/catalog`](apps/catalog) | Every shared UI component, drawn on synthetic data |
| [`packages/`](packages) | The application logic: the UI kit, the panel every client mounts, the service, and more |
| [`tools/`](tools) | Lint rules and developer tools |
| [`docs/`](docs) | Design and style guides |

## Open source and the hosted service

The app is open source under the [Apache License 2.0](LICENSE). It signs in to
a hosted service at [vespin.dev](https://vespin.dev), run by Stage Inc., which
is free to use. The service's code is in this repository to read, but running
your own copy of it is not supported yet.

Hosted coding agents run Anthropic's Claude Code through the Claude Agent SDK,
which is proprietary and not covered by this repository's license, or OpenAI's
Codex, depending on the model you pick.

Third-party names and logos, such as those of the integrations above, belong
to their owners. Their use here does not mean those owners endorse Vespin.

## FAQ

<details>
<summary><b>Is it free?</b></summary>

Yes. The app and the hosted service at [vespin.dev](https://vespin.dev) are
free to use. Models run on your own subscription or API key, and Vespin pays
for none.
</details>

<details>
<summary><b>Can I self-host it?</b></summary>

Not yet. The service's code is in this repository to read, but running your
own copy of it is not supported. The experimental Bring your own host runs
agents on your own machines, and they still work through the hosted service.
</details>

<details>
<summary><b>Does it run on Windows or Linux?</b></summary>

The desktop app needs an Apple silicon Mac on macOS 14 or newer. On any other
machine, use Vespin in the browser at [vespin.dev/app](https://vespin.dev/app).
</details>

<details>
<summary><b>Which agents and models does it use?</b></summary>

Coding agents run Claude Code or Codex, on the Claude or GPT model you pick,
on your own subscription or API key. You can also copy a plan into Claude
Code, Codex, or any other agent.
</details>

## Community and support

- 🐛 Found a bug or want a feature? [Open an issue](https://github.com/ReviewStage/vespin/issues/new/choose).
- 🤝 Want to contribute? Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
  the [Code of Conduct](CODE_OF_CONDUCT.md).
- 🔒 Found a vulnerability? Follow [SECURITY.md](SECURITY.md) rather than
  opening a public issue.

## License

Vespin is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attributions.
