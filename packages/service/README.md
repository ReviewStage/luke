# @luke/service

The hosted service's logic: what the web deployment's functions and its two eve
services (`apps/web/eve`, `apps/web/coder`) compose and run. The deployment
keeps only its shell in `apps/web/server` — the Vercel function entries under
`routes/`, the runtime edge `runtime.ts`, the function layout and bundling, and
the voice function's edge — and reaches everything else here.

The package has no barrel. Each module is its own subpath, as
`@luke/database`'s are (`@luke/service/http/http-effect`), and test builders
stand at `@luke/service/testing/<name>`. A module lives in the folder of the
domain it belongs to (`auth/`, `github/`, `plans/`, `agents/`, `voice/`, …),
named by the group of this README that describes it.

`src/core.ts` is the package's own door to the workspace packages it builds on.
Its `./core` subpath stands only while modules still under `apps/web/server`
import it; nothing new should.

`src/run.ts` names the runners the deployment's edge hands a module
(`WebStoreRun`), so a module never imports the edge itself.

## The auth group

`src/auth/auth-app.ts` is the auth route group: Better Auth's own `fetch`
handler on the path set `apps/web/vercel.json` routes here, and the hosted
vocabulary's `not-found` on any other path, which nothing routes to this
function. The handler is held as a passthrough rather than described as
endpoints — an `HttpApi` declaring them would be a second copy of a contract
Better Auth already versions, and the first to drift would be the one Luke
ships. The request handed over is the very `Request` the function was invoked
with, and the answer travels back as a raw body, so the status, the headers,
every `set-cookie`, and the bytes are the handler's own. Nothing is mirrored
onto the `HttpServerResponse` beside it, because the platform writes such a
record onto the answer's own `Headers` and a redirect's are immutable; a HEAD
is the exception, where that record is all the web handler reads, and there
the status and headers are carried and the body dropped.
`apps/web/fixtures/auth-route/` records what the group answers for a sign-in, a
provider redirect, an unknown endpoint, a refused method, a HEAD, and a path
outside the group, and `apps/web/tests/auth-app.test.ts` answers each twice — through
the group and by calling the handler the way the route called it before — and
compares the two.

The organization plugin is served in the group with `ORGANIZATION_OPTIONS`
(`src/auth/auth-policy.ts`): no workspace is deleted, and no signed-in user
creates one (`allowUserToCreateOrganization: false`). Every organization
write a browser could reach is in `DISABLED_AUTH_PATHS` and answers 404,
because a workspace is adopted by its slug, and a session free to create an
organization or rename its own could take a team's slug first. That covers
create, update, delete, check-slug, set-active, member removal, role changes,
leave, every invitation endpoint (Luke sends no invitation mail), and the
team and role endpoints this deployment does not mount. `disabledPaths` is
read by the HTTP router alone, so the server-only `auth.api` calls a hosted
route makes still run, and a create that names a `userId` and carries no
session passes the creation rule as a system action.
`src/auth/auth-database.test.ts` holds both sides with an account signed up through
`auth.api.signUpEmail`.

## The Luke GitHub App

"Sign in with GitHub" is the Luke GitHub App's user authorization: the
provider's client is the App's (`GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, read by `authSecrets` in `src/auth/auth-deployment.ts`;
the admin dashboard's "GitHub sign-in" row reads the same client), so the
token a sign-in leaves on the `account` row is a GitHub App user token, which
reaches only the repositories where the App is installed and the user
has access, under the App's registered permissions (metadata read; contents,
pull requests, issues, and discussions read and write; checks, commit
statuses, and Actions read; email addresses read). The same token is GitHub's
integration's grant ("GitHub's grant" under Integrations). An account that
signed in through the OAuth App before this is the same GitHub user id, so
Better Auth signs it in to the user it already has and
(`updateAccountOnSignIn`) replaces the row's tokens with the App's;
`src/auth/auth-github-sign-in.test.ts` holds that. The App's user tokens expire
after eight hours and come with a refresh token good for six months; Better
Auth stores both sealed under `BETTER_AUTH_SECRET` (`encryptOAuthTokens`), with
their expiries beside them. Better Auth's own `/get-access-token` and
`/refresh-token` endpoints are not served (`DISABLED_AUTH_PATHS`): nothing
hands a browser the GitHub token, and the one reader of it is the server.

That reader is `src/github/github-app.ts`, the `GitHubApp` service the web
runtime builds beside `HostedEnvironment` from `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_APP_PRIVATE_KEY` (the PEM; newlines flattened to `\n` by a dashboard
paste are restored), and `BETTER_AUTH_SECRET`. A deployment missing any of
them still builds the service, and every read of it answers
`GitHubAppNotConfigured` naming what was missing, so a bundle loads with
nothing configured. The service holds no client: its GitHub reads run on the
ambient `HttpClient` and its rows on the ambient `SqlClient`, so
`src/github/github-app.test.ts` stands a fake at the GitHub boundary and PGlite
beneath it. `appJwt` is the App speaking as itself, RS256 under the private
key, issued a minute back and good for eight; it is what `installation(id)`
reads `GET /app/installations/{id}` with, so an id GitHub hands the Setup URL
is confirmed as this App's own or answered as none, and what every
installation token is minted under (`POST
/app/installations/{id}/access_tokens`). `userToken(userId)` is the signed-in
user's token off the row, unsealed, read for one caller alone, GitHub's MCP
server (`src/integrations/github-integration.ts`); a token within a minute of its expiry
is refreshed first at GitHub's token endpoint on the App's client, and the
fresh pair is re-sealed in place, inside one transaction under `FOR UPDATE`
on the row, because GitHub retires a refresh token the moment it is used.
GitHub answers a refused refresh with status 200 and an `error` body, which
is read as `GitHubSignInRequired`, as is a row with no GitHub account, a row
from before the App, an expired refresh token, or a token that will not open
under this deployment's secret. No repository read takes that token.

A workspace's repositories are those of the one installation of the App
connected to it (`src/github/github-installations.ts`), and nothing else: nobody's own GitHub account is asked what it
reaches, so a member who never signed in with GitHub reads, plans, and starts
agents on the workspace's repositories all the same, and a workspace with
nothing connected has none. `workspaceRepositories(organizationId)` mints a
token for the listing alone (`metadata: read`) and pages `GET
/installation/repositories` a hundred at a time until a page comes back
short, most recently updated first; a listing GitHub is still answering full
pages of at the bound (`PAGING`, fifty pages) is answered as unreadable
rather than as the part that was read; none where nothing is connected or
GitHub no longer knows the installation. `workspaceRepository(organizationId,
"owner/name")` is the check a plan's repository passes before it is kept:
only an installation on the owner can reach it, so the listing is paged only
for that one and only as far as the page the repository is on, the name is
matched the way GitHub folds case, and what is answered is the full name as
GitHub spells it. `repositoryReadToken(organizationId, "owner/name")` is the
same check followed by the one token the App mints for that repository:
naming it alone and `contents: read`, answered sealed beside the repository
as GitHub spells it, or none where the installation does not reach it. It is
what the planning sandbox's checkout reads through
(`src/agents/repository-shell.ts`), and the File tab, the tree, and the skills
beside it. `repositoryPullRequestToken` adds `pull_requests: read` and
`repositoryWriteToken` cuts contents and pull requests write, each with CI
read beside it where the installation grants it; `appBot(token)` reads the
App's bot user (`GET /users/<slug>[bot]`) on a token already minted, which
is who a coding agent's commits are by. A plan's repository is reached
through its plan's workspace, read afresh at each use, so a disconnect or a
replaced installation decides the very next read.

`GET /api/github/repositories` (`src/github/github-repositories-app.ts`) is that
listing under the account bearer, answered as
`packages/features/src/github-repositories-wire.ts` declares it: `installed`,
whether the workspace has an installation connected, `repositories` (owner,
name, full name, default branch, private, and when GitHub last saw it
change), and `installationUrl`. Nothing is stored. A `workspaceId` query
names the workspace the listing is for, to a member of it; none named is the
account's first workspace. One the account is not in is `not-found`
(404), and the query given twice is `invalid-request`. A GitHub or a store
the service could not reach is `unavailable`.
`src/github/github-repositories-app.test.ts` holds the route and
`src/github/github-app.test.ts` the reads beneath it, over
`src/testing/github-app-fake.ts`.

Installing the App is browser navigations in `src/github/github-install-app.ts`,
none carrying an account bearer. `GET /api/github/install` sends the browser
to `https://github.com/apps/<slug>/installations/new`, where the developer
installs the App on an account or organization and chooses its repositories.
The App's registered Setup URL, with "Redirect on update", is
`https://tryluke.dev/api/github/installed`: GitHub lands the browser there
with `installation_id` and `setup_action`, and the route sends it on to
`/github-installed.html?status=…` with one word from `GITHUB_INSTALL_STATUS`
(`@luke/features`). Without a `state`, the route confirms the installation
through `installation(id)` as the App and links nothing: `installed`,
`updated`, `requested` (a member asked an organization's owner, so there is
no installation yet), `not-found`, or `unavailable`.

With a `state`, the install began as a workspace's connect, and the route
never trusts `installation_id` alone: GitHub's guidance is that anyone can
put any id on the Setup URL, so a user access token for the user who
installed the App must show the installation is theirs
([About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)).
Luke keeps no user's token for that, so the route writes the installation's
id and a random PKCE code verifier (Better Auth's `generateRandomString`, as
its own flows make one) on the intent, and sends the browser through
GitHub's web application flow
([Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)):
`https://github.com/login/oauth/authorize` with the App's client id, the
callback `/api/github/installed/authorized` as `redirect_uri`, the intent's
own state, and the verifier's S256 challenge. GitHub returns the browser to
the callback with a one-time code. There the intent is spent (deleted with
`RETURNING`, so it links once; unknown, spent, or expired is `expired`), its
account must still be an owner or admin of the workspace (`expired`
otherwise), and the code is exchanged with the verifier
(`GitHubApp.authorizedInstallations`), `GET /user/installations` is read on
the user access token once, and the token is revoked
([Delete an app token](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token));
nothing of it is stored. An installation that user cannot see, a code GitHub
refuses, or a declined authorization is `not-found`. Only then is the
installation linked to the workspace (`connected`); one already linked to
another workspace, or another installation on the same GitHub account, is
`already-connected`.

GitHub's "Request user authorization (OAuth) during installation" stays off:
it disables the Setup URL and returns the code to the App's first callback
URL, the sign-in's, and GitHub's docs say to run the full web flow with
`redirect_uri` to choose the callback instead. So the App lists
`https://tryluke.dev/api/github/installed/authorized` among its callback
URLs, beside the sign-in's.

The page draws a fixed card per status and interpolates nothing the address
brought it; the desktop's repository chip picks the installation up by
reading the workspace's repositories again when the window next takes focus
(`apps/desktop/src/renderer/planning/repository-chip.tsx`).

The App's webhook is `POST /api/github/webhook` (`src/github/github-webhook-app.ts`),
which keeps what a coding agent published current on the agent's row
(`coding_agent.published`) for the plan list while nobody has the agent's tab
open. GitHub signs every delivery with the App's webhook secret,
`GITHUB_APP_WEBHOOK_SECRET`, and the route compares `X-Hub-Signature-256`
against the HMAC-SHA256 of the body's own bytes in constant time before it
reads anything; a deployment without the secret answers every delivery
`unavailable` (503), and a signature that does not hold is `invalid-token`
(401). Only `pull_request` (opened, reopened, closed, edited, synchronize,
ready_for_review, converted_to_draft), `check_suite`, a completed
`check_run`, and `status` are read, for the repository's full name and the branches they
name, and nothing of a delivery is kept or logged: the branch finds the agents
whose rows stand on it, of whichever account, at most ten, newest first, and
each one's pull request is read again from GitHub on a token minted on its
plan's workspace installation through `agentPublished`, as the agent's tab
reads it, which writes the row.
A redelivery reads the same again. GitHub's `ping` and any other event are
answered and ignored. An `installation` delivery, which GitHub sends every
App unsubscribed, moves the status of its workspace's `github_installation`
row: `deleted` to deleted, `suspend` to suspended, `unsuspend` back to active;
`GET /api/workspaces` then carries that workspace's `github.active` as false,
its plans stay reachable, and nothing is deleted. A `github_app_authorization`
delivery, which GitHub also sends every App unsubscribed
([GitHub: github_app_authorization](https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization)),
with action `revoked` clears the sealed tokens, which no longer reach
anything, from the `account` rows of provider `github` whose `accountId` is
the delivery's `sender.id`, and keeps the rows: GitHub's MCP server then
asks for a new sign-in, and that sign-in finds the same Luke account
through the kept row even where GitHub's address has changed since, and
writes fresh tokens onto it. Every other way the account signs in is kept.
That is a write to Better Auth's own table, since a webhook carries no
session and Better Auth documents no server call that clears another user's
provider tokens. `src/github/github-webhook-app.test.ts`
holds it over a scripted GitHub and PGlite.

A Preview's GitHub sign-in still goes through production's OAuth proxy, and
production is the end that exchanges the code, under its own provider
client: a Preview carrying the App's client id can complete a sign-in only
while production's `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`
hold the App's client id and secret, a Vercel project setting rather than anything in
this repository. Nothing on the branch is Preview-specific.

## The admin group

`src/admin/admin-app.ts` is the dashboard's route group: its four reads and the
Users tab's one star write, each its own function, with the group declaring
all five addresses from `ADMIN_ROUTE_PATH` in `src/admin/http.ts` — the
same constants the page composes its calls from, so an address cannot drift
between the two ends. A path the group declares no route for is the admin
vocabulary's own `not-found`; nothing routes one there, since each address is
its own exact-path function, so that refusal is what the group says about
itself.

What the group owns is the gate, and only the gate: `src/admin/gate.ts`
keeps the order the pages depend on — a method the address does not answer is
a 405 before a session is even looked for, an auth seam that throws is a 503
rather than a crash, an anonymous request is a 401 the page answers with a
sign-in, and a signed-in non-admin is a 403 it answers with a plain refusal —
and takes the resolver rather than reaching for it, because the real one is
Better Auth and a gate this much depends on has to be exercisable without a
database. The resolver answers an effect, so the one promise behind it is
`getSession`'s own, wrapped with `Effect.tryPromise` where
`src/admin/admin-route.ts` builds the seam and nowhere in the gate; a
resolution that failed, however it failed, is the same 503. Each read still answers for its own parameters and its own body,
and the group carries that answer as it came, status, headers, and bytes, the
way the auth group carries Better Auth's. `src/admin/admin-route.ts` is
the one place that hands the group this deployment's real session resolver,
database, and integration presence booleans. Every query behind it is an
effect over the ambient `SqlClient`, and so is every seam the group is handed
(`AdminSeamEffect` in `src/admin/seam.ts`): each read composes its query
into the answer it is already building, and the edge serving the request is
the one place the client behind it is provided, so the file names no database
and runs nothing at all: the roster's scope and
search conditions are builder predicates and Drizzle `sql` fragments rather
than concatenated text, and the search term stays a bound parameter with its
own wildcards escaped.

Every admin answer is viewer-gated account data, refusals included, so each
one carries `no-store`, the five refusals the group answers itself included,
in the bytes the promise-shaped vocabulary in `src/admin/http.ts` gives.

## The bearer's resolution

`src/auth/bearer.ts` answers effects. `hostedUserId(request, userInfo)`
and `userIdForAuthorization(authorization, userInfo)` each answer
`Effect<string | undefined>`, and a `UserInfoEndpoint` answers
`Effect<OAuthUserInfo | undefined, UnknownException>`: the auth service's own
`oauth2UserInfo` is a promise of Better Auth's, so it is wrapped with
`Effect.tryPromise` once where an endpoint is constructed —
`hostedUserInfo` in `src/auth/bearer.ts` itself, the brain host's seam,
and the events group's inline one — and nowhere else. What that
call throws is still one indistinguishable nothing: the resolution recovers
it, so a missing header, an expired token, and a refusing auth service are
the same 401 they always were, and no route repeats the recovery.

Every caller yields it. `resolveHostedUserId`, which the account and plans
groups are handed as their `resolveUserId`, and the voice function's own
resolver are Effect-shaped, so each reads the bearer on its own fiber instead
of wrapping a promise in `Effect.promise`. One caller is a
promise of somebody else's: eve's `AuthFn`, which
`apps/web/eve/channels/eve.ts` satisfies by running the resolution once at
that authored file — eve's own edge — rather than keeping a promise-shaped
door beside the effect in `src/auth/`. `lukeAccount` takes the
resolved account as a `BearerAccount` promise and reaches no userinfo
endpoint of its own.

## The dictation group

`src/dictation/dictation-app.ts` answers `POST /api/dictation`: one clip the
developer dictated into a message box, `{ audio, durationMs, keywords }`
(`@luke/features/dictation-wire`), answered `{ text }`. The clip is WebM
with Opus in base64, held to two minutes and a megabyte and refused past
either as `request_too_large` before anything goes upstream; `keywords` are
up to fifty words the desktop expects to hear (the repository, the plan's
title, the paths it names), each on one line. `src/dictation/transcription.ts`
sends the clip and the words to OpenAI's `gpt-transcribe` on Luke's key as one
multipart `POST /v1/audio/transcriptions`, the words as its `keywords[]`
([OpenAI's speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)).
Nothing of the clip or the text is stored, logged, traced, or counted as an
event; a failure logs OpenAI's status alone and answers `unavailable`, as a
deployment without `OPENAI_API_KEY` does. The day is metered one call and the
seconds OpenAI billed, or the clip's own length where the answer reports none,
and a meter the database refused is logged while the text is still answered.
There is no path on an account's own key. `src/dictation/dictation-app.test.ts`
answers the route over a scripted OpenAI at its HTTP door.

## The models group

`src/accounts/models-app.ts` answers `GET /api/models`: the models a coding agent
may run on, as `{ models: [{ id, name, provider, efforts, contextWindows? }] }`. The list is
`src/providers/model-catalog.ts`'s read of AI Gateway's public catalog
(`https://ai-gateway.vercel.sh/v1/models`, no key), Schema-decoded at the
boundary and kept to the Anthropic and OpenAI models whose tags carry both
`tool-use` and `reasoning`; each model's efforts are the `values` of the
`effort` entry among its `reasoning_options`, and a model listing none is
left out, since no Start could name an effort for it. A model offers two
context windows, `contextWindows: { standardTokens, longTokens,
longInputPriceFactor?, longOutputPriceFactor? }`, where its `pricing` tiers
its input past a boundary inside its `context_window` — OpenAI's 272K on the
GPT-5.4 line and after, Anthropic's 100K on Claude Haiku 5.5 — and a model
priced the same across its whole window has the one window; the boundary is
the standard window, which a choice opts into, and the whole window is the
long one, which every choice runs on unless it names the standard one, as
every agent did before the choice existed; the factors are what the tier
past the boundary costs beside the first. No offered model needs a request
option for either window, so the choice is the window eve compacts against
and the context ring reads, nothing more. The read is the
`ModelCatalog` service `apps/web/server/runtime.ts` builds once per instance, cached
for an hour on a success and for no time on a failure, so an outage at the
gateway is retried on the next request rather than answered for the hour.
The bearer is resolved before the read, as every hosted endpoint resolves
it, though the catalog is public and the same for every account.

The same module holds the functions the coding-agent routes and the coder
host stand on: `acceptedModelChoice`, which reads the instance's catalog and,
through `validateModelChoice`, accepts a `(model, effort)` only for an
offered model at an effort it lists, keeping the standard window only for a
model that offers two, and `providerModelOf`, which turns a
catalog id into the id the provider's own API takes — model calls go to
Anthropic and OpenAI directly on Luke's keys, never through the gateway — so
`anthropic/claude-opus-5.5` is `claude-opus-5-5` and an OpenAI id is the
catalog's after its prefix. `src/providers/model-catalog.test.ts` reads the catalog
through a scripted gateway and the test clock; `src/accounts/models-app.test.ts`
answers the route over a fixed catalog.

## Accounts' own provider keys

`src/accounts/provider-keys-app.ts` answers `/api/account/provider-keys`, the
account's own Anthropic and OpenAI API keys, at most one per provider:
`GET` answers what each is, `PUT` saves one, and `DELETE
?provider=<provider>` removes one, each answered with the keys as they then
stand (`@luke/features/provider-key-wire`). No answer carries a key: what
the account is shown is the provider, a hint of the key's prefix and last
four characters (`sk-ant-…abcd`), when it was added, and its status —
`verified`, `invalid`, `quota_exceeded`, or `unreadable` where the ring
below can no longer open it. A save asks the provider first, with one read
of its model list, which bills nothing (`src/providers/provider-key-check.ts`):
a 200 keeps the key as verified, a 401 or 403 keeps nothing and answers
`rejected: invalid`, anything else keeps nothing and answers `unreachable`,
and a key spelled as the other provider's is answered `wrong_provider`
without being sent anywhere. Saves are braked at ten an hour per account
on each instance, so the endpoint is no oracle for keys that are not the
caller's. Neither the key nor what the provider said of it is logged.

A key is kept in `account_provider_key` (migration 0080), sealed by
`packages/database/src/models/provider-key-seal.ts`: AES-256-GCM under a data key drawn
for that save, the data key wrapped under the deployment's key-encryption
key, with the account and provider bound as additional data on both seals
and the version on the wrap, so a sealed key copied onto another row does
not open. The row holds the version, the wrapped data key, the sealed key,
the hint, and the status; it is replaced whole by a save, deleted by a
removal, and cascades with the account. `packages/database/src/models/provider-key-store.ts`
reads and writes the rows and never sees a key in the clear.

The key-encryption keys are `PROVIDER_KEY_ENCRYPTION_KEYS`, read through
`HostedEnvironment`: comma-separated `<version>:<base64 of 32 random
bytes>` entries, the version new saves wrap under first. Production and
Preview each hold their own. A deployment without it, or with a value that
is no list, answers every request on the path `unavailable` and logs which
shape is wrong, never the value. To set one up:

```
openssl rand -base64 32          # one key; repeat for the other environment
vercel env add PROVIDER_KEY_ENCRYPTION_KEYS production   # value: 1:<key>
vercel env add PROVIDER_KEY_ENCRYPTION_KEYS preview      # value: 1:<another key>
```

A rotation is two steps. First put a new version at the head of the list,
`2:<new key>,1:<old key>`, and redeploy: new saves wrap under version 2, and
rows on version 1 still open. Then ask that deployment for the rewrap:

```
CRON_SECRET=<the deployment's own> scripts/rewrap-provider-keys.sh https://tryluke.dev
```

The script is a `POST /api/maintenance/provider-keys-rewrap` under the
deployment's `CRON_SECRET`, compared in constant time as the sweep's is, so
the rewrap (`src/accounts/provider-key-rewrap.ts`) runs on the deployment
over the ring it holds and the key-encryption keys never leave Vercel. It
unwraps each older row's data key and wraps it under the head version,
leaving the sealed key itself untouched, and answers counts: the version,
moved, already current, changed meanwhile, and unreadable. Run it again
until nothing is changed meanwhile; once nothing names the old version,
drop it from the list and redeploy. A row counted unreadable reads
`unreadable` to its account, which is told to replace it. It is not a
migration, since a migration holds no key and runs before the deployment
whose ring it would need.

## Integrations

Every agent Luke runs — the planning assistant, the coding agent, and each
one's declared worker — can use the signed-in account's integrations, each
through the provider's own hosted MCP server with every tool it lists, the
ones that write and the ones that answer a credential among them (`AGENTS.md`'s
carve-out for integrations), and no approval step of Luke's: Executor
(`https://mcp.executor.sh/mcp`, the apps the developer set up in Executor),
GitHub (`https://api.githubcopilot.com/mcp/x/all`, every toolset), Granola
(`https://mcp.granola.ai/mcp`), Linear (`https://mcp.linear.app/mcp`), Mercury
(`https://mcp.mercury.com/mcp`), Neon (`https://mcp.neon.tech/mcp`), Notion
(`https://mcp.notion.com/mcp`), PostHog (`https://mcp.posthog.com/mcp?mode=tools`, each tool by its own
name rather than its default single `exec`),
Sentry (`https://mcp.sentry.dev/mcp`), Slack (`https://mcp.slack.com/mcp`),
Supabase (`https://mcp.supabase.com/mcp`), Vercel (`https://mcp.vercel.com`),
and Y Combinator's Bookface (`https://api.ycombinator.com/v1/mcp`). What a
grant can do is still the provider's to bound: the scopes its connector asks
for, and the boxes the developer leaves ticked on the provider's own consent
page. Executor bounds it further by its own policy on each app's tools: a
call an app holds for approval, or that needs input, answers the agent with
the question and a request id, at the plain `/mcp`, its default `model`
elicitation mode, and the agent asks the developer and calls Executor's
`resume` with their answer. Its `native` mode would ask over an MCP
elicitation instead, which eve's client never answers, so Executor's
connection stays on the plain URL, and the mode is fixed in the grant
whatever URL a client later opens it at (https://executor.sh/docs/mcp). A connection belongs to the account, so it reaches every plan and
project the account has. `src/integrations/integrations.ts` is the one table of
providers: the variable each connector's UID is read from, the one naming
the accounts it is offered to, its MCP server
and what the model is told of it, and the name its nested calls are stored
under. Everything below is the same for every provider but GitHub, whose
grant is the account's own GitHub sign-in.

**GitHub's grant** (`src/integrations/github-integration.ts`). GitHub's MCP
server takes a GitHub App user token, and an account that signed in with
GitHub already holds one: the Luke GitHub App's, which `GitHubApp.userToken`
reads off the `account` row and refreshes ("The Luke GitHub App" above). So
GitHub has no connector, no `integration_connection` row, and no Connect or
Disconnect (`INTEGRATION_GRANT_OF` in `@luke/features/integration-wire`): the
statuses route answers it `connected` while that token reads, `disconnected`
for an account with no usable GitHub sign-in, and `unavailable` on a
deployment without the App, and a turn is handed GitHub's server wherever the
App is configured. The token handed to eve is said to expire inside
`userToken`'s refresh margin, so eve asks again, and the token is refreshed
if need be, before it lapses. What the agents reach is what the App reaches
for the account, under the App's permissions, on the repositories it is
installed on. Settings › Integrations' GitHub row is where an account links its own GitHub, through the connect
page, or disconnects it, under the Mac's session; that link reaches no
repository of a workspace's, which comes from the workspace's installation
alone. The grant ends with the account's GitHub, when the developer
disconnects or revokes the App or deletes the account.

**Who holds what.** Vercel Connect holds each grant, encrypted, and refreshes
it; Luke never stores a token. Luke holds one row per account and provider
in `integration_connection` (`schemas/integration.ts`), which is its own word
on whether its agents may use the grant: `connected` lets them, anything else
or no row does not. Connect has no way to ask whether a sign-in finished and
its SDK caches tokens in process, so this row is also what makes a Disconnect
take effect regardless of any cache. The migration that made the table copied
every row of Linear's own table in as Linear's, and the one after it dropped
that table.

**The routes** (`src/integrations/integrations-app.ts`):

- `GET /api/account/integrations` answers `{ integrations: { <provider>:
  status }, signInFailures?: [{ provider, reason, message? }] }`, each
  status `connected`, `pending`, `expired`, `disconnected`, or
  `unavailable` (no connector for it on this deployment). A sign-in still
  under way, begun within the last fifteen minutes, is settled here by
  asking Connect for a token afresh, and stands `pending` until it settles,
  over an `expired` row as over none. One with no token yet is asked after
  by the `verifier` Connect's `startAuthorization` answered it with, kept in
  the row's `connect_verifier` beside its state (never logged, never
  answered): Connect's `GET /v1/connect/result/{verifier}`, the read its
  CLI polls, under the deployment's OIDC token. One Connect answers
  `canceled` (the developer cancelled on Connect's page) or `error` (Connect
  or the provider refused it) is ended here and named once in
  `signInFailures`, `reason` `canceled` or `error`, with the first line of
  Connect's error message, cut to 200 characters, where it is shaped like no
  credential (`credentialFreeLine` in `src/integrations/mcp-tools.ts`).
- `POST /api/account/integrations/{provider}/connect` asks Connect's
  `startAuthorization` for the account, with Luke's own user id as the
  subject and `/api/account/integrations/connected?state=…` as the callback,
  records the sign-in's one-time state and Connect's verifier, and answers
  the address. The
  desktop's host opens it through the native node; no window draws it and
  nothing logs it.
- `POST /api/account/integrations/{provider}/cancel` ends the sign-in under
  way and nothing else: a first sign-in's row goes, any other row keeps its
  status, and no grant is revoked, so a sign-in that completed just before
  the press stays connected. It answers `{ status }` as it then stands. The
  desktop's Cancel asks it, never a Disconnect.
- `POST /api/account/integrations/{provider}/disconnect` deletes the row
  first, then asks Connect to revoke the grant. A failed revoke is logged and
  the account is disconnected all the same. Connect revokes at the provider
  where the provider allows it; otherwise its token stands until it expires,
  though Luke no longer uses it. Deleting the account revokes every
  provider's grant the same way.
- `GET /api/account/integrations/{provider}/tools` answers the tools the
  provider's server offers the account's agents, `{ tools: [{ name, title?,
  description, annotations?, parameters? }] }`, for the composer's MCP
  popover and Settings › Integrations. It reads them as an MCP client does
  (`src/integrations/mcp-tools.ts`: `initialize`, then `tools/list` page by
  page, JSON or event-stream answers), with the account's token from
  Connect. A title is the tool's own, else its annotations', the spec's
  order; a description is kept whole up to 8,000 characters; the hints are
  kept as the server spelled them; and the parameters are the input
  schema's top-level arguments, gathered through `allOf` and its own
  `$defs` references, each its name, its type in a few words,
  whether it is required, and its description, values, and default where
  the schema gives them, the required first and 64 at most, and none at all where the schema
  cannot be read as an object's (`src/integrations/mcp-tool-parameters.ts`).
  None of it is what a model is handed. It is held in the instance's memory
  for five minutes per account and provider. A provider the account has not
  connected is refused as unavailable before any token is read.
- `GET /api/account/integrations/connected` is where Connect returns the
  browser from any provider. The state names the account and the provider,
  Connect is asked for a token afresh, and the browser lands on
  `/integration-connected.html` with the provider and one word: `connected`,
  `not-completed` (declined or cancelled), `expired`, or `unavailable`. A
  `not-completed` ends the sign-in, so the desktop's next read finds it no
  longer pending and says it failed, unless Connect's result names it
  `canceled` or `error`: that one is left for the next statuses read, which
  says why as it ends it. The callback carries the state Luke put on it and
  nothing of Connect's: no error and no reason. A sign-in that fails on
  Connect's own page ("Connection Failed", a token exchange the provider
  refused) never sends the browser back here at all, and the statuses read
  is what learns how it ended, from Connect's result.

The rewrite moves a provider's path segment into the `provider` query
(`apps/web/server/function-rewrites.ts`), as a plan's id is moved into `id`.

**The agents** (`src/integrations/integration-connection.ts`,
`src/agents/agent-runtime/connections.ts`). eve hands a declared subagent
none of its parent's connections, so each of the four agents registers one
`connections/integrations.ts`: a dynamic connection resolved as each turn
starts, which hands the turn every server its role's policy has on
(`src/agents/agent-runtime/servers.ts`), each the one definition over its provider and
that agent's own ownership check: the root's `admit`, or a worker's
`admitDelegated`. The planning agents are handed every integration; a coding
agent and its worker are handed every one the developer has not switched off
for that agent. The
definition's auth is eve's plain `getToken` form, credentialed as the app,
and the account is the admitted conversation's owner, never the session's
principal. That matters because a spoken planning turn runs as the
deployment acting for the account, and eve's user-scoped auth (`connect()`
from `@vercel/connect/eve`) would refuse it before reading any token. That
form has no interactive half either, so eve never pauses a run for a
sign-in. eve opens the client once per model step: the row is read at each
opening, and again after Connect answers, so a Disconnect takes effect from
the next step. A connection that cannot be used throws one of
`integrationUnavailable`'s fixed sentences, which fails only the call that
tried it; every other tool, and the run, carries on. Workers stay read-only
in the checkout and change an integration only when their task explicitly
asks them to.

**Transcripts** (`src/integrations/connection-tools.ts`). eve offers a
connection through `connection_search` and `connection_execute`, and tells a
remote call as a call of its own nested under the `connection_execute` that
ran it, named `<provider>__<tool>`, with id `<wrapper>:1`. The relay stores
the nested call under the provider's fixed name (`linear_remote` for
Linear), whose input is `{ remoteTool, parentCallId, input }`, and settles it
with what the provider answered, before the wrapper's own result. Every name
is in both agents' tool sets whatever any account's connections stand at, so
a transcript reads back the same after a Disconnect. Rows hold provider
content (Linear's issues and comments, Notion's pages); no token reaches a
row. A turn cancelled while a provider was answering leaves the call's
outcome unknown ("it may have run"), never a failure to retry.

**Provisioning a deployment.** For each provider, from the `apps/web` Vercel
project's directory:

```
vercel link
vercel connect create mcp.executor.sh --name executor          # Executor; corrected below
vercel connect create mcp.linear.app --name linear             # Linear; prints the connector UID
vercel connect create mcp.notion.com --name notion             # Notion
vercel connect create mcp.sentry.dev --name sentry             # Sentry
vercel connect create granola --name granola                   # Granola
vercel connect create mcp.mercury.com --name luke-mercury      # Mercury, whose clients' names may not begin with "Mercury"
# Neon: an OAuth connector over a client registered by hand, below
vercel connect create posthog --name posthog                   # PostHog
vercel connect create supabase --name supabase                 # Supabase
vercel connect create vercel --target mcp --name vercel        # Vercel, through Connect's own Vercel MCP target
vercel connect create api.ycombinator.com/v1/mcp --name ycombinator   # Y Combinator's Bookface
vercel connect attach <connector-uid> --yes                    # each of the above: production, preview, and development
# Slack: an OAuth connector against Slack's MCP authorization server, created and attached below
```

Each of those is a server that publishes its OAuth discovery and registers
clients itself, so Connect registers its own client and no app of ours is
needed; a provider in Connect's catalog is created by its catalog name, the
rest by their server's address. Vercel's MCP server accepts only the clients
Vercel has reviewed, which is why it is created through Connect's own Vercel
target rather than by address. A connector created this way asks for no
scopes, and the provider grants its own default, which is enough for
Linear, Notion, Sentry, Granola, and Vercel. Mercury grants a write scope,
and a refresh token (`offline_access`), only when asked; Y Combinator's
server asks for `mcp:access`; and PostHog's and Supabase's granular scopes
are better asked for in full than left to a default. Those four connectors
ask for every scope their server publishes (`scopes_supported` in its
`/.well-known/oauth-protected-resource`), set on the connector's
`data.userAuthorization.scopes`:

```
vercel connect list                                        # the connector's scl_ id
vercel api "/v1/connect/connectors/<connector-id>?teamId=<team-id>"   # what it stands at now
# ~/scopes.json: {"data":{"userAuthorization":{"enabled":true,"scopes":["read","offline_access",…]}}}
vercel api "/v2/connect/connectors/<connector-id>?teamId=<team-id>" -X PATCH --input ~/scopes.json
```

Every `vercel api` call on a connector names the team in its URL. The CLI
run by an agent without a terminal ignores the saved team and `--scope`,
and takes the team from `VERCEL_ORG_ID` or the directory's link instead,
so a connector of another team answers 404 ("Connector not found") although
`vercel connect list`, which picks its team itself, lists it; a `teamId`
already in the URL is the one the CLI sends. The PATCH answers the
connector wrapped as `{"connector": {…}}`, the GET bare.

A grant is then bounded by what the developer allows on the provider's
consent page alone. Mercury's `transactions:request` and `transfers:request`
scopes request a payment or transfer that an approver still confirms in
Mercury. Y Combinator's server serves only accounts YC has enabled MCP
access for.

**Neon's connector.** Neon's registration endpoint refuses a client that
does not name its `response_types`, which Connect's registration leaves
out, so Neon's client is registered by hand at that endpoint and the
connector is a plain OAuth connector over it, with Neon's two scopes
(Neon's consent page still asks whether to allow writes):

```
(umask 077; curl -s https://mcp.neon.tech/api/register -H 'content-type: application/json' -d '{"client_name":"Luke","redirect_uris":["https://connect.vercel.com/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"client_secret_post","scope":"read write"}' > ~/neon-client.json)
# ~/neon.json, from its client_id and client_secret, written under the same umask:
# {"serverUrl":"https://mcp.neon.tech","clientId":"…","clientSecret":"…","tokenEndpointAuthMethod":"client_secret_post","pkceRequired":true,"userAuthorization":{"enabled":true,"scopes":["read","write"]},"refreshTokens":{"enabled":true}}
vercel connect create mcp.neon.tech --name neon --connector-type oauth --data @"$HOME/neon.json" --json
rm ~/neon-client.json ~/neon.json
vercel connect attach <connector-uid> --yes
```

**Executor's connector.** Executor's authorization server
(`https://executor.sh/.well-known/oauth-authorization-server/api/auth`) has
the issuer `https://executor.sh/api/auth` and its endpoints on
`app.executor.sh`, publishes no client ID metadata document support, and
lists `none` among its token endpoint auth methods. So, as for Granola, a
public client is registered by hand at its registration endpoint and the
connector is PATCHed to it, with the two scopes the server's challenge names
(`mcp` and `offline_access`, the latter for a refresh token) and the RFC
8707 resource its protected-resource document answers
(`https://mcp.executor.sh/mcp`, the path included), pinned rather than left
to what Connect derives from the host it was created by, as Y Combinator's
is. Each grant belongs to the one Executor organization the developer picks
on its consent page.

```
(umask 077; curl -s https://app.executor.sh/api/auth/oauth2/register -H 'content-type: application/json' -d '{"client_name":"Luke","redirect_uris":["https://connect.vercel.com/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none","scope":"mcp offline_access"}' > ~/executor-client.json)
jq '{data:{clientId:.client_id,tokenEndpointAuthMethod:"none",pkceRequired:true,codeChallengeMethod:"S256",defaultResource:"https://mcp.executor.sh/mcp",userAuthorization:{enabled:true,scopes:["mcp","offline_access"]}}}' ~/executor-client.json > ~/executor-patch.json
(umask 077; vercel api "/v1/connect/connectors/<connector-id>?teamId=<team-id>" > ~/executor-before.json)   # the backup
vercel api "/v2/connect/connectors/<connector-id>?teamId=<team-id>" -X PATCH --input ~/executor-patch.json
rm ~/executor-client.json ~/executor-patch.json
```

**Granola's, PostHog's, Supabase's, and Y Combinator's connectors.** Each
is created as above and then corrected in place, its UID unchanged, because
the client Connect registers for it fails at the provider:

- Granola and PostHog publish client ID metadata documents and
  `private_key_jwt`, and Connect signs a client assertion whose audience
  they refuse at the code exchange (Granola: "client_assertion aud must be
  the authorization server issuer"). Both accept a public client, so one is
  registered by hand at the provider's registration endpoint
  (`https://mcp-auth.granola.ai/oauth2/register`,
  `https://oauth.posthog.com/oauth/register/`) with
  `"token_endpoint_auth_method":"none"`, and the connector is PATCHed to it:
  `{"data":{"clientId":"…","tokenEndpointAuthMethod":"none","pkceRequired":true,"codeChallengeMethod":"S256"}}`.
- Supabase's authorization server publishes no client ID metadata document
  support and answered Connect's client "Unrecognized client_id". It takes
  confidential clients alone, so one is registered by hand at
  `https://api.supabase.com/platform/oauth/apps/register` with
  `"token_endpoint_auth_method":"client_secret_post"`, and the connector is
  PATCHed to its `clientId` and `clientSecret` with
  `"tokenEndpointAuthMethod":"client_secret_post"` and `"pkceRequired":true`.
- Y Combinator's protected resource is its origin
  (`https://api.ycombinator.com/.well-known/oauth-protected-resource`
  answers `"resource":"https://api.ycombinator.com"`, and the path-scoped
  document is absent), so the RFC 8707 resource Connect derived from
  `/v1/mcp` was refused ("The requested resource is missing, unsupported,
  or does not match the authorization grant"). The connector pins it:
  `{"data":{"defaultResource":"https://api.ycombinator.com"}}`.

Each registration names `https://connect.vercel.com/callback`, the redirect
a connector without a `redirectUri` of its own replays, and is written under
`umask 077`, and every registration file is deleted once its PATCH is in,
as Neon's is, since nothing reads it again and Supabase's holds its secret.
The backup a PATCH is taken against is written the same way, since a
connector's read may carry its credentials too, and is kept until the
provider connects, the one way back if it does not
(`rm ~/granola-before.json` after a sign-in succeeds).
Granola's, for example:

```
(umask 077; curl -s https://mcp-auth.granola.ai/oauth2/register -H 'content-type: application/json' -d '{"client_name":"Luke","redirect_uris":["https://connect.vercel.com/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}' > ~/granola-client.json)
jq '{data:{clientId:.client_id,tokenEndpointAuthMethod:"none",pkceRequired:true,codeChallengeMethod:"S256"}}' ~/granola-client.json > ~/granola-patch.json
(umask 077; vercel api "/v1/connect/connectors/<connector-id>?teamId=<team-id>" > ~/granola-before.json)   # the backup
vercel api "/v2/connect/connectors/<connector-id>?teamId=<team-id>" -X PATCH --input ~/granola-patch.json
rm ~/granola-client.json ~/granola-patch.json
```

A sign-in can still fail once right after a connector changes, Granola's
did, and connects on a second try. Supabase's consent page asks which
organization to grant before it returns, and a sign-in that waited there
came back to Connect as "Callback state not found or expired"; signing in
again straight through connects.

Then set the provider's variable (`EXECUTOR_CONNECTOR_UID`, `GRANOLA_CONNECTOR_UID`,
`LINEAR_CONNECTOR_UID`, `MERCURY_CONNECTOR_UID`, `NEON_CONNECTOR_UID`,
`NOTION_CONNECTOR_UID`, `POSTHOG_CONNECTOR_UID`, `SENTRY_CONNECTOR_UID`,
`SLACK_CONNECTOR_UID`, `SUPABASE_CONNECTOR_UID`, `VERCEL_CONNECTOR_UID`,
`YCOMBINATOR_CONNECTOR_UID`) to that UID in the `luke-web` project for
production, preview, and development. The web, `eve`, and `coder` are services of that
one project (`apps/web/vercel.json`'s `services`), so its variables and the
connector's link reach all three, which matters because the agents read
tokens too. Asking Connect about an arbitrary user id needs the deployment's
own Vercel OIDC token, which the SDK reads from the request
(`x-vercel-oidc-token`) or `VERCEL_OIDC_TOKEN`. Keep OIDC enabled for the
project. For local development, `vercel env pull` writes a
short-lived `VERCEL_OIDC_TOKEN`. A deployment without a provider's variable
runs every agent without that provider, and neither Settings nor the
composer's MCP servers popover draws a row for it. Every token request is
billed by Connect and rate-limited per team.

**Slack's connector.** Slack's MCP server serves user tokens alone, and only
ones issued by its own authorization server
(`https://mcp.slack.com/.well-known/oauth-authorization-server`: Slack's
`oauth/v2_user/authorize` and `oauth.v2.user.access`). Vercel's managed
Slack connector (`vercel connect create slack`) signs in through Slack's
classic app OAuth instead, so its tokens are refused by the server
(`invalid_token`), and its app's default user scopes mix Sign in with
Slack's `identity.*` scopes with the rest, which Slack refuses to grant in
one authorization ("Invalid permissions requested"). Slack's connector is
therefore a plain OAuth connector against the MCP server's own
authorization server, credentialed by a Slack app of the team's workspace:

1. The app is internal, never publicly distributed, since the server serves
   Marketplace and internal apps alone.
2. Its Redirect URLs (OAuth & Permissions) include Connect's callback,
   `https://connect.vercel.com/callback`, which is the one a connector uses
   unless its own `redirectUri` names another (`vercel api
   /v1/connect/connectors/<connector-id>`).
3. Its User Token Scopes are the ones below, and none is an `identity.*`
   scope.
4. Its Model Context Protocol switch is on (Agents & AI Apps,
   `https://api.slack.com/apps/<appId>/app-assistant`). Without it the
   server answers every request 400 ("App is not enabled for Slack MCP
   server access", which Settings shows on Slack's row), and a token issued
   before the switch went on keeps that 400, so whoever connected before
   connects again.
5. Its App Credentials go into `~/slack-mcp.json`, outside the checkout so
   an interrupted setup cannot leave the secret where a commit picks it up,
   and written by hand rather than through a shell command so it stays out
   of shell history; the connector is created from it and linked to the
   project:

```json
{
  "serverUrl": "https://mcp.slack.com",
  "clientId": "<Client ID>",
  "clientSecret": "<Client Secret>",
  "tokenEndpointAuthMethod": "client_secret_post",
  "pkceRequired": true,
  "userAuthorization": {
    "enabled": true,
    "scopes": [
      "search:read.public", "search:read.private", "search:read.mpim", "search:read.im",
      "search:read.files", "search:read.users", "emoji:read",
      "channels:history", "groups:history", "mpim:history", "im:history",
      "channels:read", "groups:read", "mpim:read", "im:read",
      "chat:write", "reactions:read", "reactions:write",
      "channels:write", "groups:write", "mpim:write", "im:write",
      "canvases:read", "canvases:write", "lists:read", "lists:write",
      "files:read", "files:write", "users:read", "users:read.email"
    ]
  },
  "refreshTokens": { "enabled": true }
}
```

```
vercel connect create mcp.slack.com --name slack-mcp --connector-type oauth --data @"$HOME/slack-mcp.json" --json
rm "$HOME/slack-mcp.json"
vercel connect attach mcp.slack.com/slack-mcp --yes   # production, preview, and development
```

Those are the user scopes every tool of Slack's MCP server needs
(`https://docs.slack.dev/ai/slack-mcp-server/`: search, read, send and
schedule messages, react, create conversations, write canvases and lists,
and upload files), and the Slack app's User Token Scopes hold the same list.
A scope added later goes on the app first, then on the connector, whose
`userAuthorization.scopes` a PATCH changes (`vercel api
/v2/connect/connectors/<connector-id> -X PATCH --input <file>`); a token
keeps the scopes it was granted, so everyone connected before connects
again. `SLACK_CONNECTOR_UID` is the UID this create prints
(`mcp.slack.com/slack-mcp`). A developer who connected under another
connector disconnects and connects again, because a grant belongs to the
connector it was made under.

**Offering a provider to some accounts.** An internal Slack app works for
its own workspace alone, so production offers Slack only to the accounts
that workspace's people sign in with. Each provider has an optional
allowlist variable beside its connector's (`<PROVIDER>_ALLOWED_ACCOUNTS`:
`EXECUTOR_ALLOWED_ACCOUNTS`, `GRANOLA_ALLOWED_ACCOUNTS`, `LINEAR_ALLOWED_ACCOUNTS`,
`MERCURY_ALLOWED_ACCOUNTS`, `NEON_ALLOWED_ACCOUNTS`,
`NOTION_ALLOWED_ACCOUNTS`, `POSTHOG_ALLOWED_ACCOUNTS`,
`SENTRY_ALLOWED_ACCOUNTS`, `SLACK_ALLOWED_ACCOUNTS`,
`SUPABASE_ALLOWED_ACCOUNTS`, `VERCEL_ALLOWED_ACCOUNTS`,
`YCOMBINATOR_ALLOWED_ACCOUNTS`): comma-separated entries, each `@domain.com` for
every account whose email is at that domain, or one exact email, matched
without regard to case against the email on the account's user row.
Unset or empty, the provider is offered to every account. The list fails
closed: one of nothing but blanks offers the provider to nobody, and an
entry of neither shape (a bare `@`, a domain without its `@`) is ignored
rather than read as matching anything. The list lives in the project's
Vercel environment alone, never in code:

```
vercel env add SLACK_ALLOWED_ACCOUNTS production   # e.g. @example.com,someone@example.org
```

The server enforces it for every read and agent
(`accountIntegrationConnect` in `integration-connect.ts`): an account the
list leaves out is answered `unavailable` by the statuses read, refused by
Connect and the tools read as a provider with no connector is, lands a
sign-in it began earlier on `unavailable`, and no agent of its is handed
the provider's server (`src/agents/agent-runtime/servers.ts`); the desktop draws no row
for it. Disconnect and deleting the account still revoke its grant.

## The coding-agent service

`apps/web/coder/` is the second eve app root, built and deployed as the `coder`
service beside `eve` on the same terms (`apps/web/vercel.json`): its own
`package.json` (`@luke/coder`, whose one dependency is `eve`), a flat layout
eve resolves as an app root, and a build that prewarms its sandbox snapshot
under the same Vercel Sandbox credentials. It stands at eve's named mount:
the public route is `/eve/coder/v1/*`, which the deployment's first rewrite
carries into the service, whose own one `routes` entry turns it back into
`/eve/v1/*` with a `request.path` transform before eve's router reads it,
and whose build exports `EVE_PUBLIC_ROUTE_PREFIX=/eve/coder` so the callback
URLs eve mints resolve to the public path. The web functions reach it through
`src/agents/brain-host/eve-sessions.ts` with `mount: EVE_MOUNT.CODER`.
`apps/web/tests/vercel-services.test.ts` holds the three services and that routing.

A coding agent is one eve session over a `coding_agent` conversation
(`packages/database/src/models/coding-agent-store.ts`), and the host behind the authored
files is `src/agents/coder-host/`: the same door and conversation
admission as the planning brain's (`src/agents/brain-host/door.ts`,
`src/agents/brain-host/conversation.ts`), with the developer's own bearer the caller
the channel walks in for the desktop's routes (`src/agents/coder-host/channel.ts`): a
Start and a Stop come from a route still holding it, and a follow-up
steers; the deployment acting for the account is admitted for the two things
the voice brain does there on the developer's behalf, a typed opening that
starts an agent and a typed line that steers one, each minted as the
developer's own principal with the deployment named as its carrier. The agent (`apps/web/coder/agent.ts`) runs none of eve's default
tools and authors its own under `apps/web/coder/tools/`, which is exactly the set the
store writer registers (`src/agents/coder-host/tool-set.ts`): eve's `bash`, `read_file`,
`write_file`, and `glob`, the code extension's `apply_patch` and `grep` from
`apps/web/eve/extensions/code/tools`, the planning model's own `search_web` and
`read_web_page` (`public-research.ts`: the search screened, cited, and
budgeted per turn on Luke's key and counted on the account's meter, the page
read refusing any address off the public internet), and two of Luke's own: `delegate`, the hand-off to a worker (below), and
`edit_plan` (`src/agents/coder-host/plan-edit.ts`), which takes the
notetaker's own notes (`@luke/features/plan-template`'s `planNotesSchema`)
into the agent's plan through the plan's one write (`plan-notes.ts`): an open
question the agent met with the assumption it goes on under, a fact it
corrected in the code, a decision it made. The save is journaled on the plan
row (`plan.agent_edits`, the last fifty, the agent's id and its notes as
taken) and named from the agent's row at read time, so the window's "Updated
by" line and the planning model's "recent edits by coding agents" say what the
row says now; the developer reads them on their next planning call while the
agent runs on, and a turn may take only so many notes. The
extension itself is not mounted, since its `worker` subagent runs on an AI
Gateway model and its `gh` tool on Vercel Connect, and Luke runs neither.
`gh` and `git` run through the shell, authenticated at the firewall. The
session's input tokens are uncapped and compaction is eve's default.

The worker (`apps/web/coder/subagents/worker/`) is Luke's own declared subagent, in
the planning worker's shape (`apps/web/eve/subagents/worker/`): read-only in the
agent's own sandbox and checkout, uncommitted edits included
(`defineParentSandbox`), authored exactly the agent's reads
(`WORKER_TOOL_NAMES`: `bash`, `read_file`, `glob`, `grep`, `search_web`,
`read_web_page`), told to change nothing, and uncapped in tokens, as the
agent it runs under is. It is declared
hidden (`tool: false`), because eve's own subagent tool carries a message
and nothing else, and the agent chooses each worker's model and effort: the
model sees `delegate` (`apps/web/coder/tools/delegate.ts`), a resumable task
(`serve`, the shape eve gives every agent call) whose input is
`{ task, model?, effort?, background? }`. The call answers with eve's
receipt at once and the worker's answer reaches the agent as a task result,
so the turn stays open while it works; unless the agent sets `background`,
the tool's words have it call `task_wait` right after, which is a foreground
delegation in eve's terms, and a developer's message during the wait reaches
the agent at once without stopping the worker. Several calls in one step run
at once, and a call with the task's id sends the worker more, into the same
session. The planning model delegates through the same shape
(`apps/web/eve/tools/delegate.ts`, `PLANNER_DELEGATE_TOOL`), always in the background
and on its own model, its worker declared hidden too; the Work tab reads its
calls as worker calls under either name, eve's `worker` in earlier
transcripts (`PLANNER_DELEGATION_TOOLS`). A worker's row in an agent's tab
says where the worker's own session stands (the page's `subagents`), since
the call settles at the receipt.
Its step fills the pair in from the agent's own row, holds it to the same
catalog a Start is held to (`src/agents/coder-host/delegation.ts`, refusing with the
models offered or the named model's efforts, which the body throws so the
model reads it and tries again), opens the child conversation the call
names (`childConversationId(agent conversation, callId)`, as the planning
worker's is named) and writes the pair under it
(`coding_agent_delegation`, migration 0066); then the body opens the worker
through `ctx.agent("worker")`. eve hands a resolver no lineage, so the
worker's hook (`subagents/worker/hooks/store.ts`) pins the parent call's id
in the worker's own state as the session starts, the model resolver reads
it at every step and is told the recorded pair (`host.delegatedModel`), and
the hook relays the worker's stream into the child conversation as a child
turn naming that pair (`host.relayChild`). The task's result names the pair
and the worker's answer; the starting call's `toolCallId` is what names the
child. `delegate` is not among `SANDBOX_TOOLS`: a refused or web-only
delegation opens no sandbox, and counting it would have the turn's end open
one only to stop it, so a sandbox a worker opened is stopped at the end of
the first turn in which the agent runs a sandbox tool of its own.

The model is chosen at every step (`src/agents/coder-host/model.ts`): the agent's row
names the catalog id and effort, `providerModelOf` turns the id into the
provider's own, and the step is told `@ai-sdk/anthropic` on
`ANTHROPIC_API_KEY` with `providerOptions.anthropic.effort`, or
`@ai-sdk/openai`'s Responses model on `OPENAI_API_KEY` with
`providerOptions.openai.reasoningEffort`, with the context window the
catalog lists for the model (`CatalogModel.contextWindow`) or a fallback
where it lists none. Each step also asks for its reasoning in words, so the
agent's and each worker's tab show it as the Work tab shows Luke's:
`reasoningSummary: "auto"` on OpenAI, as the planning brain asks, and
adaptive thinking with `display: "summarized"` on a Claude 5 model, which
thinks whether asked or not. An older Claude is not asked, since the ask
would start it thinking. Nothing goes through AI Gateway.

The key a step runs on is read at every step too
(`src/agents/coder-host/account-keys.ts`): the account's own key for the provider where
it saved one (above, "Accounts' own provider keys"), opened from its row,
and Luke's own `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` only where it saved
none. A row the deployment's ring cannot open, or a deployment holding no
ring, refuses the step with `ACCOUNT_KEY_UNREADABLE` rather than run it on
Luke's key, so nothing the account meant to pay for is quietly billed to
Luke. A step on the account's key goes through a middleware that keeps the
row's status as the provider answers: a 401 marks it `invalid`, OpenAI's
429 `insufficient_quota` or Anthropic's "credit balance" refusal marks it
`quota_exceeded`, and a call that goes through marks it `verified` again,
each written only where the row still holds the key the step ran on. The
first two fail the step with `ACCOUNT_KEY_REFUSED` or
`ACCOUNT_KEY_NO_QUOTA` in place of the provider's own error, and the three
refusals read as the agent's failure `provider_key`, which the desktop
words as a key to replace in Settings. An agent's title stays on Luke's
Anthropic key. Reading the row every
step means a later change to it is the next step's model.

The sandbox (`apps/web/coder/sandbox.ts`) is one Vercel Sandbox per session at the
platform's 24-hour maximum timeout, prepared with the code extension's
tooling (`gh`, signed commits, TypeScript diagnostics), pnpm, and Python
beside the image's Node and git. As it opens, the agent's repository is
checked out whole at its default branch through the same firewall-scoped
clone the planning checkout makes (`repository-shell.ts`'s
`cloneRepository`), on a token `repositoryWriteToken` mints for that one
repository with contents and pull requests write, plus checks, statuses, and
Actions read where the installation has granted the App those
(`CI_READ_PERMISSIONS`; a mint naming a permission the installation never
granted fails whole, so they are asked only where granted), and the token is
then set at the firewall for the session's own `gh` and `git` through eve's
`authenticateGitHub`; it never enters the sandbox's filesystem or
environment. The session's instructions say whether that read was granted
(`host.prompt`, through `repositoryCiReadable`): where it was, the agent
watches its pull request's checks with `gh pr checks` and fixes what fails
for at most `CODER.CI_FIX_ROUNDS` rounds; where it was not, it says CI was
not watched. A token lasts an hour, so the store hook renews it at the
firewall on the first step past `CODER.GITHUB_TOKEN_REFRESH`.

The store hook (`apps/web/coder/hooks/store.ts`) relays every event into the store
through the relay the planning brain shares (`src/agents/brain-host/relay.ts`), composed
with no ask record, so an agent's turns land as `turns` rows naming its
model and effort and its `messages` rows as `UIMessage`s; it also stops the
sandbox the moment a turn ends, completed, failed, or cancelled, where a
sandbox tool ran in the session. The instructions (`src/agents/coder-host/instructions.ts`)
tell the agent to read `AGENTS.md` and `CLAUDE.md` first, reread the code the
plan names and say where it no longer fits, run the repository's checks,
work on a `luke/<slug>` branch and never push the default branch, and decide
on a pull request and its draft state itself; the plan is the session's
first message, or for an agent started on a developer's task, the task is,
the agent is never handed the plan, and the instructions are worded for a
task in the plan's place. The service needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`,
`DATABASE_URL`, the GitHub App's variables, and the Vercel Sandbox
credentials its build prewarms under; `LUKE_CODER_MODEL_FIXTURE=scripted`
selects the scripted model for `apps/web/coder/evals/coder.eval.ts`, which
`pnpm --filter @luke/web test:agent` runs beside the planning eval and which
runs a turn under the scripted model with no tool call, so no sandbox opens,
and a second turn that delegates to the worker, whose only call is the
delegation, so no sandbox opens there either.

## The turn event projection

`src/agents/turn-events.ts`'s `projectTurnEvents` is what the voice's live
brain hears of a turn while it runs, in process (above). Nothing is stored for
it: the five events — a slow step began, a planning turn queued a question,
every action settled, one sentence of the reply, the turn ended — are a
projection over the turn row and the turn's journal, the assistant message the
store writer opens under the turn's id and amends as each call is written
ahead of its run, read again on every poll, and the projection only grows
while the turn runs, so each event keeps the number it was first told under
and a reader that has heard some hears the rest and the end exactly once.

## The account group

`src/accounts/account-app.ts` is the account route group: the signed-in desktop's
own delete, preferences, and plan template endpoints, described as routes of the group's own
rather than carried as a passthrough, because each answers from this
deployment's own database and none owns a contract of its own the way Better Auth does.
Each endpoint resolves the bearer against the deployment's own account store
before touching anything — root AGENTS.md pins that no credential or account
secret ever travels in an answer — and answers only the boolean or the
snapshot the caller's own account carries. `src/accounts/account-seams.ts` is
the one place that hands the group a real user table and a real preferences
store, so `api/account/delete.ts`, `preferences.ts`, and `plan-template.ts` build
the same group from the same wiring; the reads and the writes themselves are
`packages/database/src/models/account-store.ts`'s effects over the ambient `SqlClient`,
handed to the group as the effects they are rather than run at the seam, and
that store names no database and reaches no auth session, so `apps/web/tests/hosted-account-store.test.ts`
exercises the erasure's cascade and the snapshot's replacement against a real
dialect; the analytics erasure key and project are
read from `HostedEnvironment` instead, the way the hosted tier's own key is,
and the erasure call itself runs over the ambient
`HttpClient` rather than an injected transport, so nothing in `AccountAppSeams`
carries one — a test provides its own fake `HttpClient` layer instead.

The preferences snapshot carries three parts. `preferences` is the settings
snapshot the desktop syncs, replaced whole by a write that names it.
`codingAgent` is the account's default model and effort for a coding agent —
what a click on Start runs on — as `{ model, effort }` in AI Gateway's catalog
spelling, `anthropic/claude-opus-5.5` at `high` until the account chooses,
with `contextWindow: "standard"` beside them where the smaller context window
of a model offering two was chosen (absent is the model's whole window).
Settings › Coding agents and the Start menu's chevron both write it, as one
value rather than two that could disagree. A PUT carries either part or both;
a part left out stands as it was, so the desktop's settings sync never
resets the chosen model and the Start menu never touches the voice. A
`codingAgent` write is accepted only as the instance's model catalog accepts
it (below): a model it does not offer or an effort that model does not list
is `invalid-request`, and a catalog the instance cannot read is `unavailable`.
The store keeps the columns beside `voice` on `account_preference`, and
reads a half-written pair as the default; `coding_agent_context_window` is
null for the model's whole window (migration 0077). `updated_at` is the preferences
part's own instant, nullable since migration 0062 and left null by a write
that carries only `codingAgent`: the desktop reads the answer's `updatedAt`
as a snapshot to apply over its own settings, so a row a choice alone opened
must answer none, or a Mac that never synced would take an empty snapshot
over the voice it holds.

`experiments` is the third part: each experiment the account turned on or
back off in Settings › Experimental, keyed by `@luke/settings`'s
`EXPERIMENT`, as `{ "factory": true }`, and `{}` until it chooses one. It is
the server's to hold rather than the desktop's to sync: a write is a patch
whose keys are merged over what stood (`jsonb ||` on the `experiments`
column), so a Mac that knows fewer experiments never erases another's
choice, and it never moves `updated_at`. Both directions read it
tolerantly (`experimentChoicesFrom`): a key this deployment does not list
is passed over rather than refused, because it is an older or newer build's
experiment, and only a value that is not a record at all is
`invalid-request`.

The plan template is the group's third path, `/api/account/plan-template`:
`GET` answers `{ template, custom }`, the account's own Markdown or
`DEFAULT_PLAN_TEMPLATE` with `custom: false`, and `PUT { template }` keeps a
string verbatim (untrimmed, empty allowed, at most 20,000 characters) or goes
back to the default on null (`@luke/features/plan-document-template`). It is
a path of its own rather than a third part of the snapshot, because the
desktop syncs the snapshot over its own settings and a long text does not
belong in that loop. It lives in `account_preference.plan_template`
(migration 0087), and a write sets that column alone: `updated_at` stays
the preferences part's own, so a row a template opened answers no snapshot.
`src/accounts/account-plan-template.test.ts` answers the path over a real dialect.

## The coding-agent routes

`src/agents/coding-agents-app.ts` is the group the desktop starts, lists,
reads, messages, re-models, and stops a plan's agents through. An agent
belongs to its plan's workspace: every route reads it through the plan's
membership gate (`coding-agent-store.ts`), so any member lists, reads,
messages, renames, re-models, and stops an agent a teammate started, while
its conversation stays its starter's, the row's `userId`, under which its
turns and lines are read and written, and its Start's retry key stays the
starter's own; `packages/features/src/coding-agent-wire.ts`
declares every request and answer, and `service-paths.ts` the addresses.
`POST /api/plans/{id}/agents` takes `{ idempotencyKey, model?, effort?, task? }`:
both of the choice or neither, the account's default (`/api/account/preferences`)
where neither, checked against the catalog with `acceptedModelChoice`, which
also refuses a stored default that has since left the catalog. It refuses a
plan with no repository (`no-repository`, 409) and one the installation of
the plan's workspace no longer reaches, read at the start rather than when
the plan named it (`repository-not-reachable`, 403;
`src/github/workspace-repository.ts`), snapshots the
plan's document as the Markdown Copy puts on the clipboard
(`@luke/features/plan-markdown`), makes the agent and its conversation
(`createCodingAgent`), and opens the eve session under the developer's own
bearer with the snapshot as the first message of a typed turn. A Start
naming a task, the developer's own words bounded as a message is, opens the
session with the task as that first message instead: the agent is never
handed the plan, its row keeps the task and no snapshot, and it still works
in the plan's repository under the same checks; an eve that
did not take it discards the agent again (`discardCodingAgent`) and answers
`unavailable`, so a retry starts afresh. A retry under the same key answers
the agent the first Start made, 200 rather than 201, and opens nothing. A
Start that named a model writes it as the account's default.

`GET /api/plans/{id}/agents` answers each agent's id, model, effort, start
instant, status, `brief` (`plan` or `task`, what it was handed first, so its
tab draws a plan as the plan's card and a task as the developer's message),
and `turnId`, the newest turn the status is read from
(null before the first), so a reader keying an agent's run by agent and
turn sees the run a message opens as its own (`src/agents/coder-host/status.ts`):
`starting` before one, `running`, `completed`, `failed`, or `cancelled`,
with a running turn carrying a Stop stamp reading as cancelled already, an
agent still without a turn row five minutes after its Start
(`CODER.STARTING_GRACE`) reading as failed rather than starting forever,
and an agent with a message of the developer's still awaiting its turn
(`awaitingLinesOf`) reading as running whatever its newest turn says.
`GET /api/agents/{id}/messages?after=<seq>:<revision>` answers the
conversation's rows past the cursor as `UIMessage`s, the cursor to read on
from, the agent's status as the page was read, and, where that status is
`failed`, `failureReason` as one of the wire's fixed words (`model`,
`sandbox`, `github`, `abandoned`, `other`), mapped by
`src/agents/coder-host/status.ts`'s `codingAgentFailureOf` from the turn row's failure
word and the host's own refusal sentences in its detail, so nothing eve or
a provider said reaches the desktop
(`src/agents/coder-host/transcript.ts`): a row is new past a cursor when its sequence
is higher or it was amended in place at a later journal revision, which is
how a turn's journal is heard again as it grows; a read with nothing new is
held open while the agent is starting or its newest turn runs, looked at
every half second and let go at twenty seconds, so the desktop's loop of
held reads ends on the page whose status says the agent ended and a tab on
a starting agent costs one held read per hold; an agent that has ended
answers at once.
`POST /api/agents/{id}/messages` takes `{ text, clientKey }`, the words
trimmed and at most `CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS` long
(`message-too-long`, 400, past that) and the client's own key for the send,
at most `MAX_KEY_CHARS` long. The message steers the turn under way, which
is the coder channel's own policy (`src/agents/coder-host/channel.ts`): the model sees
it at its next step, and a call still generating is cut short and run again
with it; an idle agent opens a new turn on it. Nothing is handed to eve to
hold for later, because eve can neither withdraw nor edit a message once it
queues one. The route first reads whether a line already stands under the
key (`sentLineStands`, by the `messages` row's `client_id`, which is
`sentLineId(clientKey)`), and answers the agent as it stands with nothing
sent again where one does, which is what makes a send repeated after a lost
answer safe; then confirms the plan's workspace still reaches the repository
(`repository-not-reachable`, as a Start does),
hands the words to the agent's eve session under the developer's own
bearer inside the conversation's lock (`writeAwaitingLine`, which reads the
key again under the lock so two sends racing under one key send once), and
writes them as a user row with no turn yet once eve has taken them, so the
transcript shows the line at once and the turn eve opens on it finds the
row standing when its own first write takes the lock; the relay's receipt
of the line (`message.received`) takes the oldest turnless row with those
words into the turn in place, bumping its revision (`takeAwaitingLine`),
rather than writing it again. An agent whose session has not claimed the
conversation, or whose session eve answers is still coming up past the
client's twenty-second loop, is `agent-not-ready` (409, tried again); a
session eve no longer runs is `agent-retired` (409), since the agent's
sandbox lives with its session; any other answer is `unavailable`, and none
of them leaves a row behind.
`GET /api/agents/{id}/subagents/{callId}/messages?after=` reads a worker's
transcript the same way, under the agent and eve's id for the `delegate`
call that started it, which the call's tool part carries as `toolCallId`:
the child conversation is `childConversationId` of the two, and only a
delegation recorded under an agent the account reaches answers, so an agent
of a workspace the account is not in, or a call that made no delegation, is
`not-found`.
`PATCH /api/agents/{id}` takes `{ model, effort }`, checked against the
catalog exactly as a Start checks its own, and writes the choice on the
agent's row (`updateCodingAgentChoice`), answering the agent's summary with
it; the coder agent reads the row at every step (`apps/web/coder/agent.ts`'s
`defineDynamic`, through `src/agents/coder-host/host.ts`'s `model`), so a change
mid-turn is the next step's and an idle agent's next turn takes it. It
refuses an agent of a workspace the account is not in as not found and a model or effort the
catalog does not offer as `invalid-request`, and leaves the account's
default as it was.
`POST /api/agents/{id}/stop` is eve's cancel of the turn under way, named by
eve's own id on the row, then the row's stamp; the service's hook stops the
sandbox as the cancelled turn ends, and anything the agent pushed stays.
`GET /api/agents/{id}/pull-request` answers what the agent published
(`src/agents/coder-host/published.ts`): the repository, the branch it pushed, and the
pull request from it with its state (`open`, `draft`, `merged`, `closed`),
its checks as one word (`pending`, `passing`, `failing`, `none`), and its
additions, deletions, and changed files; null for a branch or a pull
request it has not. The agent reaches GitHub through `git` and `gh` in its
shell alone, and the branch its sandbox stands on as a turn ends is the one
its pull request is on, whatever it cut, switched, or deleted on the way:
the service's hook (`apps/web/coder/hooks/store.ts`) runs `git branch
--show-current` in the checkout as each turn ends and writes the answer on
the agent's row (`coding_agent.branch`, through `src/agents/coder-host/host.ts`'s
`recordBranch`), null for a detached HEAD, ahead of relaying the end (a
tab reads the pull request the moment it hears the agent ended, and the
answer is then kept a while) and before it stops the sandbox; a read that
fails is logged and the sandbox stops regardless, and a turn that opened
no sandbox writes nothing. A row with no branch published nothing, and
GitHub is not asked; a row still on the repository's default branch, as
an agent that only read leaves it, published nothing either. GitHub then says what stands, once the
installation of the plan's workspace is confirmed to reach the repository as
a Start confirms it (`repository-not-reachable`, 403, otherwise), on a token
the App mints for that repository with pull requests read
(`src/github/pull-requests.ts`): the newest pull
request from the branch, else whether the branch was pushed at all, with
the head's check runs and commit statuses read together for the one word,
and a head whose checks the App may not read reading as `none` with a
warning rather than failing the answer. Every answer read is written on the
agent's row (`coding_agent.published`, the pull request or null), which is
what the plan list's `agents` reads. The answer is kept
per agent for `CODER.PUBLISHED_TTL` (thirty seconds) in an Effect `Cache`
built once with the routes, under a key that says whether the agent had
ended, so the first read after a turn ends is fresh rather than the running
turn's kept answer; a failed read is kept for no time. A tab reading beside
every held page thus asks GitHub a few times a minute at most.
`GET /api/agents/{id}/changes` answers the agent's changes for its Changes
tab: the files of the pull request that kept answer names, with its page,
read from GitHub's `pulls/{n}/files` afresh on each ask on that same token
(`src/github/pull-requests.ts`), a hundred to a page up to
`CHANGES_BOUNDS.MAX_FILES`, each with its path, the path it moved from,
what became of it, its lines added and removed, and its patch; a file
GitHub sends no patch for, or whose patch runs past
`CHANGES_BOUNDS.MAX_PATCH_CHARS`, says `binary` or `too-large` instead of
reading as unchanged, a file only moved carries an empty patch, and a
list cut at the bound says so. An agent with no pull request yet answers
a null one. The agent's sandbox is no source: nothing outside its session
reaches it and its diff is not kept in the store.
`apps/web/tests/coding-agents-app.test.ts` answers the routes over a fake eve, a
scripted GitHub, a fixed catalog, and PGlite; `apps/web/tests/coder-host.test.ts`
drives the host, the shared relay, the branch recorded at a turn's end
over the sandbox double, and the held read on the test clock;
`src/agents/coder-host/checkout.test.ts` holds the checkout over the sandbox
double, reading every run for the token and never finding it.

## Automations

An automation is an account's saved coding-agent Start on one of its plans,
fired by a trigger (`docs/proposals/automations-research.md` is the
research and the plan behind it). The account, the plan, the trigger, the
action, and the guards are an `automation` row
(`packages/database/src/schemas/automation.ts`), the trigger, the action,
and the guards as `@luke/features/automation-wire`'s own JSON; every
firing is an `automation_run` row, kept whatever came of it, under a
dedupe key unique per automation, so the same firing claimed twice is one
run. The store is `packages/database/src/models/automation-store.ts`: an
automation is made only on a plan the account reaches, and every other
statement an account makes names it.

A schedule is five-field cron read in an IANA zone
(`@luke/features/automation-schedule`), so nine o'clock stays nine o'clock
in that zone across a daylight-saving change; one that would fire more
often than every fifteen minutes is refused. Its next due instant is the
row's `next_run_at`, which the minute sweep claims by
(`src/automations/automation-sweep.ts`): in one transaction it locks the enabled
rows due, skipping any another claim holds, writes each one's next instant,
and records a queued run under the due instant. Vercel's cron may call the
same minute twice; the second claim finds the row moved on or locked, and
a claim that still read it at its old instant records nothing past the
unique key. A schedule due more than an hour ago, the cron down or a
deploy between, is moved on without a run, so a backlog is never replayed.

A queued run is acted on by `src/automations/automation-runs.ts`, one automation's
runs one after another so each run's guards read what the one before
settled; a run still queued two hours after it fired, an hour past the
last sweep that would act on it, is settled as `missed`, which no failure
count reads.
Its guards come first: a run whose automation was paused after it was
queued is skipped as `paused` (the owner's own "Run now" still runs), and
a run past the daily cap (runs started in the last twenty-four
hours) or past the concurrency guard (agents its runs started still
starting or running, read as each agent's tab reads it) is skipped, never
queued. Then it is a Start with a task, on the one path a Start takes
(`src/agents/coder-host/start.ts`): the plan, its repository, the owner's reach of it
through the App, and the model are checked as for the developer's own
Start, the agent runs as the owner on the owner's keys, and eve is reached
as the deployment acting for the owner under `CRON_SECRET`, the opening the
coder channel already admits for the voice brain. The task is the
automation's prompt with a closing line naming the automation and why it
fired. The run's id is the Start's key, so a run two sweeps both act on
starts one agent, and a named model does not become the account's default.
A refused start is a failed run with one fixed word
(`AUTOMATION_RUN_REASON`), and nothing pauses an automation for failing:
the next firing tries again. A `paused_reason` an older build wrote still
reads, and a resume clears it. The agent's
questions reach the Inbox and its end the finished-agent notification as
any agent's do.

The guards are read, and the run claimed, under the automation's row lock
(`withAutomationLocked`), so two acts on one automation's runs, a sweep and
a "Run now" in another function among them, never both read room for one
more agent: a claimed run stands started with no agent yet, which the next
act's concurrency counts, and takes its agent once the start answers, or
fails with the start's refusal. A claim left without its agent for ten
minutes, its function gone, is settled by the sweep as the agent its key
made where one stands, and failed as `unavailable` where none does.

The routes are `src/automations/automations-app.ts`, under the account bearer, every
row gated by the store on the account owning the automation and still
reaching its plan, so another account's automation, or one on a plan of a
workspace the account left, is `not-found`:

- `GET /api/automations` answers the account's automations newest first,
  or one plan's under `?planId=`, each with its newest run;
  `POST /api/automations` makes one (`201`). A schedule that does not
  read (five-field cron, a known zone, no more often than every fifteen
  minutes), a model the catalog does not offer the account, or a key the
  frame does not name is `invalid-request`; a plan with no repository is
  `no-repository`. A webhook trigger's secret is minted here, answered
  once as `webhookSecret`, and kept only as its SHA-256.
- `GET`, `PATCH`, and `DELETE /api/automations/{id}` read, change, and
  delete one. A resume, or a new trigger, computes a schedule's next due
  instant afresh, a pause clears it, and a resume clears any reason an
  older build paused it for.
- `POST /api/automations/{id}/run` takes `{ idempotencyKey }`, records a
  manual firing under it, and acts on it at once through the same guards
  and start a scheduled run takes, reaching eve as the developer under the
  request's own bearer; `201` with the run, or `200` with the run the same
  key made before, starting nothing again.
- `GET /api/automations/{id}/runs` answers its runs newest first, fifty at
  most, each with its agent's title and status as the agent's tab reads
  them.

`@luke/features/automation-wire` declares every body and `service-paths.ts`
the addresses; `src/automations/automations-app.test.ts` holds the routes over a fake
eve, a scripted GitHub, a fixed catalog, and PGlite.

A GitHub trigger fires on the Luke App's own webhook
(`src/github/github-webhook-app.ts`, through `src/automations/automation-github.ts`): a
pull request opened or labelled, an issue opened or labelled, a check suite
that completed as `failure` or `timed_out`, and a push to a branch, each in
the repository of the automation's plan (matched the way GitHub folds a
name's case), filtered by the trigger's labels (the label just applied, or
any label of what was opened) and branches (a pull request's base, a check
suite's or a push's branch). Only the repository, the number, title, and
address of the issue or pull request, the branch, and a failed check's
commit by its address are read; never a body. A run whose plan has moved to
another repository by the time the sweep acts on it is skipped as
`repository-changed`. A run is queued under the delivery's `X-GitHub-Delivery`, which a
redelivery carries again, so each automation records one run per
delivery, and the sweep starts its agent within the minute rather than
inside GitHub's ten seconds. An automation cannot fire itself: a pull
request, issue, or push whose sender is a bot, the App's own installation
token among them, fires nothing, and neither does a failed check on a
`luke/` branch, where a coding agent works and already watches its checks.
The agent is handed the event by number, address, and branch, its title
fenced as the event's own text to read as data, its angle brackets spelled
as entities so it cannot close the fence, and reads the rest with `gh`. The App must subscribe to the Issues and Push events beside the pull
request and check events it already reads, a setting of the App on GitHub
rather than of this repository; until it does, those two triggers never
fire.
