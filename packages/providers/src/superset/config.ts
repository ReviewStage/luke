import path from "node:path";
import { text, unparsedWire, type WireBoundaryInput, wireRecord } from "@sidecar/wire";
import { readTextFile } from "../shared/local-files.js";

const SUPERSET_CONFIG_FILE = "config.json";
const SUPERSET_CONFIG_FIELD = { ORGANIZATION_ID: "organizationId" } as const;

/**
 * Superset's own configuration file, read as the JSON it is. An absent,
 * unreadable, unparseable, or differently-shaped file answers nothing.
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
