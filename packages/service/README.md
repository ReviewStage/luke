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
server (`apps/web/server/hosted/github-integration.ts`); a token within a minute of its expiry
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
(`apps/web/server/hosted/repository-shell.ts`), and the File tab, the tree, and the skills
beside it. `repositoryPullRequestToken` adds `pull_requests: read` and
`repositoryWriteToken` cuts contents and pull requests write, each with CI
read beside it where the installation grants it; `appBot(token)` reads the
App's bot user (`GET /users/<slug>[bot]`) on a token already minted, which
is who a coding agent's commits are by. A plan's repository is reached
through its plan's workspace, read afresh at each use, so a disconnect or a
replaced installation decides the very next read.

`GET /api/github/repositories` (`apps/web/server/github-repositories-app.ts`) is that
listing under the account bearer, answered as
`packages/features/src/github-repositories-wire.ts` declares it: `installed`,
whether the workspace has an installation connected, `repositories` (owner,
name, full name, default branch, private, and when GitHub last saw it
change), and `installationUrl`. Nothing is stored. A `workspaceId` query
names the workspace the listing is for, to a member of it; none named is the
account's first workspace. One the account is not in is `not-found`
(404), and the query given twice is `invalid-request`. A GitHub or a store
the service could not reach is `unavailable`.
`apps/web/tests/github-repositories-app.test.ts` holds the route and
`src/github/github-app.test.ts` the reads beneath it, over
`src/testing/github-app-fake.ts`.

Installing the App is browser navigations in `apps/web/server/github-install-app.ts`,
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

The App's webhook is `POST /api/github/webhook` (`apps/web/server/github-webhook-app.ts`),
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
provider tokens. `apps/web/tests/github-webhook-app.test.ts`
holds it over a scripted GitHub and PGlite.

A Preview's GitHub sign-in still goes through production's OAuth proxy, and
production is the end that exchanges the code, under its own provider
client: a Preview carrying the App's client id can complete a sign-in only
while production's `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`
hold the App's client id and secret, a Vercel project setting rather than anything in
this repository. Nothing on the branch is Preview-specific.
