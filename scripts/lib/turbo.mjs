// turbo.mjs -- the task names the checks run through Turborepo, and how turbo is started.

/**
 * The checks that read the whole repository in one program, each one root
 * task (`//#lint` and its siblings in `turbo.json`). Note that turbo counts a
 * file as changing the workspace it sits in and never the root, so
 * `--affected` would skip these for every change inside a workspace; they
 * are never scoped, and their hash, which covers every tracked file, is what
 * decides whether they run.
 */
export const ROOT_TASKS = ["lint", "knip", "discarded-effect"];

/** The checks that run once per workspace. */
export const WORKSPACE_TASKS = ["typecheck"];

/**
 * The tests, one task per workspace holding a `vitest.config.ts`, except that
 * @luke/service's suite, the largest, is cut into three shards so CI can run
 * them on three runners. `scripts/repository-checks.sh` refuses a
 * workspace whose tests are under none of these names.
 */
export const TEST_TASKS = ["test:vitest", "test:vitest:1", "test:vitest:2", "test:vitest:3"];

/**
 * The command line and environment that start turbo with `args`. Note that
 * we hand the remote cache token to turbo as `--token` and drop it from the
 * environment, because in strict environment mode turbo still passes its own
 * `TURBO_TOKEN` through to every task, and a task's output is a cache
 * artifact: a task that printed its environment would store the token in a
 * log replayed to every machine that hits the hash. With `--token` no task
 * ever sees it. Without a token turbo uses the local cache alone.
 */
export function turboInvocation(args, env = process.env) {
  const { TURBO_TOKEN: token, ...rest } = env;
  const tokenArguments = token ? [`--token=${token}`] : [];
  return {
    command: "pnpm",
    args: ["exec", "turbo", ...args, ...tokenArguments],
    env: { ...rest, TURBO_TELEMETRY_DISABLED: "1" },
  };
}
