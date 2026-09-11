import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { FunctionDefinition } from "./function-durations.js";
import { stubPath } from "./function-stubs.js";

/**
 * The Build Output the web app's build leaves for Vercel: `.vercel/output`
 * with the site under `static/` and one `.func` directory per function. When
 * a build writes this tree, `@vercel/static-build` adopts it as the
 * deployment's final form instead of serving `dist/` and detecting nothing
 * else (`packages/static-build/src/index.ts`, the Build Output v3 branch
 * after the build command), so this is what deploys under the Vite preset
 * today and what the `web` service of a services deployment deploys later,
 * where Vercel builds no `api/` at all.
 *
 * A `.func` is a filesystem mount: what is under it deploys and nothing above
 * it does, so each function's bundle is inlined whole (`function-bundles.ts`)
 * and the directory holds the one file. The platform runs that file itself:
 * `.vc-config.json` names it as `handler` under the Node launcher, the same
 * fields Vercel's own Node builder writes for a function it built
 * (`packages/node/src/build.ts`, the `NodejsLambda` it returns), so the
 * launcher that adapts a `{ fetch }` route object and the voice functions'
 * exported `http.Server` is the platform's, unchanged.
 */
export const BUILD_OUTPUT_DIRECTORY = join(".vercel", "output");
const BUILD_OUTPUT_VERSION = 3;
/** Vercel's runtime for the Node this app's `engines` names (`@vercel/build-utils`'s node-version table). */
const FUNCTION_RUNTIME = "nodejs24.x";
const FUNCTION_ENTRY = "index.mjs";
const FUNCTIONS_DIRECTORY = "functions";
const STATIC_DIRECTORY = "static";
const FUNCTION_DIRECTORY_SUFFIX = ".func";
const FUNCTION_CONFIG_FILE = ".vc-config.json";

/** What Vercel's Node builder sets on every function it builds, and this build sets the same way. */
const NODE_LAUNCHER = {
  launcherType: "Nodejs",
  shouldAddHelpers: true,
} as const;

/** A function written by hand rather than bundled from `server/routes/`. */
export interface HandWrittenFunction {
  /** The module, relative to the web app; plain ESM the launcher runs as it stands. */
  readonly source: string;
  /** Its public path, which is the URL it answers on. */
  readonly path: string;
}

/** The one hand-written function: the feedback courier the desktop posts to. */
export const HAND_WRITTEN_FUNCTIONS: readonly HandWrittenFunction[] = [
  { source: posix.join("api", "feedback.mjs"), path: posix.join("api", "feedback.mjs") },
];

/** A function as the tree emits it: its public path, its entry's contents, and the bound it runs under. */
export interface EmittedFunction {
  readonly path: string;
  readonly contents: Uint8Array | string;
  /** The bound the plan gave the function; undefined leaves the platform's default. */
  readonly maxDuration: number | undefined;
}

export interface FunctionConfig {
  readonly runtime: typeof FUNCTION_RUNTIME;
  readonly handler: typeof FUNCTION_ENTRY;
  readonly launcherType: typeof NODE_LAUNCHER.launcherType;
  readonly shouldAddHelpers: typeof NODE_LAUNCHER.shouldAddHelpers;
  readonly maxDuration?: number;
}

/** The public path a bundled function answers on: the same path its rewrites name. */
export function functionPublicPath(definition: FunctionDefinition): string {
  return stubPath(definition);
}

/** The `.func` directory of a function under the output root. */
export function functionDirectory(outputDirectory: string, path: string): string {
  return join(outputDirectory, FUNCTIONS_DIRECTORY, `${path}${FUNCTION_DIRECTORY_SUFFIX}`);
}

export function functionConfigPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_CONFIG_FILE);
}

export function functionEntryPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_ENTRY);
}

/** The configuration a function is deployed with; a duration is written only where the plan gave one. */
export function functionConfig(maxDuration: number | undefined): FunctionConfig {
  const config: FunctionConfig = {
    runtime: FUNCTION_RUNTIME,
    handler: FUNCTION_ENTRY,
    ...NODE_LAUNCHER,
  };
  if (maxDuration === undefined) return config;
  return { ...config, maxDuration };
}

export interface BuildOutputInput {
  /** The output root, emptied first so a function an earlier plan emitted cannot ship beside the current ones. */
  readonly outputDirectory: string;
  readonly functions: readonly EmittedFunction[];
  /** The built site, copied whole under `static/`; absent for a tree of functions alone. */
  readonly staticDirectory?: string;
}

/** Writes the tree and answers the public paths it emitted functions for, sorted. */
export async function emitBuildOutput(input: BuildOutputInput): Promise<readonly string[]> {
  await rm(input.outputDirectory, { recursive: true, force: true });
  await mkdir(input.outputDirectory, { recursive: true });
  await writeFile(
    join(input.outputDirectory, "config.json"),
    `${JSON.stringify({ version: BUILD_OUTPUT_VERSION }, null, 2)}\n`,
  );
  if (input.staticDirectory !== undefined) {
    await cp(input.staticDirectory, join(input.outputDirectory, STATIC_DIRECTORY), {
      recursive: true,
    });
  }
  for (const fn of input.functions) {
    await mkdir(functionDirectory(input.outputDirectory, fn.path), { recursive: true });
    await writeFile(functionEntryPath(input.outputDirectory, fn.path), fn.contents);
    await writeFile(
      functionConfigPath(input.outputDirectory, fn.path),
      `${JSON.stringify(functionConfig(fn.maxDuration), null, 2)}\n`,
    );
  }
  return input.functions.map((fn) => fn.path).sort();
}
