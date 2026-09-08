import fs from "node:fs";
import path from "node:path";

/**
 * The store's own reads and writes of the notebook's files, synchronous
 * because they run on the store's worker inside its transactions. A read of
 * a file not yet there answers the fallback; a write lands whole through a
 * rename, so a reader never sees half a file.
 */

export function readWorkspaceFileSync(root: string, name: string, fallback = ""): string {
  try {
    return fs.readFileSync(path.join(root, name), "utf8");
  } catch (error) {
    // SAFETY: fs throws an ErrnoException; only its code is read, and any other error is rethrown.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeWorkspaceFileSync(root: string, name: string, content: string): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, name);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
