# @luke/service

The hosted service's logic: what the web deployment's functions and its two eve
services (`apps/luke`, `apps/dev`) compose and run. The deployment
keeps only its shell in `apps/web/server` — the Vercel function entries under
`routes/`, the runtime edge `runtime.ts`, the function layout and bundling, and
the voice function's edge — and reaches everything else here.

The package has no barrel. Each module is its own subpath, as
`@luke/database`'s are (`@luke/service/http/http-effect`), and test builders
stand at `@luke/service/testing/<name>`. A module lives in the folder of the
domain it belongs to (`auth/`, `github/`, `tasks/`, `agents/`, `voice/`, …),
named by the group of this README that describes it.

`src/core.ts` is the package's own door to the workspace packages it builds on,
and it has no subpath: a consumer outside the package names the defining
package.

`src/run.ts` names the runners the deployment's edge hands a module
(`WebStoreRun`, `WebAgentRun`), so a module never imports the edge itself.

## The auth group

`src/auth/auth-app.ts` is the auth route group: Better Auth's own `fetch`
handler on the path set the root `vercel.json` routes here, and the hosted
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

A workspace's repositories are those of the installations of the App
connected to it (`src/github/github-installations.ts`), one per GitHub
account, and nothing else: nobody's own GitHub account is asked what it
reaches, so a member who never signed in with GitHub reads, plans, and starts
agents on the workspace's repositories all the same, and a workspace with
nothing connected has none. `workspaceRepositories(organizationId)` reads
every installation the workspace holds from GitHub, mending each stored
status, skips one GitHub no longer knows or its account suspended, mints a
token for each listing alone (`metadata: read`), and pages `GET
/installation/repositories` a hundred at a time until a page comes back
short; the listings are one list, most recently updated first, each
repository once however GitHub cases its name. One listing GitHub does not
answer, or is still answering full pages of at the bound (`PAGING`, fifty
pages), fails the whole read as unavailable or unreadable rather than
answering the rest; none where no installation is running.
`workspaceRepository(organizationId, "owner/name")` is the check a task's
repository passes before it is kept: only the workspace's own installation
on the owner can reach it, found by its stored login first and then by
GitHub's own reading of the rest, so the listing is paged only
for that one and only as far as the page the repository is on, the name is
matched the way GitHub folds case, and what is answered is the full name as
GitHub spells it. `repositoryReadToken(organizationId, "owner/name")` is the
same check followed by the one token the App mints for that repository:
naming it alone and `contents: read`, answered sealed beside the repository
as GitHub spells it, or none where the installation does not reach it. It is
what the checkout in Luke's sandbox reads through
(`src/agents/repository-shell.ts`), and the File tab, the tree, and the skills
beside it. `repositoryPullRequestToken` adds `pull_requests: read` and
`repositoryWriteToken` cuts contents and pull requests write, each with CI
read beside it where the installation grants it; `appBot(token)` reads the
App's bot user (`GET /users/<slug>[bot]`) on a token already minted, which
is who a coding agent's commits are by. A task's repository is reached
through its task's workspace, read afresh at each use, so an installation
suspended, removed, or reinstalled decides the very next read.

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
`GET /api/github/repositories/tree` and `GET /api/github/repositories/skills`
read one repository of that installation for a place no task names, such as
an agent an automation started: the `workspaceId` and `repository` queries
name it, each exactly once, and the answer is a task's own tree or skills
read (`src/plans/plan-tree.ts`, `src/plans/plan-skills.ts`), through the
same reach, to a member of the workspace; a repository the installation does
not reach is refused as `not-reachable`, as a task's is.
`GET /api/github/repositories/pull-request` reads one pull request of such a
repository by the `number` query beside those two, for a link to it to draw:
its number, title, page, and state (`src/github/pull-requests.ts`), on a
token minted for that one repository; a repository the installation does not
reach and a number it holds no pull request under both answer
`{ pullRequest: null }`.
`GET /api/github/repositories/issue` reads one issue the same way
(`src/github/issues.ts`), its state `open`, `closed`, or `not-planned`, on a
token minted for that one repository with `issues: read` alone; an
installation that does not grant the App issues mints nothing and answers
`{ issue: null }`, as an unreached repository, a pull request's number, a
missing number, and a repository with its issues turned off do.
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
installation linked to the workspace, beside any it holds (`connected`), in
a transaction that reads the account's role again with its member row held,
because GitHub's authorization ran in between (`expired` where it is no
longer an owner or admin); a retry of an installation already linked there
is `connected` again and changes nothing but its names; one whose GitHub
account already stands for another workspace is `already-connected` and
stays where it is.

GitHub's "Request user authorization (OAuth) during installation" stays off:
it disables the Setup URL and returns the code to the App's first callback
URL, the sign-in's, and GitHub's docs say to run the full web flow with
`redirect_uri` to choose the callback instead. So the App lists
`https://tryluke.dev/api/github/installed/authorized` among its callback
URLs, beside the sign-in's.

The page draws a fixed card per status and interpolates nothing the address
brought it; the desktop's repository chip picks the installation up by
reading the workspace's repositories again when the window next takes focus
(`apps/desktop/src/renderer/tasks/repository-chip.tsx`).

The App's webhook is `POST /api/github/webhook` (`src/github/github-webhook-app.ts`),
which keeps what a coding agent published current on the agent's row
(`coding_agent.published`) for the task list while nobody has the agent's tab
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
task's workspace installation through `agentPublished`, as the agent's tab
reads it, which writes the row.
A redelivery reads the same again. GitHub's `ping` and any other event are
answered and ignored. An `installation` delivery, which GitHub sends every
App unsubscribed, moves the status of its workspace's `github_installation`
row: `deleted` to deleted, `suspend` to suspended, `unsuspend` back to active;
`GET /api/workspaces` then carries that workspace's `github.active` as false,
its tasks stay reachable, and nothing is deleted. A `github_app_authorization`
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

Every caller yields it. `resolveHostedUserId`, which the account and tasks
groups are handed as their `resolveUserId`, and the voice function's own
resolver are Effect-shaped, so each reads the bearer on its own fiber instead
of wrapping a promise in `Effect.promise`. One caller is a
promise of somebody else's: eve's `AuthFn`, which
`apps/luke/channels/eve.ts` satisfies by running the resolution once at
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
up to fifty words the desktop expects to hear (the repository, the task's
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
`ModelCatalog` service `src/runtime.ts`'s layer builds once per instance, cached
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

Every agent Luke runs — his own brain, the coding agent, and each
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
whatever URL a client later opens it at (https://executor.sh/docs/mcp). A connection belongs to the account, so it reaches every task and
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

**More than one account at a provider.** A Luke account may hold more than
one account at a provider (two Notion workspaces), each its own row and its
own grant. Connect keys a grant by connector and subject, so each row keeps
the subject it asks under (`connect_subject`): the Luke account's own user
id for the first account at a provider, as every ask was before a second
was possible, and a minted `luke_acct_…` id for another. Each row also keeps
the one name the account goes by everywhere (`connection_name`): the
provider's own for the first (`notion`), the provider and its place for
another (`notion-2`), minted once (`mintIntegrationConnectionName` in
`@luke/features/integration-wire`) and read back from the row after. That
name is the eve connection an agent reaches the account through, a coding
agent's switch and mention, and the routes' `connection` query, so every
name stored before a second account was possible keeps naming the first.
A row also keeps a `label`, the account's name at the provider where
Connect's grant carries one shaped like no credential, or the developer's
own; it is an identity at the provider, never a credential, answered to the
desktop and to no log line, span, counted event, or fixture. An account
that carries no label, one connected before labels were kept among them,
is read for one from its grant's fields at the next statuses read, once: a
grant that names nothing leaves an empty label, and the account is called
by its place ("Account 2"). No account at
a provider is primary: the agents are told each by its label, and to ask
which one where the developer has not said.
A provider offers more than one account where its catalog entry names a
`MULTIPLE_ACCOUNTS_VARIABLE` (Notion, Linear, Slack, Supabase, PostHog,
Executor), unless that variable (`NOTION_MULTIPLE_ACCOUNTS`, …) is `off`,
`false`, or `0`, which switches it back to one at once where a provider
turns out to revoke an earlier grant when a later one completes for the
same user and client; at most `INTEGRATION_ACCOUNTS_MAX` (five) per provider,
counting an account connected or expired and a sign-in still within its
window. A sign-in left past its window holds no place, and adding an account
lets it go, so its name is free again.
Deleting the Luke account reads every row's subject before the cascade and
revokes each.

**The routes** (`src/integrations/integrations-app.ts`). Every route about
one account reads it from a `connection` query beside the provider, and
without one means the provider's first account, so a desktop that predates
more than one sees exactly what it saw before:

- `GET /api/account/integrations` answers `{ integrations: { <provider>:
  status }, accounts?: [{ provider, connection, label?, status }],
  addable?: [provider], signInFailures?: [{ provider, connection?, reason,
  message? }] }`: each provider's first account's word, every account the
  Luke account holds but one whose first sign-in ended without a grant, the
  providers it may add another account at, and each failure; each
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
  `startAuthorization` for the account under its row's subject, with
  `/api/account/integrations/connected?state=…` as the callback, records the
  sign-in's one-time state and Connect's verifier, and answers the address
  and the account it signs in (`{ url, connection }`). With `add=true` it
  signs in a new account under a minted subject and the next free name,
  where the provider offers more than one and the account holds fewer than
  the most, refused as unavailable otherwise; Linear's asks for its
  documented `prompt=consent`. The desktop's host opens the address through
  the native node; no window draws it and nothing logs it.
- `POST /api/account/integrations/{provider}/rename` names the account a
  `connection` names, `{ label }` trimmed to between 1 and 64 characters,
  and answers `{ account }` as it then stands; one the account does not hold
  is `not-found`.
- `POST /api/account/integrations/{provider}/cancel` ends the sign-in under
  way and nothing else: a first sign-in's row goes, any other row keeps its
  status, and no grant is revoked, so a sign-in that completed just before
  the press stays connected. It answers `{ status }` as it then stands. The
  desktop's Cancel asks it, never a Disconnect.
- `POST /api/account/integrations/{provider}/disconnect` deletes the
  account's row first, then asks Connect to revoke its grant under that
  row's subject; every other account at the provider stands. A failed revoke is logged and
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
  for five minutes per account and connection. An account not connected is
  refused as unavailable before any token is read.
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
(`apps/web/server/function-rewrites.ts`), as a task's id is moved into `id`.

**The agents** (`src/integrations/integration-connection.ts`,
`src/agents/agent-runtime/connections.ts`). eve hands a declared subagent
none of its parent's connections, so each of the four agents registers one
`connections/integrations.ts`: a dynamic connection resolved as each turn
starts, which hands the turn every server its role's policy has on
(`src/agents/agent-runtime/servers.ts`), each the one definition over its provider and
that agent's own ownership check: the root's `admit`, or a worker's
`admitDelegated`. Each account the caller holds at a provider, standing
connected or expired, is handed as a connection of its own under its
connection name and keyed in eve by its own grant's subject, which its
token read is held to, so a name a later account takes never reaches it from
a turn handed the old one, and a provider with none is handed bare, so its first call says how to connect it. Where a
provider hands more than one account, each description gains one sentence
naming which account it is and the others, by their labels alone, each
quoted as a string, asking the agent to ask which account before a write
the developer has not pointed at one, and to say which it used; a
developer with one account per provider is told the same bytes as before.
A conversation whose workspace connected Linear for every member is handed
Linear once, bare, on the workspace's grant. Luke's brain and its worker are handed every integration; a coding
agent and its worker are handed every one the developer has not switched off
for that agent, the switches naming connections. The
definition's auth is eve's plain `getToken` form, credentialed as the app,
and the account is the admitted conversation's owner, never the session's
principal. That matters because a spoken turn runs as the
deployment acting for the account, and eve's user-scoped auth (`connect()`
from `@vercel/connect/eve`) would refuse it before reading any token. That
form has no interactive half either, so eve never pauses a run for a
sign-in. eve opens the client once per model step: the row is read at each
opening, and again after Connect answers, so a Disconnect takes effect from
the next step. A connection that cannot be used throws one of
`integrationUnavailable`'s fixed sentences, which fails only the call that
tried it; every other tool, and the run, carries on. Workers stay read-only
in the checkout and change an integration only when their subagent task explicitly
asks them to.

**Transcripts** (`src/integrations/connection-tools.ts`). eve offers a
connection through `connection_search` and `connection_execute`, and tells a
remote call as a call of its own nested under the `connection_execute` that
ran it, named `<connection>__<tool>` (`linear__list_issues`,
`notion-2__notion-fetch` for a second Notion account), with id
`<wrapper>:1`. The relay stores the nested call under the provider's fixed
name (`linear_remote` for Linear), whose input is `{ remoteTool,
parentCallId, input }` and, for an account past the provider's first, its
`connection`, and settles it with what the provider answered, before the
wrapper's own result. Both the names and that envelope are the wire's
(`@luke/features/integration-wire`'s `INTEGRATION_REMOTE_TOOL` and
`integrationRemoteCallSchema`), because the desktop draws the nested call as
the provider's tool, under the provider's mark, and leaves its wrapper's row
out. Every name
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
production, preview, and development. The web, `luke`, and `dev` are services of that
one project (the root `vercel.json`'s `services`), so its variables and the
connector's link reach all three, which matters because the agents read
tokens too. Asking Connect about an arbitrary user id needs the deployment's
own Vercel OIDC token, which the SDK reads from the request
(`x-vercel-oidc-token`) or `VERCEL_OIDC_TOKEN`. Keep OIDC enabled for the
project. For local development, `vercel env pull` writes a
short-lived `VERCEL_OIDC_TOKEN`. A deployment without a provider's variable
runs every agent without that provider, and neither Settings nor the
composer's MCP servers popover draws a row for it. Every token request is
billed by Connect and rate-limited per team.

**The workspace Linear connector.** A workspace's own Linear grant, which
the New plan picker lists issues through and a plan started from an issue
reads it through, is held on a connector of its own, named by
`LINEAR_WORKSPACE_CONNECTOR_UID`, set as the others are. The accounts'
Linear connector (`LINEAR_CONNECTOR_UID`) signs in through Linear's MCP
server (`mcp.linear.app`), whose tokens Linear's GraphQL API refuses with a
401. So the workspace's must be Connect's own Linear connector
(`vercel connect create linear`), whose Linear API OAuth tokens the GraphQL
API takes, and Linear's MCP server takes too, for the agents a workspace's
grant is handed to. Give it the `read` scope at least, and user subjects.
Without the variable, no workspace can connect Linear. Since Linear's MCP
server takes those tokens too, `LINEAR_CONNECTOR_UID` may name the same
connector, which keeps Luke one app in Linear; its Linear app must be public
for a workspace of any other Linear organization to sign in.

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

`apps/dev/` is the second standalone eve app, built and deployed as the `dev`
service beside `luke` on the same terms (the root `vercel.json`): its own
`package.json` (`@luke/coder`, whose one dependency is `eve`), a flat layout
eve resolves as an app root, and a build that prewarms its sandbox snapshot
under the same Vercel Sandbox credentials. It stands at eve's named mount:
the public route is `/eve/coder/v1/*`, which the deployment's first rewrite
carries into the service, whose own one `routes` entry turns it back into
`/eve/v1/*` with a `request.path` transform before eve's router reads it,
and whose build exports `EVE_PUBLIC_ROUTE_PREFIX=/eve/coder` so the callback
URLs eve mints resolve to the public path. The web functions reach it through
`src/agents/brain-host/eve-sessions.ts` with `mount: EVE_MOUNT.CODER`.
The package's name, unscoped, is the agent's name to eve, which names the
Workflow queue every deployment of the service consumes after it: a session
stays owned by the deployment it started on until a newer one's message wakes
it, so a renamed package strands every standing agent, whose next message
lands on a queue its owner never reads. The name stays `coder` whatever the
directory or service is called.
`apps/web/tests/vercel-services.test.ts` holds the three services, that routing,
and those names.

A coding agent is one eve session over a `coding_agent` conversation
(`packages/database/src/models/coding-agent-store.ts`), and the host behind the authored
files is `src/agents/coder-host/`: the same door and conversation
admission as the hosted brain's (`src/agents/brain-host/door.ts`,
`src/agents/brain-host/conversation.ts`), with the developer's own bearer the caller
the channel walks in for the desktop's routes (`src/agents/coder-host/channel.ts`): a
Start and a Stop come from a route still holding it, and a follow-up
steers; the deployment acting for the account is admitted for the two things
the voice brain does there on the developer's behalf, a typed opening that
starts an agent and a typed line that steers one, each minted as the
developer's own principal with the deployment named as its carrier. The agent (`apps/dev/agent.ts`) runs none of eve's default
tools and authors its own under `apps/dev/tools/`, which is exactly the set the
store writer registers (`src/agents/coder-host/tool-set.ts`): eve's `bash`, `read_file`,
`write_file`, and `glob`, the code extension's `apply_patch` and `grep` from
`apps/luke/extensions/code/tools`, Luke's own `search_web` and
`read_web_page` (`public-research.ts`: the search screened, cited, and
budgeted per turn on Luke's key and counted on the account's meter, the page
read refusing any address off the public internet), and two of Luke's own: `delegate`, the hand-off to a worker (below), and
`edit_plan` (`src/agents/coder-host/plan-edit.ts`), which takes the
notetaker's own notes (`@luke/features/plan-template`'s `planNotesSchema`)
into the agent's plan through the plan's one write (`plan-notes.ts`): an open
question the agent met with the assumption it goes on under, a fact it
corrected in the code, a decision it made. The save is journaled on the task's
row (`task.agent_edits`, the last fifty, the agent's id and its notes as
taken) and named from the agent's row at read time, so the window's "Updated
by" line and Luke's "recent edits by coding agents" say what the
row says now; the developer reads them on their next call while the
agent runs on, and a turn may take only so many notes. `edit_plan` and
`show_page` resolve at each turn's start (`tool-set.ts`'s `planToolsOf`):
an agent on no plan, as an automation's run starts one, is offered
neither, and one handed a prompt on a plan only `show_page`, so no agent is
offered a tool its every call would refuse.
Beside them stand
the agent tools Luke on a call is offered too, one implementation for both
(`src/agents/coding-agent-tools.ts`): `list_agents`, every other agent on
any task and by any member, each with its task, narrowed to one task or its
own where asked, archived ones marked; `read_agent`, one agent of the
workspace by its id, with what its branch published and a tail of its
transcript, each entry kept longer than Luke's, who summarises his aloud,
and as many entries as asked, to a bound; `message_agent`, which takes the
message box's own steer path under eve's id for the call, as the deployment
acting for the agent's starter, kept under the sending agent's name
(`MESSAGE_SENDER.AGENT`) and opening with who sent it, and which an archived
agent or one of another workspace refuses; `start_agent`, which starts
another on its own task, or on another task of its workspace by the
`taskId` that `list_tasks` answers, by the Start button's own path, telling
it which agent started it; `archive_agent` and `unarchive_agent`, which
archive an idle agent of the workspace, never itself or one still working,
on the rule the Archive agent menu keeps for the agent's starter, recording
the archiving agent and its reason on the archived agent's row
(`archived_by`), and bring one back; `read_page`, a page shown on any task
of the workspace by its id, its HTML cut on a line to a bound, which a
mention of a page points the agent at; `list_tasks`, the workspace's
open tasks; and `list_models`, the models and efforts the agent's starter may
start one on and their default, read from the one source a start is checked
against (`accountModelChoices` in `src/agents/coder-host/start.ts`), so a
choice it lists is one `start_agent` takes. A list, a read, or a start of an agent, a list of tasks,
`show_page`, and `read_page` answer each thing's mention ready to write, `[@name](link)` under
the workspace's slug (`src/agents/written-mentions.ts`), and the agent's
instructions show it the mention of every kind it names, under its own
task's link, so its replies, Inbox items, and plan notes draw them as chips.
A line from another coding agent hands the agent it reaches no MCP server it
mentions, since an agent's servers are its developer's to switch. The
extension itself is not mounted, since its `worker` subagent runs on an AI
Gateway model and its `gh` tool on Vercel Connect, and Luke runs neither.
`gh` and `git` run through the shell, authenticated at the firewall. The
session's input tokens are uncapped and compaction is eve's default.

The worker (`apps/dev/subagents/worker/`) is Luke's own declared subagent, in
the shape of Luke's own worker (`apps/luke/subagents/worker/`): read-only in the
agent's own sandbox and checkout, uncommitted edits included
(`defineParentSandbox`), authored exactly the agent's reads
(`WORKER_TOOL_NAMES`: `bash`, `read_file`, `glob`, `grep`, `search_web`,
`read_web_page`), told to change nothing, and uncapped in tokens, as the
agent it runs under is. It is declared
hidden (`tool: false`), because eve's own subagent tool carries a message
and nothing else, and the agent chooses each worker's model and effort: the
model sees `delegate` (`apps/dev/tools/delegate.ts`), a resumable subagent task
(`serve`, the shape eve gives every agent call) whose input is
`{ task, model?, effort?, background? }`. The call answers with eve's
receipt at once and the worker's answer reaches the agent as a subagent task's result,
so the turn stays open while it works; unless the agent sets `background`,
the tool's words have it call `task_wait` right after, which is a foreground
delegation in eve's terms, and a developer's message during the wait reaches
the agent at once without stopping the worker. Several calls in one step run
at once, and a call with the subagent task's id sends the worker more, into the same
session. Luke delegates through the same shape
(`apps/luke/tools/delegate.ts`, `PLANNER_DELEGATE_TOOL`), always in the background
and on its own model, its worker declared hidden too; the Work tab reads its
calls as worker calls under either name, eve's `worker` in earlier
transcripts (`BRAIN_DELEGATION_TOOLS`). A worker's row in an agent's tab
says where the worker's own session stands (the page's `subagents`), since
the call settles at the receipt.
Its step fills the pair in from the agent's own row, holds it to the same
catalog a Start is held to (`src/agents/coder-host/delegation.ts`, refusing with the
models offered or the named model's efforts, which the body throws so the
model reads it and tries again), opens the child conversation the call
names (`childConversationId(agent conversation, callId)`, as Luke's own
worker's is named) and writes the pair under it
(`coding_agent_delegation`, migration 0066); then the body opens the worker
through `ctx.agent("worker")`. eve hands a resolver no lineage, so the
worker's hook (`subagents/worker/hooks/store.ts`) pins the parent call's id
in the worker's own state as the session starts, the model resolver reads
it at every step and is told the recorded pair (`host.delegatedModel`), and
the hook relays the worker's stream into the child conversation as a child
turn naming that pair (`host.relayChild`). The subagent task's result names the pair
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
`reasoningSummary: "auto"` on OpenAI, as the hosted brain asks, and
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

The sandbox (`apps/dev/sandbox.ts`) is one Vercel Sandbox per session at the
platform's 24-hour maximum timeout, prepared with the code extension's
tooling (`gh`, signed commits, TypeScript diagnostics), pnpm, and Python
beside the image's Node and git. As it opens, the agent's repository is
checked out whole at its default branch through the same firewall-scoped
clone the hosted brain's checkout makes (`repository-shell.ts`'s
`cloneRepository`), on a token `repositoryWriteToken` mints for that one
repository with contents and pull requests write, plus checks, statuses, and
Actions read where the installation has granted the App those
(`CI_READ_PERMISSIONS`; a mint naming a permission the installation never
granted fails whole, so they are asked only where granted), and the token is
then set at the firewall for the session's own `gh` and `git` through eve's
`authenticateGitHub`; it never enters the sandbox's filesystem or
environment. Who the agent writes as is settled once, as its first session
starts, and kept on its row (`coder-host/checkout.ts`, `CODING_AGENT_AUTHOR`):
an agent a developer started writes as them where their GitHub sign-in may
push to the repository, its commits authored as their GitHub account and
ending on a `Co-authored-by` trailer naming the App's bot; an automation's
agent, and one whose developer has no GitHub sign-in or may not push, writes
as the App's bot. The agent opens its pull request with `open_pull_request`
(`coder-host/pull-request.ts`), which the service runs with the developer's
own GitHub App token where the agent writes as them, in one `POST
/repos/{owner}/{name}/pulls` on the agent's repository, and with the App's
token otherwise; where GitHub refuses the developer's token the App opens it
in their place and the row records why. No developer's token stands at the
firewall, because the sandbox is the workspace's: any member may steer the
agent or open a terminal in it. The session's instructions say whether the CI read was granted
(`host.prompt`, through `repositoryCiReadable`): where it was, the agent
watches its pull request's checks with `gh pr checks` and fixes what fails
for at most `CODER.CI_FIX_ROUNDS` rounds; where it was not, it says CI was
not watched. A token lasts an hour, so the store hook renews it at the
firewall on the first step past `CODER.GITHUB_TOKEN_REFRESH`.

The store hook (`apps/dev/hooks/store.ts`) relays every event into the store
through the relay the hosted brain shares (`src/agents/brain-host/relay.ts`), composed
with no ask record, so an agent's turns land as `turns` rows naming its
model and effort and its `messages` rows as `UIMessage`s; it also stops the
sandbox the moment a turn ends, completed, failed, or cancelled, where a
sandbox tool ran in the session. The instructions (`src/agents/coder-host/instructions.ts`)
tell the agent to read `AGENTS.md` and `CLAUDE.md` first, reread the code the
plan names and say where it no longer fits, run the repository's checks,
work on a `luke/<slug>` branch and never push the default branch, and decide
on a pull request and its draft state itself; the plan is the session's
first message, or for an agent started on a developer's prompt, the prompt is,
the agent is never handed the plan, and the instructions are worded for a
prompt in the plan's place. The service needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`,
`DATABASE_URL`, the GitHub App's variables, and the Vercel Sandbox
credentials its build prewarms under; `LUKE_CODER_MODEL_FIXTURE=scripted`
selects the scripted model for `apps/dev/evals/coder.eval.ts`, which
`pnpm --filter @luke/web test:agent` runs beside the brain's eval and which
runs a turn under the scripted model with no tool call, so no sandbox opens,
and a second turn that delegates to the worker, whose only call is the
delegation, so no sandbox opens there either.

## The turn event projection

`src/agents/turn-events.ts`'s `projectTurnEvents` is what the voice's live
brain hears of a turn while it runs, in process (above). Nothing is stored for
it: the five events — a slow step began, a turn queued a question,
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
reads, messages, re-models, and stops a task's agents through. An agent
belongs to its task's workspace: every route reads it through the task's
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
task with no repository (`no-repository`, 409) and one the installation of
the task's workspace no longer reaches, read at the start rather than when
the task named it (`repository-not-reachable`, 403;
`src/github/workspace-repository.ts`), snapshots the
task's plan as the Markdown Copy puts on the clipboard
(`@luke/features/plan-markdown`), with the Linear issue a plan was started
from after it (`linearIssueBrief`): the issue as a mention, a branch named
`luke/<key>-<slug>` and a `Fixes <key>` or `Part of <key>` line in the pull
request, by which Linear's own GitHub integration links the pull request and
moves the issue's status, and the issue's description fenced as data; then
makes the agent and its conversation
(`createCodingAgent`), and opens the eve session under the developer's own
bearer with the snapshot as the first message of a typed turn. A Start
naming a prompt (`task`), the developer's own words bounded as a message is, opens the
session with the prompt as that first message instead: the agent is never
handed the plan, its row keeps the prompt and no snapshot, and it still works
in the task's repository under the same checks; an eve that
did not take it discards the agent again (`discardCodingAgent`) and answers
`unavailable`, so a retry starts afresh. A retry under the same key answers
the agent the first Start made, 200 rather than 201, and opens nothing. A
Start that named a model writes it as the account's default.

`GET /api/plans/{id}/agents` answers each agent's id, model, effort, start
instant, status, `brief` (`plan` or `task`, what it was handed first, so its
tab draws a plan as the plan's card and a prompt as the developer's message),
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
answer safe; then confirms the task's workspace still reaches the repository
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
it; the coder agent reads the row at every step (`apps/dev/agent.ts`'s
`defineDynamic`, through `src/agents/coder-host/host.ts`'s `model`), so a change
mid-turn is the next step's and an idle agent's next turn takes it. It
refuses an agent of a workspace the account is not in as not found and a model or effort the
catalog does not offer as `invalid-request`, and leaves the account's
default as it was. The same PATCH taking `{ pinned }` pins the agent for the
asking member alone, or unpins it (`pinCodingAgent`): a pin is the account's
own row of `agent_pin`, as a task's is of `plan_pin`, kept from the first
pin's instant and gone with the agent or the account, and the plan list's
`planlessAgents` answer it as `pinnedAt` only where the reader holds one.
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
the service's hook (`apps/dev/hooks/store.ts`) runs `git branch
--show-current` in the checkout as each turn ends and writes the answer on
the agent's row (`coding_agent.branch`, through `src/agents/coder-host/host.ts`'s
`recordBranch`), null for a detached HEAD, ahead of relaying the end (a
tab reads the pull request the moment it hears the agent ended, and the
answer is then kept a while) and before it stops the sandbox; a read that
fails is logged and the sandbox stops regardless, and a turn that opened
no sandbox writes nothing. A row with no branch published nothing, and
GitHub is not asked; a row still on the repository's default branch, as
an agent that only read leaves it, published nothing either. GitHub then says what stands, once the
installation of the task's workspace is confirmed to reach the repository as
a Start confirms it (`repository-not-reachable`, 403, otherwise), on a token
the App mints for that repository with pull requests read
(`src/github/pull-requests.ts`): the newest pull
request from the branch, else whether the branch was pushed at all, with
the head's check runs and commit statuses read together for the one word,
and a head whose checks the App may not read reading as `none` with a
warning rather than failing the answer. Every answer read is written on the
agent's row (`coding_agent.published`, the pull request or null), which is
what the task list's `agents` reads. The answer is kept
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
`src/agents/coding-agents-app.test.ts` answers the routes over a fake eve, a
scripted GitHub, a fixed catalog, and PGlite; `src/agents/coder-host/coder-host.test.ts`
drives the host, the shared relay, the branch recorded at a turn's end
over the sandbox double, and the held read on the test clock;
`src/agents/coder-host/checkout.test.ts` holds the checkout over the sandbox
double, reading every run for the token and never finding it.

## Automations

An automation is an account's saved coding-agent Start on one of its tasks,
fired by a trigger (`docs/proposals/automations-research.md` is the
research and the plan behind it). The account, the task, the trigger, the
action, and the guards are an `automation` row
(`packages/database/src/schemas/automation.ts`), the trigger, the action,
and the guards as `@luke/features/automation-wire`'s own JSON; every
firing is an `automation_run` row, kept whatever came of it, under a
dedupe key unique per automation, so the same firing claimed twice is one
run. The store is `packages/database/src/models/automation-store.ts`: an
automation is made only on a task the account reaches, and every other
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
queued. Then it is a Start with a prompt, on the one path a Start takes
(`src/agents/coder-host/start.ts`): the task, its repository, the owner's reach of it
through the App, and the model are checked as for the developer's own
Start, the agent runs as the owner on the owner's keys, and eve is reached
as the deployment acting for the owner under `CRON_SECRET`, the opening the
coder channel already admits for the voice brain. The prompt is the
automation's own prompt with a closing line naming the automation and why it
fired. The run's id is the Start's key, so a run two sweeps both act on
starts one agent, and a named model does not become the account's default.
The MCP servers the action switches off (`disabledServers`) are switched off
for the run's new agent, as a Start's draft switches them off; every other
server the owner connected is handed to it. A server mentioned in the
automation's own prompt is handed to the run's first turn whatever its
switch says, as a Start's prompt hands it, and a run sent to the same agent
hands its next turn the same; a server mentioned in a webhook's body or a
GitHub event's title, words an outsider wrote, is handed to none.
A refused start is a failed run with one fixed word
(`AUTOMATION_RUN_REASON`), and nothing pauses an automation for failing:
the next firing tries again. The newest failed run of each of the owner's
automations in the last week rides the account's inbox read
(`GET /api/inbox`'s `failedRuns`, `src/agents/coder-host/inbox-page.ts`)
and moves its cursor, so the owner's desktop announces it as it fails and
marks Automations until that automation is opened; it is no inbox item. A
row an older build paused for its failures stands turned off, its reason's
column read no longer (and dropped by the release after), and the answer's
`pausedReason` is always null, kept for the desktops that read it. The agent's
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
reaching its task, so another account's automation, or one on a task of a
workspace the account left, is `not-found`:

- `GET /api/automations` answers the account's automations newest first,
  or one task's under `?planId=`, each with its newest run;
  `POST /api/automations` makes one (`201`). A schedule that does not
  read (five-field cron, a known zone, no more often than every fifteen
  minutes), a model the catalog does not offer the account, or a key the
  frame does not name is `invalid-request`; a task with no repository is
  `no-repository`. A webhook trigger's secret is minted here, answered
  once as `webhookSecret`, and kept only as its SHA-256.
- `GET`, `PATCH`, and `DELETE /api/automations/{id}` read, change, and
  delete one. A resume, or a new trigger, computes a schedule's next due
  instant afresh, a pause clears it, and a resume clears any reason an
  older build paused it for. `{ webhookSecretHash }` replaces a webhook
  trigger's secret with one the caller minted, by its SHA-256, so the
  caller holds the new secret before the one before stops admitting calls
  and the service never sees it; it is `invalid-request` for any other
  trigger.
- `POST /api/automations/{id}/run` takes `{ idempotencyKey }`, records a
  manual firing under it, and acts on it at once through the same guards
  and start a scheduled run takes, reaching eve as the developer under the
  request's own bearer; `201` with the run, or `200` with the run the same
  key made before, starting nothing again.
- `GET /api/automations/{id}/runs` answers its runs newest first, fifty at
  most, each with its agent's title and status as the agent's tab reads
  them.

A webhook trigger's address is `POST /api/automations/{id}/webhook`
(`src/automations/automation-webhook-app.ts`), called by whatever the
developer hands it to under the trigger's own secret rather than an account
bearer: the `Authorization: Bearer` value, never the address, whose query a
platform's request log keeps, hashed and compared in constant time against
the SHA-256 the row keeps. An id that names no webhook automation, one whose
owner left its workspace, and a secret that does not hold are all
`invalid-token`, so the address says nothing of what stands behind it. A
paused automation answers `200 { queued: 0 }` before its body is read, so a
sender does not retry;
otherwise the call is `202 { queued }`, the run recorded under the SHA-256 of
the caller's `Idempotency-Key` where it sends one. The body, UTF-8, at most
64 KiB, and holding no NUL, is kept on the run's `payload`, read only by the act that starts the
run, and handed to the agent fenced as the caller's own text, its angle
brackets spelled as entities, cut with a note where it would push the prompt
past its bound. The body reaches the run's agent task, transcript, and traces
by the carve-out in root `AGENTS.md`; nothing of it or the secret is logged.

`@luke/features/automation-wire` declares every body and `service-paths.ts`
the addresses; `src/automations/automations-app.test.ts` holds the routes over a fake
eve, a scripted GitHub, a fixed catalog, and PGlite.

A GitHub trigger fires on the Luke App's own webhook
(`src/github/github-webhook-app.ts`, through `src/automations/automation-github.ts`): a
pull request opened or labelled, a pull request ready for review opened,
reopened, marked ready, or pushed to (`pull-request-updated`; a draft fires
nothing until it is marked ready, and an opened pull request is both this and
`pull-request-opened`), an issue opened or labelled, a check suite that
completed as `failure` or `timed_out`, and a push to a branch, each in any of
the automation's repositories (or its task's, on a row an older build wrote,
matched the way GitHub folds a name's case), of an owner still a member of
the automation's workspace, filtered by the trigger's labels (the label just applied, or
any label of what was opened) and branches (a pull request's base, a check
suite's or a push's branch). Only the repository, the number, title, and
address of the issue or pull request, the branch, and a failed check's
commit by its address are read; never a body. The run's agent starts in the
repository the event named, as the automation spells it among its
repositories; a run whose automation no longer lists that repository by the
time the sweep acts on it is skipped as `repository-changed`. A run is queued under the delivery's `X-GitHub-Delivery`, which a
redelivery carries again, so each automation records one run per
delivery, and the sweep starts its agent within the minute rather than
inside GitHub's ten seconds. Each event is read with who sent it: Luke's
agents where the sender is the App's own bot (`<slug>[bot]`), another bot,
or a person; and, for a pull request, its moment (opened or reopened, marked
ready, pushed to), whether it is a draft, and whether it comes from a fork
(its head in another repository, or in none). The trigger's settings choose
among them (`senders`, `moments`, `drafts`, `forks` in
`@luke/features/automation-wire`): people's events alone, every moment, and
no draft or fork where it names none. An automation cannot fire itself
whatever its settings say: a push by Luke's agents, to a branch or to a pull
request, fires nothing, and neither does a failed check on a `luke/` branch,
where a coding agent works and already watches its checks.
The agent is handed the event by number, address, and branch, its title
fenced as the event's own text to read as data, its angle brackets spelled
as entities so it cannot close the fence, and reads the rest with `gh`. The App must subscribe to the Issues and Push events beside the pull
request and check events it already reads, a setting of the App on GitHub
rather than of this repository; until it does, those two triggers never
fire.

## The tasks group

`src/tasks/tasks-app.ts` is the Mac's Tasks tab's route group over the account's
named tasks (`docs/TASKS.md`): `GET /api/plans` lists them, newest
started first and the archived ones left out unless `?archived=include` asks
for them, so a build from before archiving never draws one, `POST /api/plans`
starts one with its name, the untouched
template as its document, and the repository it is about where one is
chosen, in the workspace its `workspaceId` names, which the account must be
a member of (`isWorkspaceMember`; one it is not in answers `not-found`), or
in the account's first workspace, ensured first, where it names none,
`GET /api/plans/{id}` opens one with its saved document,
`PATCH /api/plans/{id}` changes its name, its repository, whether it is
pinned, whether it is archived, the workspace it belongs to, or several at
once, an archive a stamp on the row (`archived_at`) and a pin the
account's own row of `plan_pin`, so one member's pin of a shared task is
theirs alone, answered as `archivedAt` and `pinnedAt` only where it stands;
a move
(`workspaceId`) is the task's owner's alone (`not-permitted` for a
teammate), into a workspace they are a member of (`not-found` otherwise)
whose installation reaches the task's repository, refused as a repository
change would be otherwise, and its coding agents go with it, and
`DELETE /api/plans/{id}` deletes it, its coding agents' rows going with it
and their conversations stamped deleted beside the task's own (`deleteTask`),
the id moved into
the query by the rewrite `apps/web/server/function-rewrites.ts` makes of every
segment-captured id.
Each row of the list carries `agents` where the task has a coding agent
(`src/agents/task-agents.ts`): how many it has and how many are starting
or running, the three it names (those at work first, then the newest), each
with its title, model, effort, status, since when, and the member who
started it while their account stands, and the pull requests they opened,
each number once and at most three, as GitHub last answered a read of them.
Four statements answer the whole list: the agents of every task listed with
`coding_agent.published` (migration 0078), their newest turns, the lines
awaiting a turn, and their starters' names; the list asks GitHub nothing.
`packages/features/src/task-wire.ts` declares every request and answer. Each
endpoint resolves the bearer first, and every statement in
`packages/database/src/models/task-store.ts` names the account beside the task and gates on
its membership of the task's workspace, so a teammate's task reads and
writes as the account's own, and a task of a workspace the account is not in
answers exactly as none does.

`src/github/repository-pins-app.ts` answers `/api/repository-pins`, the
repositories the account pinned in the sidebar, whose groups of tasks stand
above the rest: `GET` reads them newest pinned first, and `PUT` pins or
unpins one and answers them all as they then stand. A pin is a row of
`repository_pin` keyed by the account and the repository's full name
(`packages/database/src/models/repository-pin-store.ts`), stamped the first time it is made,
deleted when it is undone, bounded at fifty an account, and gone with the
account. It names the repository and nothing of it, so it asks GitHub
nothing. It is a path of its own rather than one under `/api/plans/`, whose
rewrite reads the next segment as a task's id.

`src/accounts/workspaces-app.ts` answers the account's workspaces
(`packages/features/src/workspace-wire.ts`). Membership has nothing to do with
GitHub: a teammate joins a workspace by invitation, and a workspace's
repositories come only from the Luke GitHub App installations an owner or
admin connects to it, one per GitHub account. Every request resolves the bearer first and ensures the
account's first workspace.

- `GET /api/workspaces` answers `{ workspaces }`, every workspace the account
  is a member of, its first one first and the rest by name, each
  `{ id, name, role, github: { login, active } | null, githubInstallations:
  [{ installationId, login, active }] }`: every installation the workspace
  holds, the first linked first, and `github` the first still active, else
  the first, or null,
  which is all a desktop from before several reads. It asks GitHub nothing.
- `POST /api/workspaces { name }` creates a workspace through the plugin's
  server-only `auth.api.createOrganization` (`body.userId`, no session
  headers; [docs](https://www.better-auth.com/docs/plugins/organization#create-an-organization)),
  so the caller is its owner, and answers `{ workspace }` (201). The slug is
  spelled from the name and never takes the `personal-` prefix a first
  workspace is made under; a slug the plugin
  refuses as taken is never adopted (`createLinkedOrganization`), and the
  workspace takes it with a random suffix.
- `POST /api/workspaces/github/connect { workspaceId }`, for an owner or admin,
  writes a `github_install_intent` row (the SHA-256 of a random state, the
  account, the workspace, an hour's expiry) and answers `{ url }`: the App's
  install address with that `state`. A member is `not-permitted` (403); a
  workspace the account is not in is `not-found`.
- `POST /api/workspaces/github/disconnect { workspaceId }`, which a desktop
  from before several installations still sends, is `not-permitted` (403) to
  every account and removes nothing: which installations and repositories a
  workspace holds is managed on GitHub, where an uninstall reaches the
  webhook, and the old press must not remove every installation at once.

A `github_installation` row (`packages/database/src/schemas/github-installation.ts`)
ties one installation to one workspace, keyed on GitHub's installation id and
account id (both unique), with the account's login and kind and the
installation's status, which the installation webhook keeps and a read of
GitHub mends. The connect's callback links it (above, under the install
group) in one statement keyed on the account: a new account's row is added
beside the workspace's others, the account's own row in the same workspace
takes a reinstall's new id and keeps its first moment and, for the same
installation, its status, and an account standing for another workspace is
refused and stays there. `src/accounts/workspaces-app.test.ts` holds
all of it over the plugin on PGlite and a scripted GitHub.

`GET /api/plans/{id}/work` reads back what Luke wrote and
ran on the task's calls (`src/tasks/task-work-store.ts`): the task's
conversation's turns, twenty a page newest first, each read from its
row and journal by the same `src/tasks/task-work.ts` a live call tells them
through, and `?before=<turn id>` for the page before that turn; the answer
names the turn the next older page is read before while one stands. The
newest page also carries every answered `show_code` call in the
conversation, oldest first, picked by its parts in the statement and read
through `shownCodeOf`, so what the call refused and a secret file are
never read back. `packages/features/src/tasks-view.ts` declares the
answer (`taskWorkAnswerSchema`).

`GET /api/plans/{id}/file?path=&first=&last=` reads a window of one file of
the task's repository for the Mac's File tab (`src/tasks/task-file.ts`),
at most 500 lines a window. No sandbox stands outside one of Luke's turns, so it
reads GitHub's contents API at the head of the default branch, not the
session's checkout, or with `ref=` at that commit, a whole 40-character
lowercase SHA and nothing a branch or a path could spell, as an inbox item's
code block pins its lines, on a token `repositoryReadToken` mints for that one
repository with contents read, after the same reach check the checkout
makes. The token is used for the one read and enters no answer, log line,
or trace. What is shown is decided by the rule `show_code` is held to
(`src/tasks/shown-file.ts`): a secret file is refused before GitHub is
asked, and so is a path with an empty, `.`, or `..` segment; a link, a
directory, a missing file, a file past a megabyte, or one with a NUL among
its first bytes is refused by name, a path GitHub finds nothing at with the
branch or the commit it was looked for at; and each line is cut to 400
characters.
`packages/features/src/task-wire.ts` declares the request and the answer
(`taskFileRequestSchema`, `taskFileAnswerSchema`). The file's `path` query
reaches the route because the grouped function's dispatcher reads its own
path override from `route-path` (`apps/web/server/function-dispatch.ts`): it once
read `path`, and every File tab read was answered 404.

`GET /api/plans/{id}/revisions` reads the plan's history for the Mac's
version history (`packages/database/src/models/plan-revisions.ts`): fifty revisions a page,
newest first, each its writer as the "Edited by" line names it, when it
began and last moved, how many changes it made, and for a restore the
revision it brought back; `?before=<seq>` reads the page before that
revision, and the answer names the revision the next older page is read
before while one stands. `GET /api/plans/{id}/revisions/{seq}` reads one
revision's content and the content before it, null for the first, each
formatted under the task's name as it stands now, so a rename since is no
difference between them. `POST /api/plans/{id}/revisions/{seq}/restore`
puts that revision's text back through the plan's one
locked save (`src/tasks/plan-notes.ts`'s `restoreRevision`), kept as a
revision of the developer's naming the one restored, and answers the plan.
It takes no body and no base: what it replaced is the revision before it,
so a restore over a save that landed meanwhile is undone by restoring that.
Every member of the task's workspace reads the history any of them wrote;
a task of a workspace the account is not in reads as an empty history and
restores as `not-found`. `packages/features/src/task-wire.ts` declares the answers
(`planRevisionsAnswerSchema`, `planRevisionAnswerSchema`).

A task's repository is `task.repository` (migration 0063), the full name
`owner/name` as GitHub spells it, or null for a task with none, which is
where every task from before repositories stands and is no error. It is
kept only once `workspaceRepository` on the `GitHubApp` confirms the
installation connected to the task's workspace reaches it, read from GitHub
before the row is written, so a task never names a repository its workspace
could not reach at the moment it was named; the stored spelling is GitHub's,
whatever case the request used. A start or a change naming one outside that
installation, or any in a workspace with nothing connected, is
`repository-not-reachable` (403) with nothing written, the name beside it
included; a GitHub that did not answer is `github-unanswered` (502), and an
App or store the service could not read `unavailable`, the task standing as
it was. A change naming null clears it.

A `repository-not-reachable` refusal says why in `unreached`
(`@luke/features/repository-reach-wire`, read by `repositoryReach` on the
`GitHubApp`), naming the repository: the workspace has nothing connected
(`not-connected`); the installation GitHub no longer knows or its account
suspended (`connection-lapsed`); the installation is on another account
than the repository's owner (`other-owner`, naming that account where the
workspace holds one alone); the
installation on the owner was not given the repository (`not-selected`,
with the installation's settings page on GitHub); or one given every
repository of the owner still does not list it, which a rename, a
transfer, or a delete leaves (`gone`). Where the task's owner asks and the
workspace has nothing connected or another account's installation, and the
owner's installation stands for another workspace they are in, the reason
is `other-workspace`, naming that workspace, since an installation stands
for one workspace alone and moving the task there is what reaches the repository:
a task a personal workspace held before #2524 is left that way.

A plan's text has one write, `src/tasks/plan-notes.ts`, and four
writers. `POST /api/plans/{id}/edit` takes the developer's edit of the
whole text against the base it was made on (`saveDeveloperEdit`), saved
where the text still holds that base, laid over what Luke wrote meanwhile
where it can be, and answered as a conflict with the text as it stands, with
nothing saved, where it cannot (`packages/features/src/plan-edit.ts`); a
restore above is the second. A call's notetaker
(`src/tasks/plan-scribe.ts`) and a coding agent's `edit_plan`
(`src/agents/coder-host/plan-edit.ts`) answer with notes
(`packages/features/src/plan-template.ts`): a point added under a heading, a
phrase corrected, or a line struck. `saveNotes` takes them in order over the
text as it stands, passing over a note that names a phrase the plan does not
hold, and saves it under a binding of account and task the service built
rather than anything the model sends, answering the document as saved or
why nothing was: a text past its bound,
a task deleted meanwhile, which a save never recreates because it is an
`update` over the row that stands, and a store that could not be reached,
each leaving the prior document in place.
`readTask` is the read Luke starts and resumes from, with the
conversation `attachTaskConversation` associated, and it moves nothing.
`src/tasks/tasks.test.ts` and `apps/web/tests/tasks-app.test.ts` hold both halves
against a real dialect.

Luke's judgment is the hosted brain run over a task conversation (`plan`), which
`openTaskConversation` opens once per task and attaches; deleting the task
stamps it cleared, so the purge takes its words thirty days on. A task's is
the only conversation any code still opens, and the host runs every
conversation it admits as one, which fixes three things
(`src/agents/brain-host/brain.ts`): the prompt is
Luke's authored instructions, the standing context each turn opens with is
the task's name and saved plan read again from the row,
and the tools are Luke's list alone: `run_in_repository` bound to the
task the conversation belongs to (`readTaskOfConversation`), the two public
research reads beside it, `queue_question`
(`src/tasks/queue-question.ts`), which runs nothing: its journaled call is
how a question reaches the voice while the turn still runs, and the
tools about coding agents (`src/agents/coding-agent-tools.ts`), the same
`list_agents`, `read_agent`, `message_agent`, `start_agent`,
`archive_agent`, `unarchive_agent`, `list_tasks`, and `list_models` every
coding agent is offered: a list
of the task's workspace's agents, on any task and by any member, with each
agent's status, task, and what it published, narrowed to this task or
another where asked (`src/agents/workspace-agents.ts`), one agent's recent
progress as a bounded tail, a message to one, which takes the message
box's own steer path (`src/agents/coder-host/steer.ts`), the workspace's
open tasks, and a start of a new one on the call's task or another task of
the workspace by its id, which takes the Start button's own path
(`src/agents/coder-host/start.ts`) under the tool call's id as its key;
both reach eve as the deployment acting for the account, the two rows the
coder channel's deployment table admits. A resumed session
is seeded with the conversation so far. The writer holds rows to
`HOSTED_TOOL_SET`, which is Luke's tools and nothing else, so a turn's
calls are written and read back under the same list it was offered.
Question choice, agreement, assumption flags, and corrections are the
instructions' alone: no code reads the document for meaning.

**One tool registry** (`src/agents/agent-runtime/tools.ts`). Every tool
Luke offers any of its four agents is named once there, with the roles it
serves: Luke's brain, its worker, the coding agent, and its worker.
What each is offered is derived from it: the brain's hosted resolver
offers its own (`PLANNER_TOOL_NAMES`), the brain's worker its own
(`WORKER_TOOL_NAMES`), and the coding agent's files under `apps/dev/tools/` and
its worker's are held to their roles by `coder-agent.test.ts`; each role's
stored set names every tool the role is offered. A tool's
module takes its name from the registry, so the registry imports none and
every module may import it. eve's own injected tools (`task_wait`,
`task_cancel`, `connection_search`, `connection_execute`) are eve's, not
listed.

Luke's session is offered the skills the task's repository keeps
(`apps/luke/skills/repository.ts`, `src/agents/agent-runtime/skills.ts`), read
from GitHub on a read token for that repository as the session starts, which
is the call's warm-up ask, and loaded with eve's own `load_skill`; each body
says where the skill stands in the repository, so its files are read with
`run_in_repository`. A task with no repository, one the App does not reach,
or a read that fails offers none, and a coding agent's are read the same way
from its own repository, led by where they stand in its checkout. A skill
load reaches the Work tab as `other` named `load_skill`, a kind every desktop
reads, with the skill as its subject.

The research reads (`src/agents/public-research.ts`) are `search_web`,
one query sent to OpenAI's Responses API with its own `web_search` tool on
Luke's key and the brain's model at low reasoning effort and low search
context, since the turn waits on it, asked to store nothing, and
`read_web_page`, one public HTTPS page fetched and reduced to its text.
Neither knows the account or the task: what leaves is the query and fixed
instructions, or a GET for one URL with no credential of the account's, and
the result goes back only to the call that asked. A query is one line of at
most 200 characters with nothing shaped like a credential; keeping private
repository text out of it is Luke's instructions' rule, since plain
words cannot be told apart by code. A search is `found` only with a cited
public URL, each with the answer's words that cited it; a finished uncited
answer is `no-results` and its words go no further, one the token bound cut
short before it cited anything is `not-searched`, and every failure is `not-searched`
or `not-read` in words that say nothing was found. A page read refuses any
host whose address, resolved before each request and again on every redirect
hop it follows by hand, is private, loopback, link-local, CGNAT, unique-local,
or reserved; the check is a lookup ahead of the request, so a DNS answer that
changes between the two is the case it does not cover. A turn gets at most
4 searches and 6 page reads, 5 sources a search, and 20,000 characters of a
page from at most 1 MB read (`PUBLIC_RESEARCH_BOUNDS`). A search is a paid
inference on Luke's key, so each one is counted as one of the calling account's
hosted uses before it is sent; a count that cannot be written is logged and stops
nothing.
`src/agents/public-research.test.ts` holds both against scripted HTTP and DNS.
`src/agents/brain-host/brain.test.ts` runs the scripted model through the host and
the relay, and the `brain-host` eval runs a task conversation through eve.

The developer talks to Luke through the ordinary voice
session. Every call is a `/api/voice/sessions` session whose
`session.create` names the task (`planId`), which the service checks the
account holds before anything is spent; a create naming none is refused. It is created under
the call's instructions (`sessionInstructions()` in
`@luke/live`), whose delegation policy hands the developer's words to the backend and says back the
finding and its one next question. A call just created speaks first: it is
created with `callOpeningHistory()` as the last developer message of its
startup history, the Live conversations guide's way to greet before the
caller speaks, so Luke opens the conversation with nothing appended,
acknowledged, or cued after `session.started`, and a re-attach, which creates
nothing, opens nothing again. The plan seed's first line says whether the
plan is new (the untouched template and no assumption) or under way, which
is what the opening picks its first question from. The exchange lands every spoken ask and
the session's record in the task's conversation (`openTaskConversation`),
so the delegation reaches
Luke with the plan, his tools, and the conversation so far.
The recent words ride the delegation as context, and whether an answer
agrees to anything is Luke's instructions' to judge. The binding is the session's for life. It is written on
the `voice_sessions` row as a plain `task_id`,
and a re-attach reads it from there, so a later connection cannot move a
session onto another task, and one whose row names no task is refused. The Mac holds one call at a time, which outlives
the task on screen and moves only when another task's Talk press hangs it up
and opens one about that task, so only one task is ever spoken about. `src/voice/voice-service-exchange.test.ts` drives both
tasks and the re-attach over the real store.

Luke reads source through one tool,
`run_in_repository({ command })` (`src/agents/repository-shell.ts`), which
runs the command in Luke's session's own Vercel Sandbox, the one eve
opens per session from `apps/luke/sandbox.ts` and hands a tool through
`ctx.getSandbox()`, on a checkout of the task's repository. The first call
that finds no checkout of the task's repository makes one, at the
repository's current default branch and one commit deep, and later calls
reuse it; a task whose repository changed meanwhile is checked out again,
and the worker subagent shares the session's sandbox
(`apps/luke/subagents/worker/sandbox.ts`), so its reads see the same checkout. The
checkout reads through the Luke GitHub App: `repositoryReadToken` confirms
the installation of the task's workspace still reaches the repository and
mints a token for that one
repository with contents read, which the shell sets as GitHub's `Basic`
header at the sandbox's firewall, on `github.com` under the repository's own
`.git/` endpoint alone, for the clone alone, and sets back to open internet
as the clone ends, in a finalizer, so the token never enters the sandbox's
filesystem or environment and no command or output can carry it. The
command runs from the checkout root under a 60-second bound and a clean
environment (`env -i` with a search path, a home, and git's fixed values,
as the Mac runner once gave one), with its text handed to bash as an
argument rather than spliced into shell text, and answers its exit code and
up to 20,000 characters each of stdout and stderr. Every refusal is
`not-run` with a reason the model can act on, and each is answered ahead of
anything it would need: a task with no repository yet opens no sandbox; a
repository the workspace's installation no longer reaches, a GitHub that
could not be read, a sandbox that could not
be opened or carries no firewall, and a clone that failed, with git's words,
each check nothing out. `src/agents/repository-shell.test.ts` holds it over a
sandbox double at eve's boundary (`src/testing/repository-sandbox.ts`), a
scripted GitHub, and PGlite, and `src/agents/brain-host/brain.test.ts` drives the
scripted model's read through the host and the relay, reading the record
back for the listing and never the token. The old `plan_command` table, the
Mac's claim and settle routes, and the Mac's command runner are gone
(migration 0064).

## Hosted conversation store

The `conversations`, `messages`, `turns`, and `asks` tables hold the hosted
brain's conversations per account: a task's conversation, its messages, the
turns that ran over it, and the asks handed to it. Every row is keyed by
`user_id` and cascades with the user row, so
`apps/web/server/routes/account/delete.ts` erases them with the account.
`packages/database/src/models/` is the store the brain host composes against; every
module there is an `Effect<A, SqlError | Schema.SchemaError, SqlClient>`
whose rows a `Schema` decodes and whose path rule is that schema too, which
`HostedStore`, the store writer, the voice writer, and the ask record all
answer as it came, and which a route handler composes into the one effect
`runWeb` answers for the request.

`20261013123642_dead_tables_drop` dropped the tables and columns nothing
read or wrote any more — `events`, `provider_cursors`, `provider_key` (not
the BYOK keys, which are `account_provider_key`), `roster_snapshot`,
`transcript_mark`, `observation_pass`, `workspace_file`,
`workspace_embedding`, `devices`, `account_workspace_preference`,
`introduction_usage`, `account_preference.default_workspace_provider`, and
the conversation row's observed-session, event-sequence, completion-sweep,
and memory-flush columns. A child's `parent_conversation_id`, `label`,
`title`, and `expects_completion` are live: a subagent's and a coding
agent's worker's child conversation writes them.

The conversation tables are the shape the LUKE-95 storage plan settled on,
less the `prompts` table it drew and less the `tool_sets` table
`0039_dead_tool_sets` dropped: a turn keeps the composed prompt's hash and the
tool set's and nothing else of either, because nothing replays them, and the
tool set is the build's own and read from the build that offered it. A
conversation row names its kind (`plan`, which `packages/database/src/models/task-store.ts`
opens, and `coding_agent`, which `packages/database/src/models/coding-agent-store.ts` opens,
are the two any code still opens), the
runtime's own session id, its soft-delete instant, and the counter that
numbers its messages. A message is one AI SDK `UIMessage`, its parts and
metadata as plain `jsonb`, unique on `(conversation_id, client_id)` as its
idempotency key; a turn is one run's origin, status, model, prompt and
tool-set hashes, response ids, usage, timings, and failure, with why the
runtime failed one in `failure_detail`: eve's failure code, the key names of
its details, the error's class name, eve's catalog id, and status codes where
eve's details carry them, and eve's message cut to 200 characters with every
credential-shaped run replaced by `[redacted]`, no other value of the
details, cut to 500 characters by the writer and read by nothing but a
query. A prompt and a tool set are content-addressed, the hash of the text or
the schemas as the key, and the turn row carries that hash and nothing else
of either, naming no row and holding no foreign key. Nothing in these tables
is sealed: the content is readable by an operator.

The store writer, `packages/database/src/models/writer.ts`, is the one path by which a
`messages` or `turns` row is written: the writer is the one server module
with an insert, an update, or a delete over `messages` or `turns`, whether as a
Drizzle table imported from the schema or in the text of a statement, and the
modules that name one at all are the writer and the two readers. It
consumes the brain's run event stream (`BrainRunEvent`, every kind of turn)
for a conversation the caller names by its row id and account. A turn row
goes from queued (written ahead of the stream by `enqueueTurn`, or at the
turn's start where nothing queued it) through running to settled, cancelled,
or failed, carrying the origin it was queued under, eve's own id for the turn
where the relay queued it (the store's id is a digest of it that nothing
reverses, and a Stop on the row is scoped to eve's turn by reading it back),
its usage split four ways, its response ids where the runtime has them, and
its failure word. Each user
message the turn opened with lands as its own row by the message's id. The
turn's answer is one assistant message keyed by the turn's id, and while the
turn runs that row is its journal: a tool call is written in `input-available`
before it executes and moved to `output-available` or `output-error` as its
result lands, a reasoning summary is written as it completes, and the turn's
completed message replaces the journal's parts whole and sets `finished_at`
once, after which the row is immutable and a late event for it is refused. A
turn that ends with a call still unanswered settles the call as an answer
whose envelope says its effect is unknown, since the call was dispatched and
nothing will answer it now, and closes the row; a writer that dies between
the call and its result leaves the part in `input-available`, which is what
a resume reads. Only a refusal — a call the tool or the host's admission
refused — is an `output-error` part; an unknown outcome is an
`output-available` part carrying its envelope, so the record can tell "Luke
declined" from "Luke does not know", which are opposite claims. Because any
call may answer with that envelope, a tool's declared output schema has to
admit it, and the writer holds the catalog to that once, when it is
composed, refusing to exist over a catalog that fails it rather than leaving
a row nothing could read back. Every write is
idempotent — a message by `(conversation_id, client_id)`, a turn by its id, a
tool part by its call id, a reasoning part by its item's id — so an event
delivered twice writes one row and a replayed stream changes nothing, and
every message is held to the vocabulary before it lands, through the same
`readStoredUIMessages` a read goes through, so no row can carry a tool the
catalog does not register, an input its schema refuses, or metadata outside
the set; a message the reader would refuse is refused whole and reported,
never cut down to the parts that would pass. Every write runs under a lock on
the conversation row, which no write reaches once it is stamped deleted; the
sequence comes from the row's counter, each allocation landing on the first
position no row holds, so the unique `(conversation_id, seq)` constraint is
the backstop for a writer outside the lock and nothing the writer retries.

Voice is stored beside them the way a call platform stores a call, in
`voice_sessions` and `voice_transcript_segments`.
A session row is one live session — the Live API's own session id, unique so
a re-attach on a fresh function instance finds the row it had rather than
forking it, and indexed with the user so an ownership check is one lookup —
with its delegation mode, when it started and
closed, the API's own close reason, and a `usage` payload of billed seconds
with a flag saying whether the API confirmed them or a lost connection left
them estimated. A segment is one span of what was actually said, by whom, in
milliseconds on the session's clock. What is spoken becomes a message as each
utterance settles: the developer's line and every utterance of Luke's are each
cut from these segments into a finished row of the conversation, so the
record keeps the words the developer actually heard. A delegated
exchange's reply is also the assistant message the brain wrote, and Luke's
reading of it stands beside that message as its own row, whose metadata names
the voice session and span it was cut from, the delegation it followed, and,
where the store could tell, `read_from`: the message the words were read
aloud from — the delegation's turn's journal where that turn had settled
within two minutes of the write, in which case the row joins the turn. No
audio is ever stored.

Two writers share those tables and never a column. The voice service's own
`packages/database/src/models/voice-session-record.ts` owns the session row's whole life: it is
inserted when the session is created, found again by `(user_id,
live_session_id)` when a fresh function instance re-attaches to the same
live session, overwritten with each unconfirmed usage snapshot while open,
and closed once with the confirmed seconds, the instant, and the reason. The
voice writer in `packages/database/src/models/voice-writer.ts` only reads that row
for its id and hangs everything else off it: a segment per transcript delta
at the next position of the session's own sequence, and the developer's spoken ask as a
user message on the voice channel, cut from the stored user segments between
the previous ask's end and the delegation's offset or the end of the
utterance the service's ledger grouped the ask as, whichever is later, and
named with the session, the delegation, and the span. A row whose `closed_at` is still
null may keep gaining segments, because an instance that dies at its
duration bound never sends `session.closed`, its relay detaches rather than
closing, and the re-attach lands on the same row; the writer reads nothing from the row's state but its id
and reads everything else back from the record, so a
fresh instance continues a session where the last one stopped.

The store tests run the generated migrations on PGlite in process, so
`check.sh` needs no service; the `postgres` CI job runs the same migrations,
then `test:store`, against a Postgres container. Every one of those is
Postgres 18, the major production runs: Neon serves 18.x, PGlite 0.5.8
embeds PostgreSQL 18.3, and the CI image is `postgres:18`, so a failure in
any of them is about the database the service actually runs, and a local `check.sh` is a reproduction on 18 already. On either
dialect an opening of the test database is a database of that opening's own:
a fresh PGlite, or a clone of the database `LUKE_STORE_TEST_DATABASE_URL`
names, made with `create database ... template ...` on the cluster's
`postgres` maintenance database and dropped when the file closes it
(`@luke/database/testing`). Nothing writes to the named
database itself after `db:migrate`, so a statement a test forgets to scope by
account or conversation reaches its own file's rows and no other file's.
Which files `test:store` runs is read from the files, not kept
in a list: `apps/web/scripts/store-tests.ts` selects every `apps/web/tests/**/*.test.ts` whose
source imports the one door, `@luke/database/testing` (whose
`openHostedStoreTestDatabase()` is the hosted store's and `getTestDB()` the
bare one), because
`LUKE_STORE_TEST_DATABASE_URL` is read there alone and a file that imports no
door cannot meet a Postgres whatever it does. A new store test is therefore
in the set the moment it imports its harness, and `package.json` is not
edited. The runner then reads vitest's JSON report back and fails, naming
each file, when the files vitest ran are not exactly the files selected. A reproduction against a real
Postgres needs an 18 of your own whose role may `create database`, migrated
by `db:migrate` alone, because that is the runner which records what it
applied and the tests copy what it recorded, so run it first:

```sh
DATABASE_URL_UNPOOLED=postgresql://... pnpm --filter @luke/web db:migrate
LUKE_STORE_TEST_DATABASE_URL=postgresql://... pnpm --filter @luke/web test:store
```

## Hosted voice service

`apps/web/server/routes/voice/sessions.ts` is the hosted voice service: one Vercel
Function serving WebSockets on Fluid compute, the part of this deployment
that holds the GPT Live project key and owns each hosted voice session
(`live-contract.ts` in `@luke/features` is the Mac's contract with it). The
file exports the `http.Server` that `src/voice/service.ts`'s
`voiceServer()` builds, with `ws` handling the upgrade on it, exactly as
Vercel's WebSocket guide has it; the Mac opens `wss://` on this deployment's own origin,
`HOSTED_VOICE_SERVICE_ORIGIN` in `@luke/features`, at `VOICE_SERVICE_PATH`.
A plain request to the path answers 426, since the path is a socket's.

On `/api/voice/sessions` a signed-in Mac's handshake carries its account
bearer, resolved through the same in-process `/oauth2/userinfo` seam every
hosted route uses, and one session is counted against it by the same
`hosted_usage` meter before any session exists. The
socket's first frame is `session.create` (the SDP offer, a voice, the seed,
and the id of the task the call is about); the opener
(`src/voice/opening.ts`, which is where the first frame becomes a session
or a refusal) checks the account holds that task, and
the function creates the session at OpenAI on the deployment's key, writes
down the session's `voice_sessions` row (the account, the live session id,
client delegation, the task the call is bound to, and the model it was
created on), attaches the trusted sideband, stands the hosted
exchange on it (below), and answers `session.created` with the id, the SDP
answer, and the store's own id for the `voice_sessions` row
(`voiceSessionId`), which is what a stored spoken row names as its
`voice_session_id`. From then on the relay is a pipe: OpenAI frames to the
device untouched except `session.input_audio.append` and
`session.output_audio.delta`, dropped by type so the developer's voice and
Luke's never transit the service; and from the device nothing forwarded at
all (`frames.ts`): the hang-up (`SESSIONS_HANG_UP_FRAMES`), the Mac's
`session.hangup` or an older build's own `session.close`, is read as an ask
for the close the exchange sends itself (below), and two frames in the
service's own vocabulary (`SESSIONS_REPORT_FRAMES`) are read here and handed
to the exchange rather than forwarded: `session.activity`, the peer's idle
report, and `session.stop`, the stop key, which the exchange answers with the
one instruction it appends itself (`STOP_SPEAKING_INSTRUCTION`, which stands
on the service alone) and by blocking every exchange of the session: no reply
delegated before the press is spoken, and each run still under way is
cancelled through `stopAsk`, the voice told silently (`STOPPED_RUN_NOTE`)
only once the cancel was taken. So no device appends anything to a session,
and no sentence of a device's composing reaches one through this route. Any other device frame — an older build's own append, the
microphone switch that never crosses this socket, an unreadable frame —
closes that device's socket with a policy violation (`UNPERMITTED_FRAME_REASON`)
rather than dropping it, so a device still running an exchange of its own is
refused where it can be seen and never doubles the one standing here; the
session then ends as a hang-up does, seconds recorded. The relay keeps no
conversation, reads no frame past its `type` but those reports, and logs
status codes, outcome names, and counts.

The service itself is a scope. `VoiceService.make(options)` answers
`Effect<VoiceService, never, Scope>`, and that scope owns the `ws` server, the
`FiberSet` each session's fiber joins, and the claim on the server the function
exported; closing it gives up the claim, closes every device socket so each
relay detaches, leaving the WebRTC session for the device to
re-attach to on another instance, drains those fibers under their own timeouts, and only then closes the `ws` server. Nothing calls a `close` beside
it, because a Vercel function is frozen between invocations and discarded with
no shutdown hook: `voice/function.ts` stands the service on `runWeb` in a scope
held open by `Effect.never` and a test is the only caller that ever ends one.
Until a service stands, and again once its scope closes, the server refuses
every upgrade with the same 503 a deployment missing the project key answers
with.

One upgrade is one `Scope` and one effect run on the `WebStoreRun` the
function hands the service. Both sockets are the platform's:
`src/voice/socket.ts` reads a `ws` socket through
`effect/socket`'s `Socket`, a fiber of that scope filling a mailbox with
every frame in arrival order, so the opening frame is taken from the same
reader the relay then streams the rest from and nothing between the two lands
nowhere. `src/voice/relay.ts` pipes the two streams, settles on a
`Deferred`, and arms its graceful-close and opening waits as `Effect.sleep`
forked into that scope; `src/voice/openai.ts` answers effects for the
session create and the sideband attach, each socket acquired with `Effect.acquireRelease` so a session
that ends, however it ends, leaves no socket standing. A socket handed over by
`ws` is paused until its reader stands, because `ws` emits a frame to whoever
listens at that instant and the reader is a fiber away.

A device's socket is bounded to `SOCKET_BYTE_BUDGET`, eight mebibytes the
caller may send before the service closes the socket, since its account is
spent per session and answers for what it sends. The socket's own reader
counts it, from its first frame rather than from whenever the pipe stood, so
what a caller sends while its session is being stood up is spent as much as
what the pipe later carries, and a frame past the budget is not read at all —
what the relay sees is the peer going, which is a hangup it already knows how
to end. The voice never travels here: it is WebRTC's.

### The live session service, attached to the sessions route

The machinery that owns a session's exchange — the delegation adapter that
hands each ask to the brain and speaks the reply as commentary once the run's
actions settle, the append channel, idle, and the
graceful close — is `@luke/voice`'s `LiveSessionService`, behind that
package's `./live-session` door, which names no socket library so a function
bundle takes it without `ws`. This service composes it for every signed-in
session (`src/voice/live-exchange.ts`, adopted over the same socket the
relay pipes by `exchange-attachment.ts`, composed over the deployment's seams
by `deployment-exchange.ts`, and passed by `function.ts`): the exchange stands
before the desktop is answered, and a deployment missing the deployment
secret or eve's origin composes none and refuses every
session as `unavailable`, since a session with no exchange behind it has no
one to answer its asks. The desktop composes no exchange of its own since
E5-3; what it holds is `LiveSessionHolder`, which seeds the session at
creation, ends it, and reports its idle and its stop. What stops the
model's output from becoming an action is not the attachment and not the
sideband but the brain's own gauntlet: `acceptAsk` on every spoken ask, and
the host's admission of the conversation again on every tool call a turn
makes.

What stands: `src/voice/live-record.ts` is the `LiveRecord` door over the
voice writer (`packages/database/src/models/voice-writer.ts`). Every server event is
handed to `observe` in arrival order and the writer takes what it keeps —
each transcript delta a segment, and, through the one row door the service
calls behind each fragment (`upsertSpokenRow`, debounced 300 ms a row and
flushed at once on a delegation and on the session's close), each speaker's
utterance as a row under the id the service's ledger minted when it opened,
inserted on first sight and grown in place after, its words cut from those
segments over the span the ledger holds it at: the developer's line, and
every utterance of Luke's as an assistant row authored by the voice model,
whatever prompted it — an answer it gave itself, what it said around an ask
handed to the brain, the brain's reply read aloud, the opening — so the
record shows what the developer actually heard, and a reading stands beside the message it was read
from rather than in place of it. A delegation cuts nothing and re-keys
nothing: the stream's `session.delegation.created` is consumed like any other
event and leaves nothing, and what puts an ask on record is the service's
attach: every developer row of its ledger since the previous ask's end that
starts at or before the delegation's offset, the row containing the offset
among them, each handed over as the ledger holds it then, so a last fragment
the API delivered after the delegation is on the row, and each written and
then given the delegation in one turn at the writer (`attachSpokenAsk`), its
`client_id` the ledger's still and `metadata.delegation_id` naming the ask,
which is where the received-message attach and Luke's rows already look for
it. The ask's rows keep growing under their own ids after the handover, and
the store keeps the delegation on a row through every later write of it.
That order is a queue's:
one fiber of the socket's scope makes every write, taking them from a queue
each arrival puts one on, so where an event lands in the sequence is decided
where it arrives rather than by whichever fiber reached the store first. The write answers true
only when the ask is on record, which is what keeps the service's own rule —
the record precedes the speech — over Postgres. `src/voice/live-sideband.ts`
reads the upstream socket as the `LiveSideband` the service consumes — the
`ws` listeners it registers are the acquire of the session's own scope and are
taken off at its close — and `observedSideband` hands each event to the record
once, on its way past the one reader that runs the sideband's arrivals, replay
included.

### The brain answered in process

`src/voice/live-brain.ts` is the `LiveBrain` the hosted composition hands
the live session service, and it reaches Luke's judgment in process and never
over HTTP. The voice function resolved the account at its handshake and
dropped the bearer there, so it holds nothing eve's door or this deployment's
routes would take; what it holds is the ask door itself, `acceptAsk` in
`src/agents/brain-host/brain-ask.ts`, called with the resolved account, the spoken origin, and the
service's submission id as the client id, under the eve client the
composition built for the account as the deployment acting for it
(admitted for spoken turns by `DEPLOYMENT_TURNS`, below).
The run the service keys an exchange by is the ask's id, since eve names a
turn only once it starts; the brain follows the ask through `askStanding` on
a schedule, projects its turn's events with `projectTurnEvents`
(`src/agents/turn-events.ts`), and translates each back to the ask's id. There is no HTTP hop
and so no second function ceiling to re-attach across. Each follow is a fiber of the socket's own scope, so
the socket detaching interrupts it and nothing is emitted after. What the
detach cut short is not lost with it: a spoken ask's row carries the voice
session it was delegated in and its revision there, how far its turn was told
(`told_seq`, short of the end), and when its end was told (`end_told_at`), each
written before the voice hears it. A connection that re-attaches to the session
adopts it as started and asks the brain to recover it (`recoverRuns`): every
ask of that session whose end was not told comes back as its exchange, under
its own delegation and revision, and is followed again from the event after
the last one told. The session's revisions go on from the newest recorded, so
an older run stays superseded; a run whose turn carries a Stop comes back
silenced; and so does one whose turn settled more than `VOICE_DETACH_GRACE_MS`
before the re-attach, past which the reply is no longer news. Written before it
is told, a telling the detach cut between the write and the voice is lost and
never said twice. A turn that
does not end inside the follow bound, or an ask the record no longer holds,
is told as a failed end so the exchange settles rather than waiting forever.
The bound is `LIVE_BRAIN_FOLLOW_BOUNDS` in `src/voice/live-brain.ts`: the
plain `FOLLOW`, ten minutes, past eve's own turn deadline with room for one
queued turn ahead, until the journal shows the turn handed work to the
`worker`, which eve runs as a subagent task the turn parks on (`turn.waiting`)
and resumes from in the same turn once the findings land, minutes or longer
later. From that call on the follow runs under `PARKED_FOLLOW` instead: the
plain bound plus the sweep's `TURN_ABANDON.AFTER_MS`, an hour, at which a turn
still running is settled as failed on the record and the follow hears that end,
so following longer could hear nothing more. The record does not say when the
subagent task settles — the relay tells nothing for the park and the findings reach the
journal as the steps after them — so the parked bound covers the turn from its
delegation, and the follow still stops the moment the turn completes, fails, or
is cancelled, or the socket's scope closes. On the eve
path the reply arrives whole at the turn's end; what the follow carries
mid-turn is the slow step, each question a turn queued, the
actions settling, and, as the live brain's own and no event of the stream,
each look's count of the turn's settled calls with the kind of the latest
(`STEP_SETTLED`), never a call's input or output, which the service words as
a build-fixed quiet progress note no sooner than `PROGRESS_NOTE_BOUNDS.GAP_MS`
after the exchange's last and at most `PER_EXCHANGE` times. A reply's
commentary the voice session refused is sent once more under a fresh id and,
refused again, reported; one left unanswered is reported and never resent,
since a pending append may still reach the timeline. eve folds asks that waited together into one turn, so
several follows can project one turn: the newest ask tells it, since the
service speaks only the newest request's reply, and the rest tell only its
end, so a reply is never said once per folded ask. Each delegation is an
exchange of its own in the service, a revision of the request: a newer one
silences the older exchange's reply, slow-step note, and end note, and leaves
its run to finish rather than cancelling it, because a call
delegates every answer while the exploration it began still runs; the
questions a silenced run queues are still handed on. A refusal at the door is
spoken as the build's own note for it, never composed with the ask. One
spoken ask leaves one developer line: the transcript's row, cut at the
delegation by the voice writer under the delegation's id. Eve's received
message for a spoken turn is the question the service composed around those
words, which is not written as a user row, where a typed ask's is;
`BRAIN_HOST_TURN_KIND` says for each kind whose row the received message is,
so the relay consults the table rather than a branch. The line and the ask
share one id, the delegation's, which the service submits the ask under, so
the line is tied to the turn the ask ran whichever write lands second: the
voice writer reads the ask's turn under the conversation's lock as it writes
the row, and the relay, at a spoken turn's received message, takes into the
turn any row of the turn's asks still standing without one, and behind it
any row of Luke's about that ask — his "checking now", said the moment the
voice handed the question over and written while the dispatch was still under
way — under the same lock, in the order said. The race is removed rather than
won, and no line of his is left as a group of its own to be placed by its
instant after the whole turn it belongs to. The store owns the order inside
the group as it owns the order of the conversation, so the writer places the
developer's line ahead of the turn's work by sequence rather than leaving a
reader to sort it. A line the turn takes at its received message moves to a
fresh position, ahead of the journal the first step is about to open; a line
that lands after the first step, the voice writer's cut racing eve, is placed
at a fresh position and the journal moved behind it to another; and a line
the turn takes with a journal already open — a received message eve told
again after the step — moves the journal behind it the same way, so the
developer's line precedes the turn's work on every path a line enters a turn
by. The turn's answer closes the journal behind whatever landed after
it while the turn ran — Luke's words said around the ask as the brain worked,
an aside, a second line of the developer's — by moving it to a fresh position
where any row stands past it, and leaves it where it opened where none does,
so the thread reads as it was heard: what was said while he worked, then what
he did and thought, then what was said of it.

`src/voice/live-exchange.ts` composes the whole for one account's one
live session — the brain answered in process, the record over the voice
writer with the sideband observed once ahead of the service — over one
store context, with the eve client handed in as the caller composed it. The
brain's asks are pinned to the conversation the record writes, the task's,
so an ask and the lines it leaves cannot name two conversations: once the
task's deletion has stamped it, the ask is refused at the door and eve is
not reached, rather than eve taking a turn the record cannot write. The
composition is a scope's:
`hostedLiveExchange` answers an effect built in the `Scope` its caller opened
for the socket, and every fiber the session runs is forked into that scope —
the one that reports what the record made of each live event, the one that
makes every record write in arrival order, the brain's follow of each
accepted ask — so closing the scope
interrupts each of them. The session's graceful close (its release with
nothing said, `LiveSessionService.release`, where the relay settled detached)
and the wait on every record write already started are finalizers of the same
scope, added so their
reverse order is the order the exchange's old `stop` ran them. No composition
below the exchange holds a runner, and none of them runs an effect at all:
`LiveRecord`'s two utterance writes and `LiveBrain`'s submission answer
effects themselves, the record's on the fiber that makes every write in
arrival order and the brain's with the `SqlClient` the scope was built on
provided to it, as `runTool` provides it to the brain's seams.

### The exchange on the sessions route

`src/voice/service.ts` takes one more seam, `VoiceServiceOptions.exchange`:
the composition's exchange for a signed-in session, offered once the session
stands and before the desktop is answered, and adopted over the same sideband
the relay pipes. The service hands the attachment the socket and reaches
nothing of the exchange or the live-session door itself; the attachment
builds the sideband over that socket and adopts. One
socket, one scope: the attachment is an effect the service runs in a scope
forked from the session's own, building the task's conversation, the
exchange, and its adoption of the sideband in it, and the
service's stop is that scope's close; a standing that could not be reached
has the scope closed by the service before the session is refused, so nothing
an attempt acquired outlives it. The
socket admits many listeners, so the relay keeps piping raw frames to the
desktop unchanged while the exchange reads parsed events through its
record-observing sideband. The upstream hands the sideband over paused,
inside its own open handler, because the bytes after the handshake response
are re-queued and flushed on the next tick, before any fiber continuation;
the service resumes it once both consumers listen, so what the session spoke
while the exchange stood is read then, by both, in order, and a desktop that
went meanwhile is answered nothing, its exchange stopped and its sideband
left to the session's scope rather than standing for the invocation. The exchange adopts rather than
creates (`LiveSessionService.adoptSession`): the desktop's create frame
seeded the session, and a second seed would put the recent lines into the
conversation twice. A fresh connection re-attached to a running session
adopts it as started, since the session spoke its start to an earlier
connection and speaks it to no later one. An exchange offered that cannot stand refuses the session
as unavailable rather than running it with no one to answer its asks. When
the relay settles, the exchange ends its follows, closes the
session it holds (already gone, which its sideband reports as the close it
held), and waits for every record write already started, so no line begun
before the settle is cut; an append not yet sent is dropped with the session
and never re-sent, and a write that fails after the socket closed is
reported. `src/voice/exchange-attachment.ts` is what the function passes:
the task's conversation resolved at the session's start, under whichever
member of its workspace opened it, the function's writer, eve reached as the
deployment for the calling account, and the plan's
notetaker (`src/tasks/plan-scribe.ts`), which runs only where the
deployment holds the OpenAI key.

eve is reached as the deployment acting for the one account the session
resolved at its handshake, since the function holds no bearer of the
account's by the time a delegation arrives. It calls eve's session routes
under the deployment's `CRON_SECRET` as its bearer with the account in
`x-luke-account`, and the eve door's first authenticator admits that pair as
a principal of the deployment's own type — the deployment's one id, the
account as its attribute — for a message naming a kind of turn its table,
`DEPLOYMENT_TURNS` in `src/agents/brain-host/channel.ts`, admits (a spoken
turn), for a cancel of a turn in a session, which is how the stop key's
`stopAsk` and the hook's carried Stop reach eve, and for a GET of a session's
event stream, which the live brain listens to from its tail so it reads a
spoken ask's turn the moment eve tells an event rather than only on its
250 ms poll (the poll stays, for a stream refused or dropped), and nothing
else: any other route or kind of turn carrying the secret is refused outright
rather than passed to the account authenticator behind it. The stream read is
the brain's channel's alone; the coder channel's deployment, which presents
the account, is refused it. Which account a request acts
for is one accessor over both principal types, and the door's ownership
checks and the host's admission read that answer, so the deployment can open
a turn only on a conversation the named account reaches, and cancel one or
read a stream only in a session a conversation that account reaches recorded. Where eve answers is an
origin of this deployment's own, whose rewrites carry `/eve/v1/*` into the
eve service (`deploymentEveOrigin` in `src/agents/brain-host/eve-origin.ts`):
`LUKE_EVE_ORIGIN` where it is set, otherwise the project's production domain
in production and the deployment's own host on any other deployment.
Production names the custom domain rather than the generated `*.vercel.app`
host because that host carries the project's Vercel Authentication, which
answers a server-to-server POST at the edge and never reaches eve (LUKE-250).

### One connection is one invocation

A WebSocket connection to a Vercel Function closes when the function reaches
its maximum duration — `apps/web/server/function-durations.ts` gives the function
800 seconds, the longest generally available — while the WebRTC session between the device
and OpenAI stands on. A device socket that closes without the
device's own `session.close` is therefore a detach and not a hang-up: the
relay sends nothing upstream, settles `detached` at once, closes only its
sideband, records no close, and the exchange lets go of the session with
nothing said to it. The row is stamped `detached_at` (migration 0052) where it
is still open, and a re-attach clears the stamp, so a session no device came
back for is visible as an open row stamped longer ago than the grace, which
the scheduled sweep ends (below). Each connection names itself on the row
with an `attach_id` (migration 0058), written at creation and at every
re-attach, and a stamp lands only where the row still names the connection
writing it: the Mac re-attaches within seconds, so the connection it replaced
can write its detach after the new one attached, and that late stamp would
otherwise hand a live call to the sweep. A device that goes while its session
is being created or re-attached leaves the session stamped the same way, since
no connection is left to end it. So a socket may also open with `session.attach` naming
a session id. The function resolves the bearer, checks that this account is
the one the session was created for (the `voice_sessions` row written at
creation, indexed over the owner and the live session id for this lookup),
reads the task the call was bound to off the same row, refusing a row that
names none, attaches a fresh
sideband to OpenAI's `/v1/live/sessions/{id}/attach`, answers
`session.attached`, and pipes as before. Nothing the session said between the
two connections is replayed. The desktop's `HostedLiveSessionSource` in
`@luke/voice` does the reconnecting: three tries over about ten seconds,
sends made in the gap held for the next connection, and only after the last
failure does the host see the loss it already handles as `connection_lost`.

### How a session ends

While a signed-in session runs, every `session.usage.updated` overwrites the
row's `usage` with `{ seconds, confirmed: false }`, a snapshot and never a
sum. `session.closed` is finalization. Whichever connection sees it forwards
it, writes the row's `closed_at`, `close_reason`, and
`usage { seconds, confirmed: true }`, records `usage.seconds` through
`recordVoiceSeconds` in `packages/database/src/models/quota.ts`
— the session row is the idempotency ledger: the seconds land only where none
stand yet, so a report seen by two connections adds nothing — and closes both
ends. The session's one `session.close` is the exchange's, as the
server-controls guide asks one owner per action ("Assign one owner for each
action"): a device hangs up by asking for it, and the relay hands the ask to
the exchange's graceful close, the same one its idle decision runs, which
registers for `session.closed` before it sends and holds the sideband for it
for 15 seconds, the docs' close sequence. Neither the Mac's voice window, nor
its host, nor the relay sends a close of its own; the window stops its
microphone at the hang-up and keeps its peer up for `session.closed` under
the same bound, then closes the peer, which OpenAI ends as `remote_hangup`
where no close reached it. A device socket that goes after a hang-up, or
after a refused frame, asks the same owner once more, which sends nothing
twice. A socket that goes with neither is a
detach (above): nothing is sent, nothing is recorded, and the unconfirmed
snapshot stands until a re-attached connection reads `session.closed`. A
detached session is bounded all the same, since a caller can drop the socket
and keep its WebRTC up with nothing left to send `session.close`: once a
minute the maintenance sweep (`src/voice/orphan-sweep.ts`) takes up to 20
open rows stamped detached more than `VOICE_DETACH_GRACE_MS` (60 seconds)
ago, oldest first and ten at a time, attaches a fresh sideband to each through
the same upstream, sends `session.close` through the same graceful close the
exchange runs, and on `session.closed` writes the close and records the
seconds through the same ledger; each attach and each wait for the final event
is bounded at five seconds. A session OpenAI refuses the attach for as gone
(404 or 410) is closed as `connection_lost` with the last unconfirmed snapshot
standing, so no row is swept twice. Anything less conclusive — an attach that
timed out, was throttled, or failed at OpenAI, or a close never confirmed —
says nothing of whether the call still runs, so the row is left stamped for
the next sweep, unless the session started more than
`VOICE_SESSION_LIMIT_MS` (60 minutes, OpenAI's own duration limit) ago, when it
is closed as `expired`. The sweep answers how many it `closed`, how many were
`lost`, how many stand `pending` for the next sweep, and how many `failed` a
write. A deployment without the voice key sweeps nothing. Every connection
that ends without `session.closed` stamps the row the way a detach does, so
the sweep closes the session and records its seconds unless a device comes
back: a hang-up whose close OpenAI never confirmed within the 15 seconds, a
sideband that ended first (which also closes the device's socket with code
1001 and reason `upstream-closed`), and a session refused after it was
created — its sideband not attached, or its exchange unable to stand. A close
writes only an open row, so a second `session.closed` changes nothing. Only the voice
function and the maintenance sweep write `voice_sessions`; the seconds ledger and it both cascade with
the user row. The seconds ledger meters nothing on its own: a session still
counts one call when it opens.

### Luke's avatar

A call can show Luke on video: a Keyframe Labs avatar, lip-synced to his
voice, at the top of the call's Call tab in the Mac's panel, while the
developer has the Video calls experiment on in Settings › Experimental.
The voice itself is untouched: GPT Live still runs over the Mac's WebRTC and this service's
sideband, and the panel sends Keyframe Luke's synthesized audio straight from the Mac. What
crosses this service is the session alone, as four frames in the service's
own vocabulary on the device socket (`live-contract.ts`), read here and never
forwarded to OpenAI (`frames.ts`): the device's `avatar.start` and
`avatar.stop {reason}`, each naming the request id the Mac's host minted, and
the service's answer to a start, `avatar.started {serverUrl,
participantToken, agentIdentity}` or `avatar.unavailable {reason}`, the id
echoed. `src/voice/avatar.ts` answers them in turn on one fiber of the
session's scope, so a stop right behind its start closes what that start
opened. A start mints a session through `src/voice/keyframe.ts`, one
`POST /v1/sessions` on Keyframe's API under `KEYFRAME_API_KEY` naming the
persona the start asked for: a start names the avatar the Mac chose by its key
(`@luke/features/video-avatar`), never a persona id, and `keyframe.ts` maps
each key to Keyframe's stock persona for it, while a start naming none or the
default mints `LUKE_KEYFRAME_PERSONA_ID` (a stock persona). It hands its grant to
the device socket and nowhere else: a grant joins once, so each start mints
its own and none is kept, and the log keeps only the room's host. The key is
the bearer of that one request. A failure is a fixed kind and Keyframe's
status, never its body: 429 and 503 answer `no_capacity` (every session the
plan allows is standing, and the call goes on as voice), anything else
`error`, and a deployment missing either variable answers `not_configured`
to every start and leaves the voice as it was.

Each session minted is a `voice_avatar_sessions` row (the call's
`voice_sessions` row, the account, the persona, when it started and ended,
whole seconds rounded up, and why it ended), opened only on a voice row the
account owns that is still open, and cascading with either. Keyframe answers
no session id, so the seconds are this side's estimate from start to close,
not Keyframe's meter. A row closes once, whichever close comes first: the
device's stop (`user`, `server_closed`, or `error`, as the Mac reports
it), the next start on the call, since a call holds one avatar, and the
call's end (`call_ended`), at the hang-up or when the voice row closes,
which is written first so a start racing it opens nothing. A close that
missed is the maintenance sweep's to repair: when `orphan-sweep.ts` closes an
orphaned voice row, the avatar rows open on it close behind it as
`orphaned`, and every sweep then closes any avatar row still open on a call
already closed, as of that call's own close.

### How a refusal looks

Before any socket stands, an HTTP status on the upgrade: `401` for
`/api/voice/sessions` without a bearer, `403` for a handshake carrying a
browser `Origin` header (the caller is no page: the desktop connects from
its main process), `503` while
`OPENAI_API_KEY` is absent. Once a socket stands, one frame `{ "error": <reason> }`
in `hostedErrorSchema`'s vocabulary, then a close with code 1008 and the same
reason: `invalid-request` for a first frame that is not a valid `session.create`
or `session.attach`, a create naming no task, or an attach to a session bound
to none; `invalid-token` for a
bearer no account stands behind, and for an attach to a session this account
did not create; `not-found` for a call naming a task the account
does not hold, refused before the session is counted; `upstream-error` when OpenAI refused the
creation or the sideband could not attach; `upstream-throttled` when OpenAI
answered 429.

## The scheduled sweep

`apps/web/server/routes/maintenance/sweep.ts` is what Vercel's cron calls:
the root `vercel.json` schedules it every minute (`* * * * *`) and
`apps/web/server/function-durations.ts` gives its function group, `maintenance-sweep`,
a 60-second duration (`MAINTENANCE_SWEEP.MAX_DURATION_SECONDS` in
`src/maintenance/maintenance-bounds.ts`). The logic lives in
`src/maintenance/maintenance-sweep.ts`; the route, through
`src/maintenance/maintenance-app.ts`, hands it the deployment's seams. Vercel crons run
only on production deployments.

The sweep ends what no request will, and it reads no word of any account.
It runs three things in turn and answers what each did: the purge of
conversations stamped deleted more than thirty days ago, which is what a
deleted task's conversation comes to, counted as `purged`; the sweep over
turns still running past their kind's bound, an hour for one of Luke's turns
and a day and an hour for a coding agent's
(`packages/database/src/models/abandoned-turns.ts`, `TURN_ABANDON.AFTER_MS` and
`TURN_ABANDON.CODING_AGENT_AFTER_MS`), whose end
the relay never heard and which are settled as failed for `abandoned`
through the same write the relay's own end takes, at most fifty a sweep and
counted as `abandoned`; and the bound on a detached voice session described
under "How a session ends", which ends every open session whose device went
without a hang-up more than a minute ago on Luke's key, at most 20 a sweep and
each inside ten seconds, counted as `voice`. A deployment without the OpenAI
key opened no voice session and sweeps none.

It then fires the automations whose schedule is due ("Automations" below),
at most twenty-five a sweep, counted as `automations.fired`, and acts on
the runs still queued from the last hour, at most twelve a sweep and four
at once, counted as `automations.started`, `skipped`, and `failed`.

The sweep needs `CRON_SECRET`, which Vercel sends as the bearer on every
scheduled call once it is set in the project; the same secret is the one the
voice function acts for an account under at eve's door ("The exchange on the
sessions route"). Without it the route answers 503 and the schedule is
simply off, the same kill switch every other hosted endpoint keeps; a wrong
bearer is 401, compared in constant time, and any method but GET is 405.

## The events and maintenance groups

`src/events/events-app.ts` and `src/maintenance/maintenance-app.ts` are two route groups of
one path each — `apps/web/server/routes/events.ts` mounts `eventsApp()` and
`apps/web/server/routes/maintenance/sweep.ts` mounts `maintenanceApp()` — since
the root `vercel.json` already sends each function only the requests for its own path.
Each path is declared with `HttpRouter.add` under `ANY_METHOD` rather than a
method-specific builder, because each handler still enforces its own method
and answers its own 405 exactly as it did before conversion; only a path
neither declares reaches the group's own wildcard route, `hostedNotFoundRoute`,
and the hosted vocabulary's `not-found`. Each handler's own logic is carried
unchanged — `src/events/events.ts` and `src/maintenance/maintenance-sweep.ts` —
behind a passthrough shaped like the auth group's (`effectPassthrough` in
`src/http/http-effect.ts`): the `HttpServerRequest` becomes the `Request`
the handler always took, and its `Response` is carried back with
`HttpServerResponse.raw`.
`src/events/events-app.ts` holds one query of its own, the events handler's
PostHog person read (`readPerson`), a `SqlSchema` query whose builder renders
against the auth schema module and runs on the ambient `SqlClient`.
