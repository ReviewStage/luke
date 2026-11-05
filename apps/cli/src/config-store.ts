/**
 * config-store.ts -- what `vespin` remembers between runs that is no secret: the default workspace for each service, in `config.json` beside the sign-in.
 *
 * Kept by service origin, as the sign-in is, since a Preview's workspaces
 * are not production's. `workspace use` writes the default; a command reads
 * it through `workspace.ts`, under `-w` and `VESPIN_WORKSPACE`.
 */

import { Effect, Schema } from "effect";
import { configFile, readConfigFile, writeConfigFile } from "./config-files.js";

const CONFIG_FILE = "config.json";

/** One service's settings. */
const serviceConfigSchema = Schema.Struct({
  /** The workspace a command acts in where nothing else names one, by its slug or id. */
  workspace: Schema.optionalKey(Schema.String),
});

/** The whole file: each service origin's settings. */
const configSchema = Schema.Struct({
  services: Schema.Record(Schema.String, serviceConfigSchema),
});

const configJson = Schema.fromJsonString(configSchema);

const NO_CONFIG: typeof configSchema.Type = { services: {} };

function configPath(): string {
  return configFile(process.env, CONFIG_FILE);
}

/** The default workspace the config keeps for a service, where it keeps one. */
export function configuredWorkspace(origin: string) {
  return Effect.map(
    readConfigFile(configPath(), configJson, NO_CONFIG),
    (config) => config.services[origin]?.workspace,
  );
}

/** The default workspace kept for a service, written over any before it. */
export function keepWorkspace(origin: string, workspace: string) {
  const file = configPath();
  return Effect.flatMap(readConfigFile(file, configJson, NO_CONFIG), (config) =>
    writeConfigFile(file, configJson, {
      services: { ...config.services, [origin]: { ...config.services[origin], workspace } },
    }),
  );
}
