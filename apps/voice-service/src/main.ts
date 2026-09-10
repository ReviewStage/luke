import { readConfiguration } from "./environment.js";
import { VoiceService } from "./service.js";

/**
 * The container's entry: read the deployment's environment, listen, and
 * leave gracefully on the platform's stop signal so every session under way
 * gets its `session.close` and its seconds recorded before the process ends.
 */

const read = readConfiguration(process.env);
if (!read.ok) {
  process.stderr.write(`voice-service: missing ${read.missing.join(", ")}\n`);
  process.exit(1);
}

const { configuration } = read;
const service = new VoiceService({
  apiKey: configuration.apiKey,
  model: configuration.model,
  webOrigin: configuration.webOrigin,
  serviceSecret: configuration.serviceSecret,
});

await service.listen(configuration.port, configuration.host);

const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
for (const signal of STOP_SIGNALS) {
  process.once(signal, () => {
    void service.close().then(() => process.exit(0));
  });
}
