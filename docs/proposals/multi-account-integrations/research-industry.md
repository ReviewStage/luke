# Research: how others handle more than one account per integration

For `docs/proposals/multi-account-integrations.md` §4. Read on 2026-10-15.
"Documented" means the product's own docs say so; "reported" means a forum,
an issue, press, or a third party does.

**In short.** Automation and auth platforms (Zapier, n8n, Composio, and
Pipedream with a caveat) make each connected account an object of its own,
with a name, and a step or a call picks one explicitly. Among chat
assistants, ChatGPT added several accounts per plugin in August and
September 2026, while Claude and Cursor still allow one account per
connector or integration.

## Cursor

- **Native integrations (Linear, Slack): one workspace each.** Connecting a
  second Linear workspace disconnects the first, and the advice is to
  disconnect and reconnect. Reported in forum replies, not documented; a
  feature request is open.
  [Linear and two workspaces](https://forum.cursor.com/t/linear-and-two-workspaces/159986),
  [Allow connecting multiple Linear workspaces](https://forum.cursor.com/t/allow-connecting-multiple-linear-workspaces/150483),
  [Slack automations and multiple workspaces](https://forum.cursor.com/t/bug-report-slack-channel-selection-in-automations-does-not-support-multiple-workspaces/155124).
- **MCP: undocumented.** Nothing in the docs covers adding the same remote
  server twice. OAuth tokens belong to an `mcpServers` entry, so a project
  config and a global config can hold different tokens (reported).
  [MCP docs](https://cursor.com/docs/context/mcp),
  [independent MCP sessions](https://forum.cursor.com/t/independent-mcp-sessions-on-project-level/111532).

## Claude (claude.ai, Desktop, Claude Code)

- **One account per connector.** Connecting a second account of a built-in
  connector replaces the first (reported by third-party guides; no Anthropic
  help page says so).
- **Custom connectors are unique by URL.** claude.ai refuses a second
  connector with the same server URL ("A server with this URL already
  exists"). Issue #178 asks for (URL, name) as the key, with one OAuth
  session per connector; it is open with no reply.
  [claude-ai-mcp#178](https://github.com/anthropics/claude-ai-mcp/issues/178).
- **The main request is
  [claude-code#27302](https://github.com/anthropics/claude-code/issues/27302)**
  (open since 2026-02-21, about 270 timeline items). It asks for results
  labeled by account, a default account or one per session, the account
  named in each tool call, and switching without disconnecting. That list is
  close to this proposal's design.

## ChatGPT

- **Several accounts per plugin, since 2026-08-28**, first for Gmail, Google
  Calendar, and Google Contacts. From a connected plugin's gear you authorize
  another account, and ChatGPT reads across them in one conversation
  ("check your calendars together"). On 2026-09-17 support reached more
  plugins on every plan. Read through press, because the release notes page
  refused the fetch.
  [9to5Mac](https://9to5mac.com/2026/08/28/chatgpt-and-codex-now-support-multiple-gmail-and-google-calendar-accounts/),
  [Mixed](https://mixed-news.com/en/chatgpt-multiple-accounts-plugins-all-plans/),
  [release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes).
- Undocumented: how an account is labeled, how the model picks one, and
  how to disconnect just one.

## Zapier

- **Documented, any number of connections per app.** The default label is
  the account's username or email, and it can be renamed ("Gmail -
  Marketing"). Each Zap step picks one connection. Reconnecting applies to
  every Zap that uses the connection. Deleting it cuts access, and every Zap
  that used it must be fixed.
- **Known problem:** the browser's cookies can quietly reuse the account
  already signed in. Zapier advises signing out of the app first or using a
  private window. Luke would meet the same problem (proposal §2, risk R4).
  [Manage app connections](https://help.zapier.com/hc/en-us/articles/8496258785421),
  [Add multiple accounts](https://help.zapier.com/hc/en-us/articles/8496290788109),
  [Reconnect](https://help.zapier.com/hc/en-us/articles/14709128297613).

## n8n

- **Credentials are named objects.** Each node picks one from a dropdown,
  and the docs advise names that give the "app or service, type, and
  purpose".
  [Credentials](https://docs.n8n.io/credentials/add-edit-credentials/).
- **Exception:** end-user credentials (Enterprise, preview) allow "a single
  account per end-user credential template".
  [End-user credentials](https://docs.n8n.io/administer/manage-credentials/end-user-credentials).

## Raycast

- **Undocumented; in practice one account per extension.** A `PKCEClient`
  holds one token set, optionally per `providerId`, and Raycast adds a
  logout preference that clears it. Several accounts would be the
  extension's own work. MCP servers are added by name and URL, and nothing
  documented confirms one OAuth session per entry.
  [OAuth API](https://developers.raycast.com/api-reference/oauth).

## Instinct (instinct.com)

Instinct is the invite-only personal agent from Spear Street Technology
(Noah Shinn). You text or call it. It has a web workspace at
`app.instinct.com` and a Mac app that pairs for iMessage and a local browser.

**What is documented: nothing about multiple accounts.**
- The [privacy policy](https://www.instinct.com/privacy-policy) names only
  Google ("Google Calendar, Gmail, Google Drive, Google Docs, Google Sheets,
  Google Slides and Google Tasks").
- It commits to Google's User Data Policy "including the Limited Use
  requirements".
- It says access is revoked by "disconnecting via your settings within
  Instinct's Workspace", and that disconnecting "does not automatically
  delete data collected from that integration".
- The [terms](https://www.instinct.com/terms) define "Connected Services" in
  general.

**What third parties report.** None of them mentions multiple accounts.
- [TechCrunch, 2026-08-24](https://techcrunch.com/2026/08/24/instincts-powerful-ai-assistant-is-raising-privacy-and-security-concerns/)
  covers testers' Gmail retention after disconnect.
- [usecarly review](https://www.usecarly.com/blog/instinct-review/): "Gmail,
  Calendar and Drive are offered as full-access links with no read-only
  option".
- [eesel setup guide](https://www.eesel.ai/blog/instinct-ai-for-email-management):
  "connect a personal Gmail only".
- [rywalker.com](https://rywalker.com/research/instinct): the legal pages
  define "Mac OS and mobile apps".
- [explainx on the 1Password partnership](https://explainx.ai/blog/instinct-1password-ai-agent-account-vaults-2026)
  covers Shinn's
  [2026-09-04 post](https://x.com/noahrshinn/status/2095911123291881608),
  which says 32% of users share credentials through Instinct's Vault.
- I found no App Store listing, help center, or changelog. X refused the
  fetch of the founder's posts.

**What the client code shows.** This is the Workspace page bundle that
`app.instinct.com/assets/WorkspacePage-*.js` serves without signing in, read
on 2026-10-15. It is undocumented and may change.

- **The GraphQL connection types are plural for four providers:**
  - `googleWorkspaceConnections` (fields: `id`, `email`, `isDefault`,
    `isRevoked`, and `services[]` with `serviceId`, `label`, `connected`);
  - `outlookConnections` (`id`, `email`, `displayName`, `isDefault`,
    `isRevoked`);
  - `linearConnections` (`id`, `organizationName`, `displayName`, `email`,
    `isDefault`, `isRevoked`);
  - `notionConnections` (`id`, `workspaceName`, `isDefault`, `isRevoked`).

  Each has `…SelectConnection` and `…DisconnectConnection(connectionId)`
  mutations.
- **Singular types:**
  - `githubConnection` (`username`);
  - `granolaConnection`;
  - `slackCanvasConnection` (`teamName`, `teamId`);
  - `spotifyConnection`, `whoopConnection`, `shopWalletConnection`,
    `stripeLinkConnection`;
  - `imessageLocalConnection`.
- **The UI strings:**
  - "Add account" (the button once a provider is connected), "Connect",
    "Connecting...", "At capacity";
  - "Primary", "Make primary" (offered only when there is more than one
    account), "Remove";
  - "Failed to change primary Notion workspace", "Failed to change primary
    Linear account", "Failed to change primary Google Workspace account",
    "Failed to change primary Outlook account";
  - "Instinct will no longer have access to this Google Workspace account.";
  - Notion's line, "Search, read, and manage Notion pages and databases";
  - Outlook's line, "Read, search, draft, send, and organize Outlook mail
    through Microsoft Graph".
- **Connecting** calls `startWebConnect(integrationId, scopeProfile)`, e.g.
  `integrationId: "google-workspace"` with `scopeProfile: "ONBOARDING"`. It
  answers a URL the browser follows.
- **No integration platform is named** anywhere in the bundles: no Composio,
  Pipedream, Nango, Merge, Paragon, or Arcade.
- **Inference:**
  - Instinct runs its own OAuth clients. The Limited Use commitment is what
    Google requires of an app requesting restricted Gmail scopes under its
    own verified client, with an annual CASA assessment
    ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
  - Its per-provider label fields (`workspaceName`, `organizationName`,
    `teamName`) are what each provider's own token response or identity call
    answers.

**Google, in general.**
- Every Google account a user authorizes is a separate grant to the same
  client.
- The only limit is "100 refresh tokens per Google Account per OAuth 2.0
  client ID", beyond which the oldest is invalidated.
- `prompt=select_account` and `login_hint` choose the account
  ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2),
  [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)).

## Auth platforms for agents

- **Composio has the most complete model.** It is opt-in (`allowMultiple`).
  Each account has an `alias` unique per user and toolkit, plus a read-only
  `displayName` taken from the provider. A session uses the most recently
  connected account unless `requireExplicitSelection` makes the agent pass
  `account` on every call. Accounts can be disabled, revoked, and deleted.
  [Connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts),
  [Managing multiple connected accounts](https://docs.composio.dev/docs/managing-multiple-connected-accounts).
- **Pipedream Connect:** several accounts per app can be connected, but "right now you can only use a single account
  for a given app" in a workflow, and the newest one wins.
  [Users](https://pipedream.com/docs/connect/managed-auth/users).
- **Arcade:** connecting several accounts of one provider goes through
  support, according to its FAQ as quoted in search results (the page itself
  did not load). [FAQ](https://docs.arcade.dev/en/home/faq).
- **Vercel Connect** documents installations (one tenant per connector,
  addressed by `installationId`, for an app subject). It does not document
  several accounts under one user subject; proposal §1 covers how distinct
  subjects provide that.
  [Installations](https://vercel.com/docs/connect/concepts/installations).

## What Luke takes from this

- **Each account is its own row with its own name.** The default name is
  the provider's (workspace, team, or email), and the developer can rename
  it (Zapier, Composio, n8n).
- **The agent sees every account, each labeled, and a mention pins one.**
  ChatGPT's "together" reading and claude-code#27302's ask point the same
  way. Requiring the agent to name an account on every call (Composio's
  `requireExplicitSelection`) is unnecessary in Luke, because every account
  is already its own connection with its own tool names.
- **A sign-in can silently pick the account the browser is already in.**
  Zapier documents this, so the add-account flow tells the developer which
  workspace to pick, and passes `prompt` where the provider honors it.
