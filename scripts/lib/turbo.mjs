const PLATFORM = `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`;

export const ROOT_TASKS = ["lint", "discarded-effect"];

export const WORKSPACE_TASKS = ["typecheck"];

export const TEST_TASK = "test:vitest";

export function turboInvocation(args, env = process.env) {
  const { TURBO_TOKEN: token, ...rest } = env;
  const tokenArguments = token ? [`--token=${token}`] : [];
  const passThrough = args.includes("--") ? args.indexOf("--") : args.length;
  return {
    command: "pnpm",
    args: [
      "exec",
      "turbo",
      ...args.slice(0, passThrough),
      ...tokenArguments,
      ...args.slice(passThrough),
    ],
    env: { ...rest, APP_TURBO_PLATFORM: PLATFORM, TURBO_TELEMETRY_DISABLED: "1" },
  };
}
