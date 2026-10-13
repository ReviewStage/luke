// turbo.mjs -- turbo, with the remote cache token kept out of every task's environment.

import { spawnSync } from "node:child_process";

import { turboInvocation } from "./lib/turbo.mjs";

// CI's test jobs start turbo through here; `lib/turbo.mjs` says why the
// token travels on the command line.
const turbo = turboInvocation(process.argv.slice(2));
const run = spawnSync(turbo.command, turbo.args, { stdio: "inherit", env: turbo.env });
process.exitCode = run.status ?? 1;
