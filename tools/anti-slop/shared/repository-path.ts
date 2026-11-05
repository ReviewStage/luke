import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PLUGIN_DIRECTORY, "..", "..");

/** A file's path from the repository's root, with forward slashes, as the rules name files. */
export function repositoryPathOf(filename: string): string {
  return path.relative(REPOSITORY_ROOT, filename).split(path.sep).join("/");
}

/**
 * The repository's TypeScript sources: its `.mjs` build and evidence scripts
 * are plain Node harnesses, so the rules that read source are scoped by
 * extension, never by a row apiece.
 */
export const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts)$/u;
