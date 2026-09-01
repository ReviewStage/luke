import path from "node:path";

/** Appended after the inherited PATH, so the user's own resolution still wins. */
export const DEFAULT_CLI_PATH_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

/** The PATH one invocation receives, with empty and duplicate entries removed. */
export function invocationPath(pathDirectories: readonly string[] = []): string {
  return [...(process.env.PATH ?? "").split(path.delimiter), ...pathDirectories]
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    .join(path.delimiter);
}
