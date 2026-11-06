import { spawnSync } from "node:child_process";

import { turboInvocation } from "./lib/turbo.mjs";

const turbo = turboInvocation(process.argv.slice(2));
const run = spawnSync(turbo.command, turbo.args, { stdio: "inherit", env: turbo.env });
process.exitCode = run.status ?? 1;
