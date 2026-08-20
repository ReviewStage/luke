# Luke

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/luke-wordmark-dark.svg">
    <img src="design/brand/luke-wordmark-light.svg" alt="Luke" width="360">
  </picture>
</p>

**Your AI engineering manager.**

Luke is an open-source macOS app that watches your coding agent sessions and
shows you which ones need your attention. It sits in the MacBook notch and
works without changing how your agents run.

<p align="center">
  <a href="https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg"><picture><source media="(prefers-color-scheme: dark)" srcset="design/brand/button/luke-cta-download-dark.svg"><img src="design/brand/button/luke-cta-download-light.svg" alt="Download for macOS"></picture></a>&nbsp;&nbsp;&nbsp;<a href="https://tryluke.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="design/brand/button/luke-cta-site-dark.svg"><img src="design/brand/button/luke-cta-site-light.svg" alt="Visit tryluke.dev"></picture></a>
</p>

![The panel expanded from the notch over the desktop, listing agent sessions with their status, recaps, and follow-up fields.](apps/web/public/changelog/0.1.0/one-panel-for-every-agent.png)

One panel shows all of your local and cloud coding agents.

## Install

Luke runs on Apple Silicon Macs with macOS 14 or newer.

1. [Download Luke](https://github.com/ReviewStage/luke/releases/latest/download/Luke.dmg).
2. Open the DMG and drag **Luke** into **Applications**.
3. Launch Luke and sign in with Google or GitHub.

Local sessions appear with no further setup. Cloud integrations stay inactive
until you connect them in Luke's Settings.

## Talk to Luke

Press and hold `⌥`+`Space` to talk. Press again while Luke is talking to cut
him off, and `⌥`+`S` to stop him.

Use `⌥`+`L` to type out a message to Luke instead.

Voice is included under a daily allowance, or you can connect your own OpenAI
key in Settings.

Voice is the one feature that sends audio off your Mac. Refer to
[PRIVACY.md](PRIVACY.md).

Luke also counts how his own features are used, on by default — switch it off
under **Share usage data** in Settings.

## Supported agents and apps

Every row leads with its agent — the provider the session belongs to:

| Agent | Local | Cloud |
| --- | :---: | :---: |
| Claude Code | ✅ | |
| Codex | ✅ | ✅ |
| Conductor | | ✅ |
| Cursor | ✅ | ✅ |
| Devin | ✅ | ✅ |
| GitHub Copilot | | ✅ |
| Jules | | ✅ |
| OpenCode | ✅ | |

Luke also marks the apps holding a session on your Mac — ChatGPT, cmux,
Conductor, Orca, and Superset — grouping rows under their workspaces and
opening the exact window an app documents. Superset-managed rows can
additionally take messages and workspace acts through Superset's own CLI.

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for what Luke can read and write
per agent and app, and [PRIVACY.md](PRIVACY.md) for the data's point of view.

## Build from source

Requires an Apple Silicon Mac on macOS 14 or newer, Node.js 22.12 or newer,
pnpm 9.15.0, and the Xcode Command Line Tools.

```sh
./scripts/run.sh
```

Run the complete macOS validation suite with `./scripts/verify.sh`, and the
website locally with `pnpm --filter @luke/web dev`.

## License

Luke is licensed under the [Apache License 2.0](LICENSE).