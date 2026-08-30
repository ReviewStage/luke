import os from "node:os";
import path from "node:path";

export const OMP_SESSIONS_DIRECTORY = "sessions";
export const OMP_SESSION_FILE_EXTENSION = ".jsonl";

/**
 * Session ids OMP mints in filenames and headers. Tight enough that an id is
 * never a path: no separators, no dots, nothing relative.
 */
export const OMP_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;

export function defaultOmpHome(): string {
  return path.join(os.homedir(), ".omp", "agent");
}

export function sessionIdFromOmpFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(OMP_SESSION_FILE_EXTENSION)) return undefined;
  const stem = fileName.slice(0, -OMP_SESSION_FILE_EXTENSION.length);
  const separator = stem.lastIndexOf("_");
  if (separator <= 0 || separator === stem.length - 1) return undefined;
  const id = stem.slice(separator + 1);
  return OMP_SESSION_ID_PATTERN.test(id) ? id : undefined;
}
