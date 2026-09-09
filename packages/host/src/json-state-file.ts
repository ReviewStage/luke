import fs from "node:fs";
import path from "node:path";
import { isRecord, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

export interface JsonStateFileOptions<T> {
  /** The directory the record sits in: the app's own state root. */
  directory: () => string;
  /** The file's name within it, e.g. `onboarding.json`. */
  fileName: string;
  /**
   * The record as this build reads it, or nothing for one it cannot use. Called
   * only with a parsed JSON object; a file that is absent, unreadable, not JSON,
   * or not an object never reaches it and reads as `undefined`.
   */
  read: (record: WireRecord) => T | undefined;
  /** The record as it persists; the newline is added here. */
  write: (state: T) => UnparsedWireValue;
  /** Where a failed write is reported. A failed read is not reported: absent is an answer. */
  report?: (message: string) => void;
}

export interface JsonStateFile<T> {
  /** The stored record, or nothing. Reads the file on every call. */
  read(): T | undefined;
  /**
   * Persists `mutate`'s answer over whatever is on disk at this moment, rather
   * than over a record read earlier, and answers what was persisted. The one
   * writer, because two processes write Luke's onboarding record, each owning
   * its own moments, and one saving over its own older read would drop the
   * other's. A write that cannot land is reported and nothing else: there is
   * no recovery a caller here could take that the next write does not.
   */
  update(mutate: (current: T | undefined) => T): T;
}

/**
 * One small JSON record on disk, read and written synchronously. Synchronous
 * because the introduction's completion is read before `whenReady` resolves,
 * and no writer here waits on anything a promise could carry.
 */
export function jsonStateFile<T>(options: JsonStateFileOptions<T>): JsonStateFile<T> {
  const filePath = () => path.join(options.directory(), options.fileName);
  const read = (): T | undefined => {
    let parsed: UnparsedWireValue;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    } catch {
      return undefined;
    }
    return isRecord(parsed) ? options.read(parsed) : undefined;
  };
  return {
    read,
    update: (mutate) => {
      const next = mutate(read());
      try {
        fs.writeFileSync(filePath(), `${JSON.stringify(options.write(next))}\n`);
      } catch (error) {
        options.report?.(
          `Could not persist ${options.fileName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return next;
    },
  };
}
