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
