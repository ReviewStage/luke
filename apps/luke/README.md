# Luke, the orchestrator

`apps/luke` (`@luke/luke`) is Luke's planning brain as a flat, standalone eve app
root: its own `package.json`, whose one runtime dependency eve cares about is
`eve`, its own `tsconfig.json`, and its evals under `evals/`. It is the
`luke` service of the deployment (the root `vercel.json`), mounted at eve's
own `/eve/v1/*`.

The layout is load-bearing for the deployment. eve resolves the directory
that holds `agent.ts` and declares `eve` as its app root, and writes its build
output there (`.vercel/output` under Vercel, `.output` locally). So the
service's root is `apps/luke`, and its build command is a plain
`pnpm exec eve build`, run by static-build in that root and read back from it.
A directory named `agent` would resolve as eve's nested layout instead, with
the app root one level up from where the service reads the output.

The agent reaches nothing of `apps/web`. Its effects run on its own runtime
edge, `runtime.ts`, built over `@luke/service/runtime`'s layer, so
`pnpm install --filter @luke/luke...` pulls only what it declares, and the web
build never traces into it.

`sandbox.ts` is the session's sandbox, a `VercelSandbox.environment` whose
`prepare` holds the one thing the checkout needs of eve's base image, git.
`eve build` prewarms its snapshot on Vercel, so the service's build needs
Vercel Sandbox credentials (the build's own `VERCEL_OIDC_TOKEN`, or
`VERCEL_TOKEN` with `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`), and a prewarm
that fails stops the deployment. Locally, `eve build --skip-sandbox-prewarm`
compiles it without them. The running service needs the GitHub App's five
variables and `BETTER_AUTH_SECRET`, as the web functions do:
`run_in_repository`'s checkout confirms the plan's repository is reachable
and mints its token through `GitHubApp`, which the shared layer builds from
them (`@luke/service/runtime`, `githubAppFromEnvironment`). The session secret
is what the account's user token is sealed under.

## Evals

`evals/brain-host.eval.ts` is the planning brain's end-to-end eval, and
nothing runs it unasked. `./scripts/check.sh` runs vitest over the workspaces
`vitest.config.ts` lists, and `@luke/luke` is not one of them. The eval is
`pnpm --filter @luke/luke test:agent` (or `pnpm --filter @luke/web test:agent`
for every agent's). It writes through the real store writer against the
database `DATABASE_URL` names, migrated with `pnpm --filter @luke/web
db:migrate`. CI doesn't run it either, so run it by hand before a change to
the brain host, the writer, or a schema module it reads back through.
