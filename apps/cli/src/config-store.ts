import { Effect, Schema } from "effect";
import { configFile, readConfigFile, writeConfigFile } from "./config-files.js";

const CONFIG_FILE = "config.json";

const serviceConfigSchema = Schema.Struct({
  workspace: Schema.optionalKey(Schema.String),
});

const configSchema = Schema.Struct({
  services: Schema.Record(Schema.String, serviceConfigSchema),
});

const configJson = Schema.fromJsonString(configSchema);

const NO_CONFIG: typeof configSchema.Type = { services: {} };

function configPath(): string {
  return configFile(process.env, CONFIG_FILE);
}

export function configuredWorkspace(origin: string) {
  return Effect.map(
    readConfigFile(configPath(), configJson, NO_CONFIG),
    (config) => config.services[origin]?.workspace,
  );
}

export function keepWorkspace(origin: string, workspace: string) {
  const file = configPath();
  return Effect.flatMap(readConfigFile(file, configJson, NO_CONFIG), (config) =>
    writeConfigFile(file, configJson, {
      services: { ...config.services, [origin]: { ...config.services[origin], workspace } },
    }),
  );
}
