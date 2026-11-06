import { spawn, spawnSync } from "node:child_process";

import { ROOT_TASKS, TEST_TASK, turboInvocation, WORKSPACE_TASKS } from "./lib/turbo.mjs";

const CHECKS = [...ROOT_TASKS, ...WORKSPACE_TASKS, "test"];
const WITHOUT_FLAG = "--without";
const AFFECTED_FLAG = "--affected";
const AFFECTED_BASE = "origin/main";

function parseArguments(argv) {
  const without = [];
  let affected = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === AFFECTED_FLAG) {
      affected = true;
    } else if (argv[index] === WITHOUT_FLAG && index + 1 < argv.length) {
      index += 1;
      without.push(argv[index]);
    } else {
      return { error: `error: no such argument: ${argv[index]}` };
    }
  }
  const unknown = without.filter((check) => !CHECKS.includes(check));
  if (unknown.length > 0) {
    return { error: `error: ${WITHOUT_FLAG} names no such check: ${unknown.join(", ")}` };
  }
  return { without, affected };
}

function affectedBase(env) {
  if (env.TURBO_SCM_BASE) return env.TURBO_SCM_BASE;
  const known = spawnSync("git", ["rev-parse", "--verify", "--quiet", AFFECTED_BASE]);
  return known.status === 0 ? AFFECTED_BASE : undefined;
}

function listWorkspaces(args, env) {
  const turbo = turboInvocation(["ls", ...args, "--output=json"], env);
  const listed = spawnSync(turbo.command, turbo.args, { env: turbo.env, encoding: "utf8" });
  if (listed.status !== 0) {
    throw new Error(`turbo ls failed:\n${listed.stderr}`);
  }
  return JSON.parse(listed.stdout).packages.items;
}

function affectedFilters() {
  const base = affectedBase(process.env);
  const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
  const affected = listWorkspaces([AFFECTED_FLAG], env);
  return affected.map((workspace) => `--filter=...${workspace.name}`).sort();
}

function runTurbo(label, args, { held }) {
  return new Promise((resolve) => {
    const chunks = [];
    const turbo = turboInvocation(["run", ...args]);
    const env = { ...turbo.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" };
    const child = spawn(turbo.command, turbo.args, {
      stdio: held ? ["ignore", "pipe", "pipe"] : "inherit",
      env,
    });
    child.stdout?.on("data", (chunk) => chunks.push(chunk));
    child.stderr?.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (status) => {
      if (held) {
        process.stdout.write(
          `\n=== ${label} (${status === 0 ? "passed" : `exit ${status}`}) ===\n`,
        );
        process.stdout.write(Buffer.concat(chunks));
      }
      resolve(status === 0);
    });
  });
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed.error) {
  process.stderr.write(`${parsed.error}\n`);
  process.exit(2);
}
const scope = parsed.affected ? affectedFilters() : [];
const anyWorkspace = !parsed.affected || scope.length > 0;
if (!anyWorkspace) {
  process.stdout.write(`No workspace changed since ${affectedBase(process.env) ?? "main"}.\n`);
}
const rootTasks = ROOT_TASKS.filter((task) => !parsed.without.includes(task));
const workspaceTasks = WORKSPACE_TASKS.filter((task) => !parsed.without.includes(task));
const runs = [];
if (rootTasks.length > 0) {
  runs.push({ label: rootTasks.join(", "), args: rootTasks });
}
if (anyWorkspace && workspaceTasks.length > 0) {
  runs.push({ label: workspaceTasks.join(", "), args: [...workspaceTasks, ...scope] });
}
if (anyWorkspace && !parsed.without.includes("test")) {
  runs.push({ label: "test", args: [TEST_TASK, "--concurrency=1", ...scope] });
}

const results = await Promise.all(runs.map((run) => runTurbo(run.label, run.args, { held: true })));
const failed = runs.filter((_, index) => !results[index]);
if (failed.length > 0) {
  process.stderr.write(`\nerror: ${failed.map((run) => run.label).join("; ")} failed\n`);
  process.exitCode = 1;
}
