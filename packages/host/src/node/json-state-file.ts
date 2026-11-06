import fs from "node:fs";
import path from "node:path";
import { isRecord, type UnparsedWireValue, type WireRecord } from "@repo/wire";

export interface JsonStateFileOptions<T> {
  directory: () => string;
  fileName: string;
  read: (record: WireRecord) => T | undefined;
  write: (state: T) => UnparsedWireValue;
  report?: (message: string) => void;
}

export interface JsonStateFile<T> {
  read(): T | undefined;
  update(mutate: (current: T | undefined) => T): T;
}

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
