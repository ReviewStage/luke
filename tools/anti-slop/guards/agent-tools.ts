import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadModule, type RepositoryGuard, readJson, record, setDrift, texts } from "./guard.ts";

/**
 * agent-tools.ts -- the coding agent's tool files and the registry agree, and eve can build each one.
 *
 * eve names a tool by its file, so the files under `apps/dev/tools` are the
 * set the agent is offered, and the store writer registers `CODER_TOOL`; a
 * file added, renamed, or dropped without the other leaves a transcript
 * naming a tool the writer refuses. eve bundles and evaluates each authored
 * file alone as it builds, so a tool that runs nothing through the host but
 * reaches the store or the auth service carries that runtime into its
 * bundle and runs it at build time; it hoists a dynamic tool's callbacks out
 * of their file and keeps the locals they read as JSON, so one that reads a
 * local is refused on every turn; and it refuses an external dependency the
 * agent's `package.json` does not declare. Each fails only the hosted build.
 */

const CODER_ROOT = "apps/dev";
const SERVICE = "packages/service";
const EVE_INTERNAL = `${SERVICE}/node_modules/eve/dist/src/internal`;

/** The coding agent's tool directories: its own, and its worker's. */
const TOOL_DIRECTORY = { AGENT: "tools", WORKER: "subagents/worker/tools" } as const;

/** The packages that are the store and the auth service, which only the host's own files reach. */
const HOST_RUNTIME_PACKAGES = ["better-auth", "drizzle-orm", "pg"] as const;

/**
 * A resolver whose tool's `execute` reads a local of its file, as
 * `commentToolFor` once did: the check must catch it, so a change in how eve
 * writes what it keeps fails here rather than passing unseen.
 */
const CAPTURING_RESOLVER = `import { defineDynamic, defineTool } from "eve/tools";
export function toolFor(tool) {
  return defineDynamic({
    events: {
      "turn.started": async () =>
        defineTool({ description: "d", inputSchema: {}, execute: async () => tool.name }),
    },
  });
}
`;

/** The packages a bundle imports, each by the name of its directory under `node_modules`. */
export function packagesImported(code: string): ReadonlySet<string> {
  const specifiers = [...code.matchAll(/\bfrom\s*"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"/gu)].map(
    ([, from, bare]) => from ?? bare ?? "",
  );
  return new Set(
    specifiers.map((specifier) => {
      const directories = [...specifier.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//gu)];
      return directories.at(-1)?.[1] ?? specifier;
    }),
  );
}

/** The locals eve's transform keeps beside a tool's callbacks, as `const { … } = __vars;`. */
export function keptLocals(transformed: string): readonly string[] {
  return [...transformed.matchAll(/const (\{[^}]*\}) = __vars;/gu)].map(
    ([, locals = ""]) => locals,
  );
}

/** The external dependencies the agent's manifest does not declare. */
export function undeclared(
  external: readonly string[],
  dependencies: Readonly<Record<string, unknown>>,
): readonly string[] {
  return external.filter((name) => dependencies[name] === undefined);
}

/** The `.ts` files of one tool directory, by their path from the agent's root. */
function toolFiles(root: string, directory: string): readonly string[] {
  return readdirSync(path.join(root, CODER_ROOT, directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}

function toolNames(files: readonly string[]): readonly string[] {
  return files.map((file) => path.basename(file, ".ts"));
}

type Bundle = (
  file: string,
  options: { externalDependencies: readonly string[] },
) => Promise<string>;
type Transform = (file: string, source: string) => Promise<{ code: string } | null | undefined>;

async function eveInternals(root: string): Promise<{ bundle: Bundle; transform: Transform }> {
  const loader = await loadModule(root, `${EVE_INTERNAL}/authored-module-loader.js`);
  const dynamic = await loadModule(
    root,
    `${EVE_INTERNAL}/workflow-bundle/dynamic-tool-transform.js`,
  );
  if (typeof loader.bundleAuthoredModuleCode !== "function")
    throw new Error("eve no longer exports bundleAuthoredModuleCode");
  if (typeof dynamic.transformDynamicToolExecute !== "function")
    throw new Error("eve no longer exports transformDynamicToolExecute");
  return {
    bundle: loader.bundleAuthoredModuleCode as Bundle,
    transform: dynamic.transformDynamicToolExecute as Transform,
  };
}

async function toolProblems(root: string): Promise<readonly string[]> {
  const toolSet = await loadModule(root, `${SERVICE}/src/agents/coder-host/tool-set.ts`);
  const tools = await loadModule(root, `${SERVICE}/src/agents/agent-runtime/tools.ts`);
  const role = await loadModule(root, `${SERVICE}/src/agents/agent-runtime/role.ts`);
  const build = await loadModule(root, `${SERVICE}/src/agents/agent-runtime/build.ts`);
  const external = texts(build.AGENT_EXTERNAL_DEPENDENCIES, "AGENT_EXTERNAL_DEPENDENCIES");
  const worker = record(role.AGENT_ROLE, "AGENT_ROLE").CODER_WORKER;
  if (typeof tools.toolsOf !== "function") throw new Error("toolsOf is not a function");
  const agentFiles = toolFiles(root, TOOL_DIRECTORY.AGENT);
  const workerFiles = toolFiles(root, TOOL_DIRECTORY.WORKER);
  const problems = [
    ...setDrift(
      `${CODER_ROOT}/${TOOL_DIRECTORY.AGENT} against CODER_TOOL`,
      toolNames(agentFiles),
      texts(Object.values(record(toolSet.CODER_TOOL, "CODER_TOOL")), "CODER_TOOL"),
    ),
    ...setDrift(
      `${CODER_ROOT}/${TOOL_DIRECTORY.WORKER} against the worker's tools`,
      toolNames(workerFiles),
      texts(tools.toolsOf(worker), "toolsOf(CODER_WORKER)"),
    ),
    ...undeclared(
      external,
      record(readJson(root, `${CODER_ROOT}/package.json`).dependencies, "dependencies"),
    ).map(
      (name) =>
        `${CODER_ROOT}/package.json: AGENT_EXTERNAL_DEPENDENCIES names ${name}, which it does not declare`,
    ),
  ];
  const eve = await eveInternals(root);
  const canary = await eve.transform("capturing.ts", CAPTURING_RESOLVER);
  if (keptLocals(canary?.code ?? "").length === 0)
    problems.push(
      "eve's dynamic tool transform no longer writes the locals it keeps as this guard reads them",
    );
  for (const file of [...agentFiles, ...workerFiles, "host.ts"]) {
    const absolute = path.join(root, CODER_ROOT, file);
    const source = readFileSync(absolute, "utf8");
    if (source.includes("defineDynamic(")) {
      const transformed = await eve.transform(file, source);
      for (const locals of keptLocals(transformed?.code ?? ""))
        problems.push(
          `${CODER_ROOT}/${file}: a dynamic tool's callback keeps ${locals}, which eve refuses`,
        );
    }
    if (file === "host.ts" || source.includes("host.js")) continue;
    const imported = packagesImported(
      await eve.bundle(absolute, { externalDependencies: external }),
    );
    for (const name of HOST_RUNTIME_PACKAGES.filter((one) => imported.has(one)))
      problems.push(`${CODER_ROOT}/${file}: runs nothing through the host and bundles ${name}`);
  }
  return problems;
}

export const agentToolsGuard: RepositoryGuard = {
  holds:
    "the coding agent's tool files are its registered tools, each of which eve can build, keeping no local and reaching no host runtime it does not run through",
  problems: toolProblems,
};
