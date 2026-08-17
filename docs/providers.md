# Connect providers and Linear

Luke reads local providers automatically. Cloud providers and Linear remain
inactive until you add a credential in Luke's Settings. You can also supply the
matching environment variable when launching Luke from a terminal.

## Local providers

Luke reads sessions on this Mac from Claude Code, Codex, Cursor, and OpenCode.
These integrations require no provider credential.

Luke adds an observation hook to Claude Code's user-level
`~/.claude/settings.json`. It preserves existing settings and refuses to rewrite
a file it cannot parse. The hook writes fixed status tokens under Luke's own
application data so Luke can recognize turn boundaries promptly. Session
observation continues from local transcripts when the hook is absent.

## Cloud providers

Open **Settings**, find the provider under **Connections**, select **Connect**,
and paste the requested credential.

| Provider | Credential | Environment variable |
| --- | --- | --- |
| Conductor | API key from Settings · API keys | `CONDUCTOR_API_KEY` or `CONDUCTOR_API_TOKEN` |
| GitHub Copilot | Fine-grained personal access token with **Agent tasks** read access, or a GitHub App user token | `COPILOT_API_KEY` |
| Cursor | API key from Integrations · API keys | `CURSOR_API_KEY` |
| Devin | Personal access token beginning with `cog_` | `DEVIN_API_KEY` |
| Jules | API key from Jules Settings | `JULES_API_KEY` |

Classic GitHub personal access tokens and GitHub App installation tokens do not
work with Copilot's agent-tasks API. Devin's older `apk_` credentials do not
work with the v3 API Luke reads.

Environment variables are useful for development. An app opened from Finder
does not normally inherit variables exported by your shell, so Settings is the
recommended setup for regular use. Credentials saved in Settings are encrypted
through the macOS Keychain and are not returned to the renderer.

## Linear

Connect a Linear personal API key beginning with `lin_api_` under **Settings ·
Integrations**. You can also launch Luke with `LINEAR_API_KEY`.

Luke reads open issues assigned to you. In a conversation you start, you can ask
Luke about those issues, move one to a state its team allows, or add a comment.
Luke does not read issue descriptions or existing comment threads.

## What Luke can change

Observation does not call provider write routes. Luke sends a message, runs a
provider control, creates a supported workspace, or changes a Linear issue only
when you explicitly request that action. The request must match an item or
capability from Luke's latest observation.

See [Privacy](../PRIVACY.md) for the fields each integration reads and sends.

## Related documentation

- [Talk to Luke](voice.md)
- [Configuration reference](configuration.md)
- [Privacy](../PRIVACY.md)
