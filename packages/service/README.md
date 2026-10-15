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
