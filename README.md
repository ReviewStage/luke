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

Luke is a macOS app for planning a feature by voice before you hand it to a
coding agent. You describe the feature, Luke reads your repository and asks
about what you left open, and a second model writes the plan during the call.
Then you press Start and a coding agent implements the plan in a sandbox and
opens the pull request, or you copy the plan into Claude Code, Codex, or any
other agent.

![Luke's window with the plan "Teammate invitations" open and being written during a voice call.](docs/media/luke-plan.png)

## Install

Requires an Apple silicon Mac on macOS 14 or newer.

1. Download [Luke.dmg](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg).
2. Open the DMG and drag **Luke** into **Applications**.
3. Open Luke and sign in with Google or GitHub. Planning against a
   repository needs a GitHub sign-in and the Luke GitHub App installed on it,
   which Luke offers from the plan's repository chip.

Luke asks for microphone access the first time you start a call.

## Usage

1. Press **New plan**, name it, and choose its GitHub repository.
2. Press the microphone and describe the feature.
3. Answer Luke's questions until the plan is complete.
4. Press **Start** to have a coding agent implement it and open a pull
   request, or **Copy plan** to paste it into your own.

## Plan format

| Section | Contents |
| --- | --- |
| Goal | The current problem and the result you want |
| Scope | What's in, what's out, and the constraints |
| Rules | One sentence per rule, with Given/When/Then examples |
| Implementation | Files that change, new types and signatures, code to follow |
| Decisions | What was chosen, why, and the alternatives turned down |
| Verification | How to check the result end to end |
| Left to the agent | Choices the agent may make on its own |
| Open questions | Anything not yet decided |
| Assumptions | Defaults Luke chose that you didn't state |

The format draws on GitHub's [Spec Kit](https://github.com/github/spec-kit),
OpenAI's [ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans),
and [Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/).

## Code access

Nothing reads code on your Mac. Luke's service checks the plan's repository
out in a Vercel Sandbox, with a token the Luke GitHub App mints for that one
repository and sets at the sandbox's firewall, never inside it, and the
planning model runs commands such as `ls`, `grep`, or `cat` there. A coding
agent you start works in a sandbox of its own, on a full checkout, and pushes
its branch and pull request through the same App. See
[PRIVACY.md](PRIVACY.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
