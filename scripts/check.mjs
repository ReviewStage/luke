import { spawn } from "node:child_process";

// The four checks are independent of one another and of the build, so they
// run at once; the build follows because it is the one step that reads what
// typecheck and the tests have vouched for. Each check's output is held and
// printed whole when it ends, so two failing checks never interleave.
// CI runs the tests in its own sharded jobs beside this one, so it asks for
// everything but them with `--without test`; the local check still runs all.
const CONCURRENT_CHECKS = ["lint", "knip", "typecheck", "test"];
const WITHOUT_FLAG = "--without";
const withoutIndex = process.argv.indexOf(WITHOUT_FLAG);
const without = withoutIndex === -1 ? [] : process.argv.slice(withoutIndex + 1);
const unknown = without.filter((script) => !CONCURRENT_CHECKS.includes(script));
if (unknown.length > 0) {
  process.stderr.write(`error: ${WITHOUT_FLAG} names no such check: ${unknown.join(", ")}\n`);
  process.exit(2);
}
const checks = CONCURRENT_CHECKS.filter((script) => !without.includes(script));

function runScript(script) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn("pnpm", ["run", script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (status) => {
      process.stdout.write(`\n=== ${script} (${status === 0 ? "passed" : `exit ${status}`}) ===\n`);
      process.stdout.write(Buffer.concat(chunks));
      resolve(status === 0);
    });
  });
}

const results = await Promise.all(checks.map(runScript));
const failed = checks.filter((_, index) => !results[index]);
if (failed.length > 0) {
  process.stderr.write(`\nerror: ${failed.join(", ")} failed\n`);
  process.exit(1);
}

const build = spawn("pnpm", ["run", "build"], { stdio: "inherit" });
build.on("close", (status) => process.exit(status ?? 1));
