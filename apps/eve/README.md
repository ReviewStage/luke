# The agents' eve workspace

`apps/eve` (`@luke/eve`) is an eve agent workspace: one package, one
`tsconfig.json`, and one member per separately addressable agent under
`agents/<name>/`. Members have no `package.json` of their own (eve excludes a
directory that has one from workspace discovery) and share this package's
dependencies, scripts, and Vercel deployment. Each member uses eve's flat
layout, its agent files directly under `agents/<name>/`, with its evals in
`agents/<name>/evals/`.

| Member | Agent | Public mount |
| --- | --- | --- |
| `luke` | Luke's planning brain, the agent the developer talks a plan through with | `/eve/luke/v1/*` |
| `dev` | The coding agent, a run in a sandbox on the plan's repository | `/eve/dev/v1/*` |

`runtime.ts` is the agents' runtime edge: each member's authored files run
their effects through its `runAgent`, on a runtime built over
`@luke/service/runtime`'s layer, and reach nothing of `apps/web`. Each member
deploys as its own service, so each holds its own copy of that runtime.

## How it deploys

The root `vercel.ts` passes its configuration through `withEve` from
`eve/vercel`, with this directory as the workspace root, and `withEve` adds
one independently built service per member, named `eve-<member>`, with the
public routes to its mount. That is why `eve` is also a dependency of the
repository root: Vercel imports `eve/vercel` while it evaluates `vercel.ts`.
eve 0.74 computes a generated service's `root` from the workspace root rather
than from the configuration file, so `vercel.ts` puts `apps/eve/` in front of
it, and gives each generated service the install and ignore rules the
website's services carry; `apps/web/tests/vercel-services.test.ts` holds every
service's root to a directory that exists.

A generated service's routes turn `/eve/<member>/v1/*` back into `/eve/v1/*`
before the member reads a request, so the member's door
(`packages/service/src/agents/brain-host/door.ts`, `auth.ts`) spells the paths
it sees as `/eve/v1/*` while callers address the public mount
(`brain-host/eve-sessions.ts`'s `EVE_MOUNT`). Each agent's mount from before
the workspace still routes to its service for the sessions already running and
their eve callbacks: Luke's `/eve/v1/*`, read as it stands, and the coding
agent's `/eve/coder/v1/*`, which `vercel.ts` adds to `eve-dev`'s routes so it is
turned back into `/eve/v1/*` too. A coding agent's turn runs for up to
twenty-five hours, so they stand until the turns begun on them are over.

`agents/luke/sandbox.ts` (and `agents/dev/sandbox.ts`, the coding agent's
checkout) is the session's sandbox, a
`VercelSandbox.environment` whose `prepare` holds the one thing the checkout
needs of eve's base image, git; `eve build` prewarms its snapshot on Vercel,
so the member's build needs Vercel Sandbox credentials (the build's own
`VERCEL_OIDC_TOKEN`, or `VERCEL_TOKEN` with `VERCEL_TEAM_ID` and
`VERCEL_PROJECT_ID`) and a prewarm that fails stops the deployment. Locally,
`eve build --skip-sandbox-prewarm` compiles a member without them. The running
service needs the GitHub App's five variables and `BETTER_AUTH_SECRET` as the
web functions do: `run_in_repository`'s checkout confirms the plan's
repository is reachable and mints its token through `GitHubApp`, which the
shared layer builds from them (`@luke/service/runtime`,
`githubAppFromEnvironment`), the session secret being what the account's user
token is sealed under.

## Evals

`agents/luke/evals/brain-host.eval.ts` is the planning brain's end-to-end
eval, and `agents/dev/evals/coder.eval.ts` the coding agent's; nothing local
runs them unasked. `./scripts/check.sh` runs vitest over
the workspaces `vitest.config.ts` lists, and `@luke/eve` is not one of them;
`pnpm --filter @luke/eve test:agent` runs both (`eve eval --agent luke` and
`--agent dev`, each on a scripted model), as does `pnpm --filter @luke/web
test:agent`, and each writes through the real store writer against the database
`DATABASE_URL` names, migrated (`pnpm --filter @luke/web db:migrate`). CI does
not run them either, so run them by hand before a change to an agent's host,
the writer, or a schema module they read back through.
