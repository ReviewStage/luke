import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

export const BUILD_OUTPUT_DIRECTORY = join(".vercel", "output");
const BUILD_OUTPUT_VERSION = 3;
const FUNCTION_RUNTIME = "nodejs24.x";
const FUNCTION_ENTRY = "index.mjs";
const FUNCTIONS_DIRECTORY = "functions";
const STATIC_DIRECTORY = "static";
const FUNCTION_DIRECTORY_SUFFIX = ".func";
const FUNCTION_CONFIG_FILE = ".vc-config.json";

const NODE_LAUNCHER = {
  launcherType: "Nodejs",
  shouldAddHelpers: true,
} as const;

interface HandWrittenFunction {
  readonly source: string;
  readonly path: string;
}

export const HAND_WRITTEN_FUNCTIONS: readonly HandWrittenFunction[] = [
  { source: posix.join("server", "feedback.mjs"), path: posix.join("api", "feedback.mjs") },
];

export interface EmittedFunction {
  readonly path: string;
  readonly contents: Uint8Array | string;
  readonly maxDuration: number | undefined;
  readonly files?: readonly { readonly name: string; readonly contents: Uint8Array }[];
}

interface FunctionConfig {
  readonly runtime: typeof FUNCTION_RUNTIME;
  readonly handler: typeof FUNCTION_ENTRY;
  readonly launcherType: typeof NODE_LAUNCHER.launcherType;
  readonly shouldAddHelpers: typeof NODE_LAUNCHER.shouldAddHelpers;
  readonly maxDuration?: number;
}

export function functionDirectory(outputDirectory: string, path: string): string {
  return join(outputDirectory, FUNCTIONS_DIRECTORY, `${path}${FUNCTION_DIRECTORY_SUFFIX}`);
}

export function functionAliasPath(path: string): string {
  return path.slice(0, path.length - posix.extname(path).length);
}

function functionConfigPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_CONFIG_FILE);
}

export function functionEntryPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_ENTRY);
}

function functionConfig(maxDuration: number | undefined): FunctionConfig {
  const config: FunctionConfig = {
    runtime: FUNCTION_RUNTIME,
    handler: FUNCTION_ENTRY,
    ...NODE_LAUNCHER,
  };
  if (maxDuration === undefined) return config;
  return { ...config, maxDuration };
}

interface BuildOutputInput {
  readonly outputDirectory: string;
  readonly functions: readonly EmittedFunction[];
  readonly staticDirectory?: string;
}

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
    const directory = functionDirectory(input.outputDirectory, fn.path);
    await mkdir(directory, { recursive: true });
    await writeFile(functionEntryPath(input.outputDirectory, fn.path), fn.contents);
    for (const file of fn.files ?? []) await writeFile(join(directory, file.name), file.contents);
    await writeFile(
      functionConfigPath(input.outputDirectory, fn.path),
      `${JSON.stringify(functionConfig(fn.maxDuration), null, 2)}\n`,
    );
    const alias = functionDirectory(input.outputDirectory, functionAliasPath(fn.path));
    await mkdir(dirname(alias), { recursive: true });
    await symlink(basename(directory), alias, "dir");
  }
  return input.functions.map((fn) => fn.path).sort();
}
