import path from "node:path";
import { readTextFile } from "@sidecar/providers";
import { text, unparsedWire, type WireBoundaryInput, wireRecord } from "@sidecar/wire";

const SUPERSET_CONFIG_FILE = "config.json";
const SUPERSET_CONFIG_FIELD = { ORGANIZATION_ID: "organizationId" } as const;

/**
 * Superset's own configuration file, read as the JSON it is. The previous
 * build spawned `/usr/bin/plutil -extract organizationId raw` to read one
 * field out of a JSON document — a process on every observation pass to do
 * what `JSON.parse` does, and one more binary between Luke and a file he only
 * ever reads. An absent, unreadable, unparseable, or differently-shaped file
 * answers nothing, which is the same "observes nothing there" the exit code
 * used to say.
 */
export async function activeOrganizationId(homeDirectory: string): Promise<string | undefined> {
  const contents = await readTextFile(path.join(homeDirectory, SUPERSET_CONFIG_FILE));
  if (contents === undefined) return undefined;
  let parsed: WireBoundaryInput;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  const record = wireRecord(unparsedWire(parsed));
  return record ? text(record[SUPERSET_CONFIG_FIELD.ORGANIZATION_ID]) : undefined;
}
