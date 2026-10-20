/**
 * coder-tool-files.test.ts -- the coding agent's tool files offer exactly its tools, and a file that needs no host bundles none of it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { bundleAuthoredModuleCode } from "../../../node_modules/eve/dist/src/internal/authored-module-loader.js";
import { CODER_TOOL } from "../coder-host/tool-set.js";
import { AGENT_EXTERNAL_DEPENDENCIES } from "./build.js";

const CODER_ROOT = fileURLToPath(new URL("../../../../../apps/dev/", import.meta.url));

/** The coding agent's tool directories: its own, and its worker's. */
const TOOL_DIRECTORIES = ["tools", "subagents/worker/tools"] as const;

/** The packages that are the store and the auth service, which only the host's own files reach. */
const HOST_RUNTIME_PACKAGES = ["better-auth", "drizzle-orm", "pg"] as const;

/** The files of one tool directory, by their path from the agent's root. */
function toolFiles(directory: string): readonly string[] {
  return readdirSync(`${CODER_ROOT}${directory}`)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}

/** The packages a bundle imports, each by the name of its directory under `node_modules`. */
function packagesImported(code: string): ReadonlySet<string> {
  const specifiers = [...code.matchAll(/\bfrom\s*"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"/gu)].map(
    ([, from, bare]) => from ?? bare ?? "",
  );
  const packages = specifiers.map((specifier) => {
    const directories = [...specifier.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//gu)];
    return directories.at(-1)?.[1] ?? specifier;
  });
  return new Set(packages);
}

/**
 * eve names a tool by its file, so the files are the set the agent is
 * offered, and the store writer registers that set; a file added, renamed,
 * or dropped without the other moving with it leaves a transcript naming a
 * tool the writer refuses, or a tool no file offers.
 */
test("the coding agent's tool files offer each of its tools once, and nothing else", () => {
  const offered = toolFiles("tools")
    .map((file) => basename(file, ".ts"))
    .sort();

  expect(offered).toEqual(Object.values(CODER_TOOL).sort());
});

/**
 * eve bundles and evaluates each authored file on its own as it builds, so
 * a tool that needs nothing of the host but reaches the store or the auth
 * service through a constant it imports carries that runtime into its
 * bundle and runs it at build time, as `bash` once did through the
 * checkout's path. Only a file that runs through the host may reach them.
 */
test("a tool file that runs nothing through the host bundles neither the store nor the auth service", async () => {
  const reaching: string[] = [];
  for (const file of TOOL_DIRECTORIES.flatMap(toolFiles)) {
    if (readFileSync(`${CODER_ROOT}${file}`, "utf8").includes("host.js")) continue;
    const code = await bundleAuthoredModuleCode(`${CODER_ROOT}${file}`, {
      externalDependencies: AGENT_EXTERNAL_DEPENDENCIES,
    });
    const imported = packagesImported(code);
    reaching.push(
      ...HOST_RUNTIME_PACKAGES.filter((name) => imported.has(name)).map(
        (name) => `${file}: ${name}`,
      ),
    );
  }

  expect(reaching).toEqual([]);
}, 120_000);
