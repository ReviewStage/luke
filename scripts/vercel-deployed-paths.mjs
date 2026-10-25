// vercel-deployed-paths.mjs -- the workspaces the Vercel deployment installs and builds from, as git pathspecs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every field pnpm's `--filter <service>...` follows to a workspace.
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const WORKSPACE_PROTOCOL = "workspace:";
// What a workspace holds that no build reads: its documents, its tests, and
// their fixtures and goldens. Note that `testing/` is not among them, because
// a service imports from it (`apps/dev` runs the scripted model).
const UNSHIPPED = [
  "**/*.md",
  "**/*.test.*",
  "**/__tests__/**",
  "**/__fixtures__/**",
  "fixtures/**",
  "tests/**",
];

/** The `packages:` globs of `pnpm-workspace.yaml`, read as the one flat list it is. */
function workspaceGlobs(root) {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "packages:");
  if (start < 0) throw new Error("pnpm-workspace.yaml names no packages");
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^\s+-\s+["']?([^"'#]+?)["']?\s*$/.exec(line);
    if (!entry) break;
    globs.push(entry[1]);
  }
  return globs;
}

/** Every workspace directory, from the root, that holds a `package.json`. */
function workspaceDirectories(root, globs) {
  const directories = [];
  for (const glob of globs) {
    if (glob.includes("*") && !/^[^*]+\/\*$/.test(glob)) {
      throw new Error(`pnpm-workspace.yaml glob ${glob} is not one this script reads`);
    }
    const parents = glob.endsWith("/*")
      ? readdirSync(join(root, glob.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
      : [glob];
    directories.push(...parents.filter((dir) => existsSync(join(root, dir, "package.json"))));
  }
  return directories;
}

function readManifest(root, dir) {
  return JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
}

/** The workspaces the deployment's services sit in, from `vercel.json`'s own `services`. */
function serviceRoots(root) {
  const services = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).services ?? {};
  const roots = Object.values(services).map((service) => service.root);
  if (roots.length === 0 || roots.some((dir) => typeof dir !== "string")) {
    throw new Error("vercel.json names no service roots");
  }
  return roots;
}

/** The service roots and every workspace they reach through a `workspace:` dependency. */
function deployedWorkspaces(root) {
  const directories = workspaceDirectories(root, workspaceGlobs(root));
  const byName = new Map(directories.map((dir) => [readManifest(root, dir).name, dir]));
  const reached = new Set();
  const pending = serviceRoots(root);
  while (pending.length > 0) {
    const dir = pending.pop();
    if (reached.has(dir)) continue;
    if (!directories.includes(dir)) throw new Error(`service root ${dir} is no workspace`);
    reached.add(dir);
    const manifest = readManifest(root, dir);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (!String(version).startsWith(WORKSPACE_PROTOCOL)) continue;
        const dependency = byName.get(name);
        if (dependency === undefined) throw new Error(`${dir} depends on ${name}, no workspace`);
        pending.push(dependency);
      }
    }
  }
  return [...reached].sort();
}

// Note that a tree this cannot read says why on one line and exits 1, which
// the ignore step reads as a doubt and builds.
const root = process.argv[2] ?? process.cwd();
try {
  const paths = deployedWorkspaces(root).flatMap((dir) => [
    `:/${dir}`,
    ...UNSHIPPED.map((pattern) => `:(top,exclude,glob)${dir}/${pattern}`),
  ]);
  process.stdout.write(`${paths.join("\n")}\n`);
} catch (error) {
  process.stderr.write(
    `vercel-deployed-paths: ${error instanceof Error ? error.message : error}\n`,
  );
  process.exitCode = 1;
}
