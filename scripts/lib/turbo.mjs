// turbo.mjs -- the task names the checks run through Turborepo, and how turbo is started.

/** The platform a task ran on, as far as its result can depend on it. */
const PLATFORM = `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`;

/**
 * The checks that read the whole repository in one program, each one root
 * task (`//#lint` and its siblings in `turbo.json`). Note that turbo counts a
 * file as changing the workspace it sits in and never the root, so
 * `--affected` would skip these for every change inside a workspace; they
 * are never scoped, and their hash, which covers every tracked file, is what
 * decides whether they run.
 */
export const ROOT_TASKS = ["lint", "discarded-effect"];

/** The checks that run once per workspace. */
export const WORKSPACE_TASKS = ["typecheck"];

/**
 * The tests, one task per workspace holding a `vitest.config.ts`. CI cuts the
 * largest suites into vitest shards on runners of their own
 * (`.github/workflows/ci.yml`), and `scripts/repository-checks.sh` refuses a
 * workspace whose tests are under no task of this name.
 */
export const TEST_TASK = "test:vitest";

/**
 * The command line and environment that start turbo with `args`. Note that
 * we hand the remote cache token to turbo as `--token` and drop it from the
 * environment, because in strict environment mode turbo still passes its own
 * `TURBO_TOKEN` through to every task, and a task's output is a cache
 * artifact: a task that printed its environment would store the token in a
 * log replayed to every machine that hits the hash. With `--token` no task
 * ever sees it. Without a token turbo uses the local cache alone.
 *
 * Note also that we name the platform in `LUKE_TURBO_PLATFORM`, which
 * `turbo.json` hashes through `globalEnv`, because turbo's own hash covers no
 * OS, CPU architecture, or Node version: without it a check that passed on
 * Linux would replay as a pass on a Mac. A bare `turbo` started past this
 * function carries no tag.
 */
export function turboInvocation(args, env = process.env) {
  const { TURBO_TOKEN: token, ...rest } = env;
  const tokenArguments = token ? [`--token=${token}`] : [];
  return {
    command: "pnpm",
    args: ["exec", "turbo", ...args, ...tokenArguments],
    env: { ...rest, LUKE_TURBO_PLATFORM: PLATFORM, TURBO_TELEMETRY_DISABLED: "1" },
  };
}
