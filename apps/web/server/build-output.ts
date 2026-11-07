import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

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
 * launcher that adapts a `{ fetch }` route object and the WebSocket functions'
 * exported `http.Server` is the platform's, unchanged.
 *
 * Vercel's zero-config pass served every `api/` function at two URLs, its
 * file name and the same path without the extension, and the clients use
 * the second: the terminal relay opens at `/api/terminal/sessions`, the desktop
 * posts feedback at `/api/feedback`. A `.func` answers only at its own name,
 * so each function is emitted twice, the bundle under its file name (the
 * destination the `/api/` rewrites carry) and an extensionless `.func` that
 * is a symlink to it, which the Build Output API names as the way to serve
 * one function at more than one path.
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

/** The queue trigger Vercel's own Node builder writes for a `queue/v2beta` consumer (`@vercel/build-utils`'s `QueueTriggerEvent`). */
const QUEUE_TRIGGER_TYPE = "queue/v2beta";

interface QueueTrigger {
  readonly type: typeof QUEUE_TRIGGER_TYPE;
  readonly topic: string;
  readonly consumer: string;
}

/**
 * The consumer group a function's trigger names, from its public path, as
 * Vercel's builder names a `queue/v2beta` consumer from its file: `_`, `/`,
 * and `.` escaped as `__`, `_S`, and `_D`, any other character outside
 * letters, digits, and `-` as `_` and its hex code, so no two paths share a
 * group.
 */
function consumerNameOf(path: string): string {
  let name = "";
  for (const character of path) {
    if (character === "_") name += "__";
    else if (character === "/") name += "_S";
    else if (character === ".") name += "_D";
    else if (/[A-Za-z0-9-]/u.test(character)) name += character;
    else name += `_${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return name;
}

/** A function written by hand rather than bundled from `server/routes/`. */
interface HandWrittenFunction {
  /** The module, relative to the web app; plain ESM the launcher runs as it stands. */
  readonly source: string;
  /** Its public path, which is the URL it answers on. */
  readonly path: string;
}

/** The one hand-written function: the feedback courier the desktop posts to. */
export const HAND_WRITTEN_FUNCTIONS: readonly HandWrittenFunction[] = [
  { source: posix.join("server", "feedback.mjs"), path: posix.join("api", "feedback.mjs") },
];

/** A function as the tree emits it: its public path, its entry's contents, and the bound it runs under. */
export interface EmittedFunction {
  readonly path: string;
  readonly contents: Uint8Array | string;
  /** The bound the plan gave the function; undefined leaves the platform's default. */
  readonly maxDuration: number | undefined;
  /** Files the function reads beside its entry, by name, such as the runner it uploads to a sandbox. */
  readonly files?: readonly { readonly name: string; readonly contents: Uint8Array }[];
  /** The queue topic the function consumes, where the queue alone invokes it; its trigger goes in its configuration. */
  readonly queueTopic?: string | undefined;
}

interface FunctionConfig {
  readonly runtime: typeof FUNCTION_RUNTIME;
  readonly handler: typeof FUNCTION_ENTRY;
  readonly launcherType: typeof NODE_LAUNCHER.launcherType;
  readonly shouldAddHelpers: typeof NODE_LAUNCHER.shouldAddHelpers;
  readonly maxDuration?: number;
  readonly experimentalTriggers?: readonly QueueTrigger[];
}

/** The `.func` directory of a function under the output root. */
export function functionDirectory(outputDirectory: string, path: string): string {
  return join(outputDirectory, FUNCTIONS_DIRECTORY, `${path}${FUNCTION_DIRECTORY_SUFFIX}`);
}

/** The function's second public path: the same path without its extension, as the zero-config pass served it. */
export function functionAliasPath(path: string): string {
  return path.slice(0, path.length - posix.extname(path).length);
}

function functionConfigPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_CONFIG_FILE);
}

export function functionEntryPath(outputDirectory: string, path: string): string {
  return join(functionDirectory(outputDirectory, path), FUNCTION_ENTRY);
}

/**
 * The configuration a function is deployed with; a duration is written only
 * where the plan gave one, and a queue trigger only on a consumer. Note
 * that the trigger is written here rather than in `vercel.json`'s
 * `functions`, because a Build Output tree is deployed as it stands and
 * Vercel reads a function's trigger from its `.vc-config.json`.
 */
function functionConfig(fn: EmittedFunction): FunctionConfig {
  const config: FunctionConfig = {
    runtime: FUNCTION_RUNTIME,
    handler: FUNCTION_ENTRY,
    ...NODE_LAUNCHER,
    ...(fn.maxDuration === undefined ? undefined : { maxDuration: fn.maxDuration }),
  };
  if (fn.queueTopic === undefined) return config;
  const trigger: QueueTrigger = {
    type: QUEUE_TRIGGER_TYPE,
    topic: fn.queueTopic,
    consumer: consumerNameOf(fn.path),
  };
  return { ...config, experimentalTriggers: [trigger] };
}

interface BuildOutputInput {
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
    const directory = functionDirectory(input.outputDirectory, fn.path);
    await mkdir(directory, { recursive: true });
    await writeFile(functionEntryPath(input.outputDirectory, fn.path), fn.contents);
    for (const file of fn.files ?? []) await writeFile(join(directory, file.name), file.contents);
    await writeFile(
      functionConfigPath(input.outputDirectory, fn.path),
      `${JSON.stringify(functionConfig(fn), null, 2)}\n`,
    );
    const alias = functionDirectory(input.outputDirectory, functionAliasPath(fn.path));
    await mkdir(dirname(alias), { recursive: true });
    await symlink(basename(directory), alias, "dir");
  }
  return input.functions.map((fn) => fn.path).sort();
}
