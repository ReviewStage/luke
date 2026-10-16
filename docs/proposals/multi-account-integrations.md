# Proposal: more than one account per integration (two Notion workspaces)

Status: **Dean said go on 2026-10-15 ("Let's go forward with option A for
multiple accounts"), with every recommended decision (7.1–7.10), and it is
built as five stacked PRs held for Dean to try before any merges:** the rows
(1/5), the service and wire (2/5), the agents (3/5), the desktop (4/5), and
these docs (5/5). Two things in §3 were not built: the duplicate check
(§3.2), which waits on the probe showing whether Connect fills `tenantId` or
`externalSubject`, and `prompt` for any provider but Linear, which documents
its own. The probe (Appendix A) still gates offering a second account to
anyone but Dean; a provider that fails it is switched off with its
`<PROVIDER>_MULTIPLE_ACCOUNTS=off`.

The design show is `docs/proposals/multi-account-integrations/index.html`
(Settings › Integrations, the MCP popover, a mention, a disconnect, with two
Notion workspaces). The research is in the same folder:
`research-providers.md` (does a second sign-in give a second, independent
token, per provider) and `research-industry.md` (Cursor, Claude, ChatGPT,
Zapier, n8n, Raycast, Instinct, Composio, Pipedream, Arcade).

> Dean: "I would like to support connecting multiple accounts per MCP (e.g.,
> two Notion workspaces). Can we see if this is possible with our setup?"

## Summary

- **Yes, it is possible with our setup, without changing Connect,
  connectors, or environment variables.** Connect keys a grant by
  (connector, subject), and the subject id is any string Luke chooses under
  the project's OIDC token. So each extra account is a new subject, with its
  own `startAuthorization`, `getTokenResponse` and `revokeToken`, and its own
  SDK cache entry. Connect charges per token request, not per grant, and
  documents no cap on subjects (§1).
- **The real risk is on the provider's side, and only a live test settles
  it.** Notion's and Linear's hosted MCP servers publish the same OAuth
  metadata fingerprint as Sentry's, which is built on Cloudflare's
  `workers-oauth-provider`. That library revokes every earlier grant for the
  same (provider user, OAuth client) when a new one completes, unless the
  server opts out. Sentry opted out; whether Notion and Linear did is not
  public. All of a connector's grants share one OAuth client, so if Notion
  kept the default, signing in to a second workspace would silently kill the
  first. Appendix A is a five-command probe that answers this without
  printing a token. If a provider fails it, a second connector per account
  slot (a second OAuth client) still works (§3.9).
- **On Luke's side it is one record per account, and one name for that
  account everywhere.** Each account is an `integration_connection` row with
  an id, its Connect subject, a label ("Acme"), and a connection name: the
  first account keeps `notion`, and each added one is `notion-2`,
  `notion-3`, and so on. That one name is eve's connection name, the entry in
  `disabled_servers` and `mentioned_servers`, the mention address
  (`luke://mcp/notion-2`), and the `connection` query on the routes.
- **Nothing changes for a developer with one account per provider.** Their
  row keeps its subject (their user id), so no grant moves and no re-sign-in
  is needed. Their connection is still named `notion`, and the description
  the model reads stays byte-identical, so no prompt cache is lost. The only
  thing they see that is new is **Add another account** in each row's
  actions menu.
- **The size is five PRs, roughly 1,800–2,400 lines with tests:** a
  migration, the service and wire, the agents, the desktop, and the docs.
  §5 has the stack.

## 1. Connect: can one Luke user hold several grants for one connector?

**Yes, by giving each account its own subject.** Connect keys a grant by
the connector and the token request's subject (and, for an app subject, an
installation); it has no "accounts" or "connections" list under one
subject. Everything below is from `@vercel/connect` 2.4.1 (the pinned
version; 2.5.2, published today, changes nothing here) and Vercel's docs.

- **The user subject's id is the app's own opaque string.** The quickstart
  says to "replace `user_demo_123` with the id you use to identify the
  signed-in user in your own database"
  ([quickstart](https://vercel.com/docs/connect/quickstart)), and asking for
  "a `user` token for a different user requires an OIDC token, which
  represents the project rather than any single user"
  ([guide](https://vercel.com/kb/guide/vercel-connect)). Luke already sends
  ids Vercel has never seen (its own better-auth user ids). The SDK sends
  `subject` verbatim in the JSON body of `POST /v1/connect/token/{connector}`,
  `POST /v1/connect/authorize/{connector}` and
  `DELETE /v1/connect/connectors/{connector}/tokens`
  (`dist/token.js`, `dist/authorization.js`); it validates nothing about the
  id's shape. The docs state no length or charset limit
  ([limits](https://vercel.com/docs/connect/limits)).
- **Each subject is its own grant through every verb.** `startAuthorization`,
  `getTokenResponse` and `revokeToken` all take `(connector, { subject })`
  and nothing else that names a grant. The SDK's in-process cache is keyed
  by `JSON.stringify({ connector, ...params })`, so two subjects never share
  a cached token (`tokenCacheKey` in `dist/token.js`). `revokeToken` "revokes
  the provider grant for a connector subject"
  ([TS SDK reference](https://vercel.com/docs/connect/ts-sdk-reference#revoketoken)),
  then clears the whole in-process cache, which only costs the other
  subjects one re-fetch.
- **Connect's own newest API already speaks of "accounts" as token params.**
  The MCP events reference (2.5.0) says "Build account scope from trusted
  application state" and, of its adapter, "Create a separate adapter for each
  account" ([TS SDK reference, MCP events](https://vercel.com/docs/connect/ts-sdk-reference#mcp-events)):
  an account is a `ConnectTokenParams`, that is, a subject.
- **Re-signing in under the same subject replaces the grant.** One subject
  holds one grant per connector, which is today's behavior: a developer who
  presses Connect on Notion again and picks a different workspace swaps the
  workspace Luke's agents see. Multiple accounts therefore need distinct
  subjects; there is no way to stack two grants on one.
- **The token answer can label the account.** `ConnectTokenResponse` carries
  `name` ("human-readable connector or installation name, when known"),
  `tenantId` ("Slack team ID, GitHub org ID, Microsoft tenant GUID"),
  `externalSubject` ("the subject identifier at the provider"), `metadata`
  ("driver-specific metadata stored during OAuth") and `claims`; the
  reference suggests `getTokenResponse` "to display the connected workspace
  name" ([TS SDK reference](https://vercel.com/docs/connect/ts-sdk-reference#gettokenresponse)).
  Which of these a generic MCP OAuth connector fills is undocumented; the
  probe in Appendix A prints them (keys only for `metadata` and `claims`).
- **`startAuthorization` takes an OAuth `prompt`** ("OAuth prompt value to
  pass to the connector's authorization server", `dist/authorization.d.ts`),
  so "Add another account" can ask for `consent` or `select_account` where
  the provider honors it, instead of the browser silently re-granting the
  workspace it is already signed in to.
- **No limit and no price on grants.** Connect bills token requests ($3.00
  per 1,000 on Pro; 500 a month included on Hobby) and triggers, nothing per
  grant, subject or connector
  ([pricing](https://vercel.com/docs/connect/pricing)). The limits page names
  no cap on subjects or grants. What does scale with accounts: token
  requests (one per account a turn opens, cached per instance until 30 s
  before expiry) against the read rate limit of 200 a minute per team, and
  `revokeToken` against the 50 writes a minute
  ([limits](https://vercel.com/docs/connect/limits)).
- **Environments share grants.** "Environment selection on a project link
  controls which deployments can request tokens; it does not create separate
  provider grants" ([quickstart](https://vercel.com/docs/connect/quickstart)).
  A probe from a development OIDC token therefore writes into the same
  subject namespace as production, which is why the probe's subjects are
  synthetic (`luke-probe:…`) and revoked at its end.

**What is not proven without a live probe:** that Connect's server accepts
a subject id other than the shapes it has seen (a colon, a prefix), and that
signing in a second subject to the same provider user leaves the first
subject's grant working at the provider (a provider-side question, §2).
Appendix A is a probe for Dean's Mac that answers both without printing a
token; nothing in this sandbox holds a Vercel credential, so it was not run
here.

## 2. Providers: does a second sign-in give a second token?

The full table, with sources, is `research-providers.md`. In short:

| Provider | Grant reaches | 2nd grant revokes 1st? | Multi-account worth it? |
| --- | --- | --- | --- |
| Notion | one workspace | **unknown, high risk** (Cloudflare library fingerprint) | yes, the motivating case |
| Linear | one workspace | unknown (same fingerprint; Linear user ids are per workspace, so less likely) | yes |
| Slack | one workspace (`xoxp` user token) | probably not | yes |
| Supabase, PostHog, Executor | the org or projects chosen at consent | unknown / unlikely / probably not | yes |
| Sentry | every org of the user | **no** (documented: `revokeExistingGrants: false`) | rarely, only for a different login |
| Vercel, Neon | the user, every team or project (Neon can pin one at consent) | unknown | rarely |
| Granola, Mercury | the user, as far as is known | unknown | unknown |
| Y Combinator | one YC account | n/a | no |
| GitHub | not through Connect: the account's own GitHub sign-in, one token spanning every installation | n/a | out of scope |

The library default is the risk worth spelling out.
`@cloudflare/workers-oauth-provider` 1.2.3's `completeAuthorization` runs
`if (options.revokeExistingGrants !== false)` and then revokes every grant
of that `userId` with the same `clientId`. Sentry was bitten by exactly this
and turned it off
([getsentry/sentry-mcp#924](https://github.com/getsentry/sentry-mcp/issues/924)).
Both Notion and Linear answer
`/.well-known/oauth-authorization-server` with the revocation endpoint equal
to the token endpoint, `response_modes_supported: ["query"]`, and
`client_id_metadata_document_supported: true`, which is Sentry's shape
byte for byte. Whether they pass `false`, and whether the `userId` they pass
is per person or per workspace, is not public. The probe answers it for
each provider in a few minutes.

**A second risk applies to every provider: the browser picks the account.**
A provider's consent page grants whatever account or workspace the browser
is already signed in to, unless it shows a picker. Notion shows a workspace
picker that preselects the last workspace opened. Slack's `team` hint only
works if the browser is signed in to that workspace. Vercel and Granola have
no picker at all. Zapier documents the same problem and advises a private
window. Luke's add-account flow therefore says which workspace to pick, and
passes `prompt=consent` (Connect forwards it) where the probe shows the
provider honors it (§3.2).

## 3. The design

### 3.1 The account record and its subject

`integration_connection` (`packages/database/src/schemas/integration.ts`)
becomes one row per account rather than per (user, provider):

| Column | Today | Proposed |
| --- | --- | --- |
| `id` | (none; primary key is `user_id, provider`) | text primary key, minted at sign-in |
| `connect_subject` | (implicit: the user id) | text, not null, unique. The subject every Connect ask names for this account |
| `connection_name` | (implicit: the provider) | text, not null, unique per user. `notion`, `notion-2`, … |
| `label` | (none) | text, nullable. "Acme": the account's name at the provider, renamable |
| `user_id`, `provider`, `status`, `state`, `state_issued_at`, `connect_verifier`, `connected_at`, `updated_at` | as now | as now, indexed on (`user_id`, `provider`) |

- **Migration.** Backfill gives every existing row
  `connect_subject = user_id` and `connection_name = provider`, so every
  grant Connect holds today keeps answering under its subject. Then the
  primary key moves to `id`. The table holds one row per account and
  provider, so the rewrite is small (`db-migrations` skill:
  idempotent SQL, and `drizzle-kit check`).
- **The subject of an added account is a fresh opaque id**, stored on its
  row. It is not `<userId>:<n>`: AGENTS.md's TypeScript rule refuses a key
  built by interpolating identifiers, and an opaque id means nothing outside
  Luke. A subject is not a credential, since asking Connect anything needs
  the deployment's OIDC token, and it never leaves the service.
- **The connection name is minted once, when the account's row is first
  written, and is read from the row from then on.** It is never recomputed
  from the provider and an ordinal. The first account of a provider is
  named after the provider; each later one gets the next free `-<n>`. The
  grammar `^<provider>(-[1-9][0-9]*)?$` fits eve's rule for connection
  names: lowercase letters, digits, and dashes, starting with a letter, at
  most 64 characters (`qualifyConnectionNames` in eve 0.74's
  `dynamic-connection-lifecycle.js`). It also contains no `__`, eve's
  separator in a qualified tool name.
- **The label comes from the grant where Connect provides one.**
  `ConnectTokenResponse` may carry `name` (installation name), `tenantId`,
  `externalSubject`, `metadata`, and `claims`. Which of these a generic MCP
  OAuth connector fills is what the probe prints (keys only). Where Connect
  provides nothing, the row is labeled "Account 2" and the developer renames
  it. The label is not a credential, so AGENTS.md's no-credentials rule
  allows it. It is an identity at the provider, though, and
  `integration-wire.ts`'s header promises that "No answer carries a token or
  an identity at the provider", so that sentence has to change (decision
  7.4). The label stays out of every log line, span attribute, counted
  event, and fixture (fixtures use made-up names). Session replay masks
  every drawn word, so a drawn label leaves as layout only.

### 3.2 The routes and the wire

Every route keeps its path, and an optional `connection` query names one
account. Without it, a route means the provider's first account. So a
desktop that predates the change keeps working against the new service,
and sees only the first account of each provider.

- `GET /api/account/integrations` keeps
  `integrations: { <provider>: status }`, which answers the first account.
  It adds `accounts: [{ provider, connection, label?, status }]`, one entry
  per row, plus a `disconnected` entry for each offered provider with no
  row. A wire answer ignores a key it does not know (`packages/features`'
  rule), so older desktops are unaffected.
  `signInFailures[]` gains `connection`.
- `POST /{provider}/connect` reconnects the named account (the first, with
  no query) under that account's own subject, as today. **`POST
  /{provider}/connect?add=true`** mints a row with a new subject and the
  next connection name, in `pending`, and begins the sign-in for it. It
  passes `prompt` where the provider's catalog entry says the provider
  honors it. Settling works exactly as now: the statuses read asks Connect
  for that subject's token afresh. Its pending sign-in is a separate row, so
  it never touches the other account's grant or row.
- **Cancel** on an added account that never connected deletes that row, as
  a first sign-in's row is deleted today. `disconnect` and `tools` take
  `connection`. The tools cache key goes from (user, provider) to (user,
  connection).
- **Rename:** `PATCH /api/account/integrations/{provider}?connection=…`
  with `{ label }`, bounded and trimmed. It is a new route, so its rewrite
  is regenerated (`functions:rewrites`).
- **The landing page** (`/integration-connected.html`) can name the
  account: "Connected Notion · Acme".
- **A duplicate.** When the new grant's `tenantId` or `externalSubject`
  equals that of an account the developer already has (which only works if
  the probe shows Connect fills them), the sign-in ends with "That
  workspace is already connected as Notion · Acme", and the new subject's
  grant is revoked. Without those fields, two rows can stand for one
  workspace, and the developer disconnects one.
- **The allowlist** (`<PROVIDER>_ALLOWED_ACCOUNTS`) stays a rule about the
  Luke account's email, so it covers every account of the provider.

### 3.3 The agents

- **`servers.ts`'s standing becomes a list of connections**, each
  `{ provider, connectionName, subject, label }`, rather than providers. An
  offered provider with no row is still handed as its bare name (`notion`),
  as today, so the model hears "not connected, connect it in Settings". An
  added account is handed only while its row exists.
- **`connections.ts` keys eve's map by `connectionName`** and sets
  `instanceKey` to the account's subject rather than the user id. eve asks
  for "an account or tenant identifier that changes whenever the … auth
  provider changes", and that identifier now differs per account.
- **`integrationConnection` takes the account.** The token read looks up
  that row and asks Connect under its `connect_subject`. The fixed
  sentences ("Notion's sign-in for this account has expired …") name the
  label when the developer holds more than one account of the provider.
  A Disconnect still takes effect from the next step, because the row is
  read at each opening.
- **The description changes only for a developer with two or more
  accounts.** It gains one sentence: `This connection is the developer's
  "Acme" Notion workspace; they also connected "Personal" as notion-2.` For
  everyone else the bytes are unchanged, so nobody else loses their prompt
  cache. The planning and coding instructions (`INTEGRATION_NAMES_SAID`) do
  not change. One line is added to the coder's and planner's instructions,
  and only when some provider has two accounts: say which account you read
  from or wrote to.
- **`connection-tools.ts` maps a qualified tool name back to its provider**
  with the grammar above (`notion-2__notion-fetch` → Notion). It stores the
  call under the same `notion_remote` name, with an optional `connection`
  in the envelope when it was not the first account. That envelope is the
  record's schema, which the store holds rows to, not anything the model is
  shown. An old transcript reads back as it always has.
- **Planning agents (`ALWAYS_ON`) and the planner's worker get every
  account.**

### 3.4 Settings › Integrations and the MCP popover (show §1–§3)

- **One row per account (direction A, recommended).** The row reads
  "Notion · Acme". Its tools line, health, Reconnect, and Disconnect each
  apply to that account alone. The actions menu gains **Rename** (only on a
  provider with two or more accounts) and **Add another account** (on every
  connected Connect row). No label ends in an ellipsis, as Dean ruled for
  Workspace. While its sign-in is open in the browser, a new account stands
  as a pending row, "Notion · New account", with Reopen and Cancel and the
  line "Waiting for the browser. Pick the other workspace on Notion's
  page".
- **Direction B, a provider row with its accounts nested under it**, is in
  the show for comparison. It suits three or more accounts, but it gives
  the single-account majority a second shape, and the popover a nested
  level.
- **The popover:** one row, one switch, and one tool count per account. A
  tool search shows a hit per account, labeled "Notion · Personal". The
  composer's "sign-in expired" note and its Reconnect name the account.
- **Code:** `serverRows` (`packages/ui/src/agent-servers-model.ts`) builds
  rows from the statuses read's `accounts`. Its `ServerRow` gains
  `connection` and `label`, and React keys move to the connection name.
  `integration-statuses.ts`, `integration-tools.ts`, and
  `integration-grant.ts` key by connection. The host's integration acts
  (`packages/host/src/acts.ts`, `compose-integrations.ts`) take
  `{ provider, connection? }`. Settings search indexes the label.

### 3.5 Mentions

- **Address:** `luke://mcp/<connection>[/<tool>]`, so
  `luke://mcp/notion-2/notion-search`. The segment that today holds the
  provider holds the connection name, and for a first account the two are
  the same string, so every stored mention keeps its meaning. The
  `<provider>/<account>` form suggested in the brief collides with the
  `<tool>` segment.
- **Schema and chip:** the mention schema
  (`packages/features/src/mention-link.ts`) reads `connection` and derives
  the provider from it. The picker lists each account. The chip reads
  "Notion · Personal".
- **An older desktop** reads `luke://mcp/notion-2` as no mention and shows
  it as a plain link. That is acceptable for a transition, since only a
  developer with two accounts writes one.
- **The agent's note** (`mentioned-context.ts`'s `noteOf`) names the
  connection it already names, now with the label: "the Notion MCP
  server's "Personal" account (connection `notion-2`)".
- **A pasted provider link** (`notion.so/...`, a LINK mention) names a
  provider but no account. Its note lists every connection of that
  provider, and the agent tries the one whose workspace the page is in.
- **In a shared conversation**, the integration grant is the caller's
  (`integration-connection.ts`). So `notion-2` resolves against the
  caller's own accounts: a teammate's `notion-2` is their second workspace,
  or nothing. The chip shows the author's label. Decision 7.6.

### 3.6 `disabled_servers` and `mentioned_servers`

- **Both columns hold connection names.** Since a first account's name is
  its provider, every stored value keeps its meaning: `["notion"]` switches
  off the first Notion account, which today is the only one.
- **The schemas widen from provider literals to the connection-name
  grammar:** `disabledServersSchema` in `coding-agent-wire.ts`, and
  `DisabledServersColumnSchema` and the mentioned-servers schema in
  `coding-agent-store.ts`. Today they silently drop anything that is not a
  provider, which would erase `notion-2`. That makes this change
  load-bearing, and the wire, the column, and its readers move in one PR.
  `MAX_SERVER_CHARS` (64) and `MAX_SERVERS` (32) still fit.
- **A new account starts on for every agent**, as a newly connected provider
  does today. A stale name left by a disconnected account switches nothing
  off. An account added later under the same name inherits its switch, as
  reconnecting a provider does today.

### 3.7 Automations and the review bot

- **There is no review bot in the code.** A PR reviewer is an automation
  with a GitHub trigger (`automation-runs.ts`), so it follows the
  automation rule.
- **An automation run starts a coding agent as its owner, with no switches,
  so it gets every account of every provider**, each labeled, and its
  prompt's mentions pin one. Version one changes nothing here: an
  automation that should write to Acme says `@Notion · Acme` in its prompt,
  and the mention travels into its first turn (`start.ts`).
- **Pinning servers per automation** (a `disabled_servers` on the automation
  row, copied onto the agent it starts) is a later PR if Dean wants it
  (decision 7.7). It is equally useful with a single account.

### 3.8 Revoking one account, and deleting the account

- **Disconnect** deletes that row, then calls `revokeToken(connector,
  { subject: row.connect_subject })`. The other account's row and grant are
  untouched. The SDK clears its whole in-process cache on any revoke, which
  costs the other subjects one re-fetch each.
- **Deleting the Luke account** must now read the rows before the cascade
  deletes them, because an added account's subject is not the user id.
  Today `revokeIntegrationGrants(userId)` loops over providers under the
  user id (`account-app.ts`). It becomes "read every row's provider and
  subject, delete the user, revoke each", which stays best-effort, as
  today.
- **Mind the write rate limit.** Connect allows 50 writes a minute per team,
  so deleting an account with many grants revokes them one at a time and
  logs a failure by its word, as now.

### 3.9 If a provider revokes the first grant on the second

If the probe shows that Notion revokes account A when B signs in, the
subject design alone cannot help, because the two grants share one OAuth
client at Notion. Two options:

1. **Offer multiple accounts per provider, by a catalog flag.**
   `INTEGRATION[provider].MULTIPLE_ACCOUNTS: true` is set only for providers
   that pass the probe. **Add another account** appears only on those.
   *(Recommended as the first step whatever the probe says, because Vercel,
   Neon, Sentry, and Y Combinator gain little from it.)*
2. **One connector per account slot for a provider that fails it.** Add
   `NOTION_CONNECTOR_UID_2` (a second Connect connector, so a second OAuth
   client at Notion). An account row records which connector it lives
   under. This works around the revocation, and it costs Dean one
   `vercel connect create` per extra slot and a cap on accounts per
   provider. It is worth doing only if Notion fails and Dean still wants
   it.

### 3.10 What stays exactly as it is

- **For a developer with one account per provider:** their grant, subject,
  connection name, description bytes, `disabled_servers`, mentions, and
  rows (apart from the new menu item).
- **Unchanged for everyone:**
  - GitHub, which is granted by the GitHub sign-in, not Connect;
  - the allowlists;
  - the connector environment variables;
  - the eve connection files.

## 4. How others do it

Cited in full in `research-industry.md`.

- **Zapier** ([multiple accounts](https://help.zapier.com/hc/en-us/articles/8496290788109))
  and **n8n** ([credentials](https://docs.n8n.io/credentials/add-edit-credentials/)):
  - each account is a named connection or credential, defaulting to the
    account's email or username and renamable;
  - every step picks one;
  - Zapier warns that the browser's session can silently pick the account.
- **Composio** ([multiple connected accounts](https://docs.composio.dev/docs/managing-multiple-connected-accounts)):
  - the multi-account model built for agents: opt in with `allowMultiple`;
  - each account has an alias plus a `displayName` read from the provider;
  - the most recent account is the default, unless
    `requireExplicitSelection` makes the agent pass `account` on every call.
- **ChatGPT**
  ([9to5Mac, 2026-08-28](https://9to5mac.com/2026/08/28/chatgpt-and-codex-now-support-multiple-gmail-and-google-calendar-accounts/)):
  - since August 2026, several Google accounts per plugin, read "together"
    in one conversation;
  - widened to more plugins in September.
- **Claude**
  ([claude-ai-mcp#178](https://github.com/anthropics/claude-ai-mcp/issues/178),
  [claude-code#27302](https://github.com/anthropics/claude-code/issues/27302)):
  - one account per connector, and a second custom connector with the same
    URL is refused;
  - the long-open request asks for accounts labeled in results and in each
    tool call, which is what §3.3 gives.
- **Cursor**
  ([forum](https://forum.cursor.com/t/allow-connecting-multiple-linear-workspaces/150483)):
  native Linear and Slack hold one workspace each, and connecting another
  disconnects the first (reported).
- **Raycast** ([OAuth API](https://developers.raycast.com/api-reference/oauth)):
  undocumented; one token set per extension.
- **Pipedream Connect**
  ([users](https://pipedream.com/docs/connect/managed-auth/users)): accounts
  can be connected but only one is used per app.
- **Arcade:** multi-account goes through support.
- **Instinct** (§8): several accounts for Google Workspace, Outlook, Linear,
  and Notion, each labeled by the provider's email, org, or workspace name,
  with a Primary and "Make primary"; one account for the rest.

Luke's design is Zapier's and Composio's account object, Claude-#27302's
labeling, and ChatGPT's "all accounts in the conversation". Composio's
explicit-selection mode is not needed, because each account is already its
own connection with its own tool names.

## 5. PR plan

Each PR stacks on the previous one and ships tests that fail without it.
The store PRs run `test:store`. Sizes are lines changed including tests: S
is under 300, M is 300–700, L is over 700.

1. **`refactor(database,service): an integration connection is a row of its
   own, with its Connect subject and connection name`** (M). Adds the
   schema, the migration, and the backfill. It moves the store from
   `(userId, provider)` to the row (`integration-store.ts` and its sibling
   test), and makes `ConnectorService` take a subject rather than a user
   id. Behavior is unchanged: one row per provider, subject = user id. This
   is the PR that proves nobody's grant moved.
2. **`feat(features,service): an account connects another account of a
   provider, renames it, and disconnects one`** (L).
   - Adds `add=true` and `connection` on the routes, the `accounts` list and
     `connection` on `signInFailures`, and the PATCH rename with its
     rewrite.
   - Adds the label from the grant, the duplicate check, and `prompt` from
     the catalog.
   - Adds the catalog's `MULTIPLE_ACCOUNTS` flag, set only for providers
     that passed the probe.
   - Makes account deletion revoke by row.
   - Ships `integrations-app.test.ts` and `integration-connect.test.ts`
     cases over a fake Connect that keeps a grant per subject.
3. **`feat(service,database,features): an agent is handed each account as a
   connection of its own`** (M).
   - Moves `servers.ts`, `connections.ts`, `integration-connection.ts`, and
     `connection-tools.ts` to connections, with the label sentence and the
   one instruction line.
   - Widens `disabled_servers` and `mentioned_servers` to connection names
     in the wire, the column schemas, and the store.
   - Extends `mention-link.ts` and `mentioned-context.ts`.
   - Tests: two Notion accounts hand two connections; a single account's
     description bytes are unchanged; `notion-2` survives a round trip
     through the switches; a stored `["notion"]` still switches off the
     first account.
4. **`feat(ui,desktop,host): Settings › Integrations and the MCP popover
   draw one row per account`** (L).
   - The view model, the statuses, tools, and grant reads, and the host
     acts.
   - The page's rows, menu items, rename field, and pending row; the
     popover's rows and switches; the picker and the chip; settings search.
   - Tests through `serverRows`, plus a fixture PNG (`evidence.sh`).
5. **`docs(service): integrations hold an account per row`** (S).
   - Updates `packages/service/README.md` § Integrations (the subject, the
     routes, the agents).
   - Changes `integration-wire.ts`'s header sentence about identity, if
     Dean approves 7.4.
   - Records this proposal's status.

Not in the plan unless Dean asks: per-automation server pinning (7.7), a
connector per account slot (§3.9 option 2), and direction B.

## 6. Risks

- **R1. A provider revokes the first grant on the second (high for Notion
  until probed).** Appendix A settles it before PR 2 lands. The catalog
  flag keeps the feature off for a provider that fails, and §3.9 is the way
  around it.
- **R2. The agent writes to the wrong workspace.**
  - Mitigations: each account is a distinct connection, with a description
    that names it and a label on the row and the chip; a mention pins one
    account; the instruction line asks the agent to say which account it
    used; the transcript envelope records the connection.
  - What remains: a write the developer did not pin can land in the wrong
    workspace, and an integration's write runs without approval today (the
    plan's own rule).
- **R3. Token storage, and AGENTS.md's no-credentials rule.**
  - Luke still stores no token: Connect holds every grant.
  - New stored values are a subject (an opaque id, not a credential, which
    needs the deployment's OIDC token to use) and a label (an identity at
    the provider, not a credential).
  - The carve-out for an integration's MCP calls and results is unchanged.
  - No token, label, or subject goes into a log line, a span, a counted
    event, or a fixture. The probe prints none of the first two.
- **R4. The browser grants the account it is already in, so the second
  account turns out to be the first again.**
  - Mitigations: the pending row's line says to pick the other workspace;
    `prompt` is passed where it helps; the duplicate check revokes it where
    Connect gives a tenant id.
  - Otherwise the developer sees two identical rows and disconnects one.
- **R5. Token requests multiply.**
  - Each account a turn opens is a token request per instance, once its
    cached token is within 30 s of expiry.
  - Connect bills $3 per 1,000 on Pro, with a team read limit of 200 a
    minute. A developer with two Notions doubles Notion's share and nothing
    else.
  - The `fresh: true` reads (the statuses settle, the callback) are per
    sign-in, not per turn.
- **R6. A shared conversation's `notion-2` means the caller's second
  workspace, not the author's (§3.5).** Decision 7.6.
- **R7. Old desktops** see only the first account of each provider. A
  `luke://mcp/notion-2` mention reads as a plain link to them. Their
  Disconnect on a provider ends only its first account.
- **R8. The primary-key migration** on `integration_connection` rewrites a
  small table; PR 1 runs it through `test:store`. A rollback means dropping
  the added rows of second accounts, whose grants would then be orphaned at
  Connect until revoked.

## 7. Decisions for Dean

1. **Go ahead, gated on the probe?** Recommended: yes. Dean runs Appendix A
   for Notion and Linear (and Slack, if its connector is set), and PR 1
   starts now, since it changes no behavior.
2. **Which providers offer "Add another account"?** Recommended: those that
   pass the probe, among Notion, Linear, Slack, Supabase, PostHog, and
   Executor. Vercel, Neon, Sentry, Granola, Mercury, and Y Combinator stay
   single-account until someone asks. GitHub is out of scope, because it is
   granted by the GitHub sign-in.
3. **Settings layout:** A, one row per account ("Notion · Acme"), or B, a
   provider row with nested accounts? Recommended: A.
4. **The label crosses the wire.** May the statuses answer carry an
   account's name at the provider (e.g. a workspace name)? This means
   changing `integration-wire.ts`'s "No answer carries … an identity at the
   provider". It is not a credential, so AGENTS.md's Never list is
   untouched. Recommended: yes, kept out of logs, spans, counted events, and
   fixtures.
5. **The label's source:** Connect's grant fields where the probe shows
   them filled, else "Account 2" and the developer renames it. The
   alternative is a per-provider identity read at sign-in (`notion-get-self`,
   `get_workspace`, …), which means more code for each provider.
   Recommended: Connect's fields plus Rename; add identity reads only where
   Connect gives nothing and the default bothers people.
6. **Mentions in a shared conversation** resolve against the caller's own
   accounts, as the grant already does. The alternative is to resolve by
   label. Recommended: the caller's own accounts; a label is the author's
   word and may not exist for a teammate.
7. **Automations:** every account, pinned by mentions in the prompt (no
   change), or per-automation server switches as a follow-up? Recommended:
   no change now, and per-automation switches only if asked, since they
   matter with one account too.
8. **A new account's switch** starts on for every existing coding agent, as
   a newly connected provider does. The alternative is off where the
   provider's first account is off. Recommended: on, the same rule as
   today.
9. **If Notion fails the probe:** stop at the flag (no multi-account Notion)
   or add a second Notion connector per slot (§3.9 option 2)?
   Recommended: decide after the probe; the flag ships either way.
10. **A primary account per provider, as Instinct has (§8)?**
    - The first account is the primary.
    - "Make primary" moves the flag, and the descriptions say "use this
      account unless the developer names another".
    - Connection names never swap, so switches and mentions keep their
      meaning.

    Recommended: yes, as a flag on the row that changes only the description,
    added in PR 3. The alternative is no primary, with every account equal and
    the model asked to say which one it used.

## 8. How Instinct does it (Dean's follow-up)

> Dean: "How does Instinct support multiple Notion/Gmail accounts, for
> example?"

Instinct publishes no documentation on this. There is no help center or
changelog on the subject, and its privacy policy and terms describe "Connected
Services" in general and name only Google. No review, App Store page, or
founder post that I could find mentions multiple accounts. What follows comes
from the client code that `app.instinct.com` serves to anyone, without signing
in: the Workspace page bundle (`/assets/WorkspacePage-*.js`), read on
2026-10-15. Details and sources are in `research-industry.md` § Instinct. It
can change without notice.

- **Several accounts are allowed for four providers, and one account for the
  rest.** The GraphQL schema has plural connections, each with a
  `…SelectConnection` (make primary) and a `…DisconnectConnection(connectionId)`
  mutation, for:
  - Google Workspace;
  - Outlook;
  - Linear;
  - Notion.

  GitHub, Granola, Slack (`slackCanvasConnection`), Spotify, WHOOP, Shop Pay,
  Stripe Link, and iMessage on a Mac are singular. Slack is single even though
  a Slack grant reaches only one workspace.
- **Labels come from the provider, and there is no rename.** Each account row
  shows:
  - Google: `email`, plus per-account `services` (Gmail, Calendar, Tasks,
    Drive, Docs, Sheets, Slides);
  - Outlook: `email` and `displayName`;
  - Linear: `organizationName`, `displayName`, and `email`;
  - Notion: `workspaceName`.

  No label field is user-editable.
- **Choosing an account works through a primary.** Each connection has
  `isDefault`. A provider with more than one account shows a "Primary" badge
  and a **Make primary** item on the others, beside **Remove**. Failures read
  "Failed to change primary Notion workspace". How the agent uses the primary
  is not visible in the client. The likely reading is that the primary is the
  default and another account is used when asked; that is inference.
- **Adding one:** a provider card's button reads "Connect", then "Add
  account" once one is connected, and "At capacity" when the server says no
  more are available. Connecting calls
  `startWebConnect(integrationId, scopeProfile)` (e.g.
  `integrationId: "google-workspace"`, `scopeProfile: "ONBOARDING"`), which
  answers a URL the browser follows.
- **What it is built on: not stated, but the evidence points to its own
  OAuth clients.**
  - The bundle names no Composio, Pipedream, Nango, Merge, Paragon, or Arcade.
  - Its privacy policy commits to Google's API Services User Data Policy
    "including the Limited Use requirements". That commitment is required of
    an app that requests restricted Gmail scopes under its own verified Google
    OAuth client, together with an annual CASA security assessment
    ([Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
  - For everything else, Instinct leans on stored credentials (its Vault, and
    a 1Password partnership Noah Shinn announced on 2026-09-04) and a browser
    it drives.
- **Google's side:** each Google account is a separate grant to the same
  client. Google limits it to "100 refresh tokens per Google Account per OAuth
  2.0 client ID", and the oldest is invalidated beyond that, so two different
  Google accounts never collide. `prompt=select_account` and `login_hint` pick
  the account
  ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2),
  [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)).
  Gmail is not one of Luke's integrations today. Adding it through Connect
  would need a Google connector whose OAuth client passed restricted-scope
  verification.

**What this means for the design.** Instinct is the closest shipped analogue,
and it agrees with §3:
- one connection object per account, keyed by an id;
- a label read from the provider (email, workspace, org);
- "Add account" on a connected provider, and Remove per account;
- multiple accounts offered provider by provider, which is decision 7.2's
  flag.

It differs in two ways:
- **No rename.** Luke keeps Rename for the providers whose grant gives no
  name.
- **An explicit primary.** That suggests decision 7.10.

## Appendix A: the probe (Dean's Mac)

This sandbox holds no Vercel credential, so the probe was not run here. It
uses synthetic subjects (`luke-probe:a`, `luke-probe:b`), so no real
account's grant is touched. Grants are shared across a project's
environments, which is why it revokes both at the end. It prints no token,
no verifier, and no sign-in address: only error classes and codes, the
grant's non-secret fields, the *keys* of `metadata` and `claims`, a yes/no
on whether the tokens differ, and the HTTP status of an MCP `initialize`
made with each token.

```sh
mkdir /tmp/luke-probe && cd /tmp/luke-probe
vercel link            # the Luke project
vercel env pull        # writes .env.local with a development VERCEL_OIDC_TOKEN (about 12 h)
npm init -y >/dev/null && npm i @vercel/connect@2.4.1 dotenv
# save the script below as probe.mjs, then, with NOTION=<value of NOTION_CONNECTOR_UID>:
node probe.mjs status    "$NOTION" a                       # expect UserAuthorizationRequiredError / no_token: a never-granted subject, and a colon in the id accepted
node probe.mjs authorize "$NOTION" a consent               # browser: pick workspace A (e.g. Acme)
node probe.mjs authorize "$NOTION" b consent               # browser: pick workspace B (e.g. Personal)
node probe.mjs inspect   "$NOTION" https://mcp.notion.com/mcp a b
#   pass: both lines show mcpInitialize 200, and "distinct tokens: yes"
#   fail (R1): a shows NoValidTokenError, or its initialize answers 401
node probe.mjs revoke    "$NOTION" a
node probe.mjs inspect   "$NOTION" https://mcp.notion.com/mcp b   # b must still answer 200
node probe.mjs revoke    "$NOTION" b
```

The same eight lines with `LINEAR_CONNECTOR_UID` and
`https://mcp.linear.app/mcp` (and Slack's, if set) cover the others. The
`inspect` lines also show which grant fields Connect fills for the label
(decision 7.5). Paste the `inspect` and `status` output back; none of it is
secret.

```js
// probe.mjs -- does Vercel Connect keep two independent grants for one connector under two subjects?
// Prints no token, verifier, or sign-in address.
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { getTokenResponse, revokeToken, startAuthorization } from "@vercel/connect";

config({ path: ".env.local" });
const [command, connector, ...rest] = process.argv.slice(2);
const subjectOf = (id) => ({ subject: { type: "user", id: `luke-probe:${id}` } });
const failure = (error) =>
  `${error?.name ?? "Error"} code=${error?.code ?? "-"} status=${error?.status ?? "-"}`;

async function status(id) {
  try {
    const response = await getTokenResponse(connector, subjectOf(id), { forceRefresh: true });
    console.log(`${id}: token issued, expires ${new Date(response.expiresAt).toISOString()}`);
  } catch (error) {
    console.log(`${id}: ${failure(error)}`);
  }
}

async function authorize(id, prompt) {
  const { url } = await startAuthorization(connector, subjectOf(id), prompt ? { prompt } : {});
  execFile("open", [url]); // never printed
  console.log(`${id}: sign-in opened in the browser${prompt ? ` (prompt=${prompt})` : ""}`);
}

async function initializeStatus(mcpUrl, token) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "luke-probe", version: "0" } },
    }),
  });
  return response.status;
}

async function inspect(mcpUrl, ids) {
  const digests = [];
  for (const id of ids) {
    try {
      const r = await getTokenResponse(connector, subjectOf(id), { forceRefresh: true });
      digests.push(createHash("sha256").update(r.token).digest("hex"));
      console.log(
        JSON.stringify({
          subject: id,
          name: r.name,
          tenantId: r.tenantId,
          externalSubject: r.externalSubject,
          installationId: r.installationId,
          metadataKeys: Object.keys(r.metadata ?? {}),
          claimsKeys: Object.keys(r.claims ?? {}),
          mcpInitialize: await initializeStatus(mcpUrl, r.token),
        }),
      );
    } catch (error) {
      console.log(`${id}: ${failure(error)}`);
    }
  }
  if (digests.length > 1) console.log(`distinct tokens: ${new Set(digests).size === digests.length ? "yes" : "NO"}`);
}

async function revoke(id) {
  try {
    await revokeToken(connector, subjectOf(id));
    console.log(`${id}: revoked`);
  } catch (error) {
    console.log(`${id}: ${failure(error)}`);
  }
}

switch (command) {
  case "status": await status(rest[0]); break;
  case "authorize": await authorize(rest[0], rest[1]); break;
  case "inspect": await inspect(rest[0], rest.slice(1)); break;
  case "revoke": await revoke(rest[0]); break;
  default: console.log("usage: status|authorize|inspect|revoke <connector> ...");
}
```
