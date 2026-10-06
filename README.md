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
coding agent. You describe the feature, Luke reads your code and asks about
what you left open, and a second model writes the plan during the call. You
copy the finished plan into Claude Code, Codex, or any other agent.

![Luke's window with the plan "Teammate invitations" open and being written during a voice call.](docs/media/luke-plan.png)

## Install

Requires an Apple silicon Mac on macOS 14 or newer.

1. Download [Luke.dmg](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg).
2. Open the DMG and drag **Luke** into **Applications**.
3. Open Luke and sign in with Google or GitHub.

Luke asks for microphone access the first time you start a call.

## Usage

1. Press **New plan**, name it, and choose your project's folder.
2. Press the microphone and describe the feature.
3. Answer Luke's questions until the plan is complete.
4. Press **Copy** and paste the plan into your coding agent.

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

Luke doesn't upload your repository. When the planning model needs a file,
your Mac runs a read-only command such as `ls`, `grep`, or `cat` in the plan's
folder. The command runs in a macOS sandbox with no network access, no write
access, and no access to `.env` files. Only the command's output goes to
Luke's service. See [PRIVACY.md](PRIVACY.md) for details.

## Agent session monitoring

The repository also contains code that watches running agent sessions and
tells you by voice when one needs you. It is turned off in the current build.
It supports these agents:

<!-- provider-agents:start -->
| Agent | Local | Cloud |
| --- | :---: | :---: |
| Claude Code | ✅ |  |
| Codex | ✅ |  |
| Conductor |  | ✅ |
| OMP | ✅ |  |
<!-- provider-agents:end -->

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
