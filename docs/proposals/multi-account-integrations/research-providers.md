# Research: does a second sign-in give a second, independent token?

For `docs/proposals/multi-account-integrations.md` §2. Read on 2026-10-15.
Labels: **D** means documented by the provider or its source code; **I**
means inference. For every Connect connector, all grants under it share one
OAuth client, the client Connect registered for that connector.

## The risk that decides it: a library that revokes older grants by default

Sentry's hosted MCP server runs on Cloudflare's
`@cloudflare/workers-oauth-provider`. When a new authorization completes,
that library revokes every earlier grant for the same user and client,
unless the server passes `revokeExistingGrants: false`.

- **The library (D).** The check in 1.2.3's `dist/oauth-provider.js`
  (`completeAuthorization`) is `if (options.revokeExistingGrants !== false)`.
  It then finds every grant whose `clientId` matches (and whose
  `redirectUri` matches for a client-ID-metadata-document client) and
  revokes them.
- **Sentry (D).** Sentry hit this, because re-authorizing one session killed
  the others, and it now passes `false`
  ([getsentry/sentry-mcp#924](https://github.com/getsentry/sentry-mcp/issues/924),
  "fix(oauth): stop cascading grant revocation across concurrent sessions").
- **Notion and Linear (I).** Both publish the same metadata fingerprint as
  Sentry. Fetched today from `/.well-known/oauth-authorization-server`:

  | Server | `revocation_endpoint` | `response_modes_supported` | `client_id_metadata_document_supported` |
  | --- | --- | --- | --- |
  | `mcp.sentry.dev` | `/oauth/token` (the token endpoint) | `["query"]` | `true` |
  | `mcp.notion.com` | `/token` (the token endpoint) | `["query"]` | `true` |
  | `mcp.linear.app` | `/token` (the token endpoint) | `["query"]` | `true` |

  So the two most likely to be asked for two workspaces may run the same
  library.
- **What that would mean.** Suppose either one keeps the default and passes
  the same `userId` for one person in both workspaces. Then signing in to
  the second workspace through Luke's one Notion connector silently revokes
  the first workspace's grant. Linear's user ids are per workspace, so a
  collision there is less likely (I). Notion's are per person (I).

Only a live test settles it: grant A, grant B, then use A's token (proposal
Appendix A). If a provider does revoke, proposal §3.9 gives the fallback,
which is a second connector, and so a second OAuth client, per account slot.

## Per provider

| Provider | What one grant reaches | Does a second grant revoke the first? | How the workspace is picked | Where a label comes from |
| --- | --- | --- | --- | --- |
| Notion (`mcp.notion.com`) | One workspace (D) | **Unknown, high risk** (library fingerprint, I). Every refresh rotates the token, and a reused refresh token kills the grant (D) | Workspace picker on Notion's consent page, which preselects the last-opened workspace (third-party report) | `workspace_name` in Notion's token response; the `notion-get-self` tool (D) |
| Linear (`mcp.linear.app`) | One workspace ("each workspace needs its own separate authentication context", D) | Unknown; same fingerprint (I) | REST OAuth: `prompt=consent` "to connect multiple workspaces" (D). MCP: the workspace active in the browser (I) | The `get_workspace` tool; REST `viewer.organization` |
| Slack (`mcp.slack.com`) | One workspace, as an `xoxp` user token (D); an Enterprise Grid org install is the exception | Probably not: Slack allows multiple installs by one user and its tokens do not expire (I) | `team` is only a hint, honored only when the browser is signed in to that workspace; the token response is the truth (D) | `team.id` in the token response; `auth.test` for the name |
| GitHub | Not through Connect in Luke; the account's own GitHub sign-in. One user token covers every installation that user can reach (D) | n/a | n/a | `GET /user` |
| Sentry (`mcp.sentry.dev`) | Every org the user belongs to, apparently (`find_organizations`, I) | **No (D)**: `revokeExistingGrants: false` | REST OAuth picks an org; for MCP it is unclear | `find_organizations`; user in the upstream token |
| Vercel (`mcp.vercel.com`) | The user, every team ("same access as your Vercel user account", D) | Unknown; refresh tokens rotate (D) | No team picker; a second account needs a different vercel.com session | OIDC userinfo; `list_teams` |
| Neon (`mcp.neon.tech`) | The user, or one project fixed at consent (D, from Neon's own MCP instructions) | Unknown (not the Cloudflare fingerprint) | Project choice on the consent page (D) | `list_organizations`, `list_projects` |
| Supabase (`mcp.supabase.com`) | The organization chosen at consent (D); whether that is a hard limit is unconfirmed | Unknown | Org picker; `organization_slug` preselects it (D) | `GET /v1/organizations` (I) |
| PostHog (`mcp.posthog.com`) | Chosen at consent: all orgs, some orgs, or some projects (D) | Unlikely: Django OAuth Toolkit does not revoke on a new grant (I) | Picker on the consent page (D) | `scoped_organizations`, `scoped_teams`; `/oauth/userinfo/` |
| Granola (`mcp.granola.ai`) | The user; follows the active workspace set in the desktop app (third-party report) | Unknown | No picker; sign out of the browser first | `get_account_info`: email and workspaces |
| Mercury (`mcp.mercury.com`) | Unknown | Unknown; no revocation endpoint published | Unknown | Unknown |
| Y Combinator (`api.ycombinator.com/v1/mcp`) | One YC account (I) | Unknown | n/a | Unknown. A person has one YC account, so this is probably moot |
| Executor (`mcp.executor.sh`) | One organization ("the grant is bound to one organization", D) | Probably additive: a second org is a separate approval (I) | Org chosen at sign-in (D) | None documented |

Sources: Notion
[build an MCP client](https://developers.notion.com/guides/mcp/build-mcp-client),
[authorization](https://developers.notion.com/docs/authorization); Linear
[MCP](https://linear.app/docs/mcp),
[OAuth 2.0](https://linear.app/developers/oauth-2-0-authentication); Slack
[MCP server](https://docs.slack.dev/ai/slack-mcp-server/),
[installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/);
GitHub
[user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[token revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation);
Sentry
[callback.ts](https://github.com/getsentry/sentry-mcp/blob/main/packages/mcp-cloudflare/src/server/oauth/routes/callback.ts),
[#924](https://github.com/getsentry/sentry-mcp/issues/924); Vercel
[Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp); Neon
[MCP server](https://neon.com/docs/ai/neon-mcp-server); Supabase
[MCP](https://supabase.com/docs/guides/getting-started/mcp); PostHog
[OAuth development guide](https://posthog.com/handbook/engineering/oauth-development-guide);
Executor [MCP](https://executor.sh/docs/mcp); Mercury
[OAuth2](https://docs.mercury.com/docs/integrations-with-oauth2).

## What it means for which providers to offer it on

- **Worth offering, once the probe passes:** Notion, Linear, Slack,
  Supabase, Executor, and PostHog. Each grant reaches one workspace or org,
  and a developer with two has a real reason to connect both.
- **Rarely useful:** Vercel, Neon, and Sentry. One grant already reaches
  every team or org the user is in, so a second account only helps for a
  different login.
- **Not applicable:** GitHub (granted by the account's own sign-in, not
  Connect) and Y Combinator.
- **Unknown until probed:** Granola and Mercury.
