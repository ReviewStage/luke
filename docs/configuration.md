# Configuration reference

Luke is designed to be configured through Settings. Environment variables are
available for development, automation, and alternate API endpoints.

## Credentials

| Variable | Purpose |
| --- | --- |
| `CONDUCTOR_API_KEY` | Conductor API credential |
| `CONDUCTOR_API_TOKEN` | Alternate Conductor API credential name |
| `COPILOT_API_KEY` | GitHub user token for Copilot agent tasks |
| `CURSOR_API_KEY` | Cursor cloud API credential |
| `DEVIN_API_KEY` | Devin personal access token |
| `JULES_API_KEY` | Jules API credential |
| `LINEAR_API_KEY` | Linear personal API key |
| `OPENAI_API_KEY` | OpenAI credential for voice and attention review |

A credential stored in Settings takes precedence over its environment
variable. Environment credentials are read at launch and are not copied into
Luke's settings file.

## OpenAI

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Responses-compatible endpoint used only for attention review |
| `LUKE_ATTENTION_MODEL` | `gpt-5.6-luna` | Attention-review model |
| `LUKE_REALTIME_MODEL` | `gpt-realtime-2.1` | Voice conversation model |
| `LUKE_REALTIME_VOICE` | `cedar` | Initial voice when no choice is saved in Settings |
| `LUKE_REALTIME_SPEED` | `1` | Initial speaking pace when no choice is saved in Settings |

Supported speaking speeds are `0.75`, `1`, `1.25`, and `1.5`. An unsupported
voice or speed is ignored.

`OPENAI_BASE_URL` redirects attention-review requests and sends the OpenAI
bearer credential to that endpoint. It does not redirect voice conversations,
which use OpenAI's Realtime API.

## Provider endpoints

| Variable | Integration |
| --- | --- |
| `CONDUCTOR_API_URL` | Conductor |
| `COPILOT_API_URL` | GitHub Copilot |
| `CURSOR_API_URL` | Cursor |
| `DEVIN_API_URL` | Devin |
| `JULES_API_URL` | Jules |
| `LINEAR_API_URL` | Linear |

Changing an endpoint sends that integration's credential and request data to
the configured endpoint. Use endpoint overrides only with a service you trust.

## Related documentation

- [Connect providers and Linear](providers.md)
- [Talk to Luke](voice.md)
- [Privacy](../PRIVACY.md)
