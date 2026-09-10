import { text } from "@sidecar/wire";

/**
 * Everything the service is told by its deployment, and nothing it reads for
 * itself. Four values make the service what it is: the GPT Live project key
 * it creates and attaches sessions with, the model a deployment may pin, the
 * account service's origin, and the secret the two internal routes there
 * accept. A blank value is absent, the same reading every hosted secret
 * gets, so a deployment that sets a key to nothing has switched the service
 * off rather than handed it an empty credential.
 */
export const VOICE_SERVICE_ENVIRONMENT = {
  OPENAI_API_KEY: "OPENAI_API_KEY",
  /** A deployment-pinned model; `LIVE_DEFAULTS.MODEL` otherwise. */
  LIVE_MODEL: "LUKE_LIVE_MODEL",
  /** The account service's origin, where `VOICE_AUTHORIZE` and `VOICE_USAGE` answer. */
  WEB_ORIGIN: "WEB_ORIGIN",
  /** The shared secret both deployments hold, sent in `VOICE_SERVICE_SECRET_HEADER`. */
  SERVICE_SECRET: "VOICE_SERVICE_SECRET",
  PORT: "PORT",
  HOST: "HOST",
} as const;

type VoiceServiceVariable =
  (typeof VOICE_SERVICE_ENVIRONMENT)[keyof typeof VOICE_SERVICE_ENVIRONMENT];

export const LISTEN_DEFAULTS = {
  PORT: 8080,
  /** Every interface: the service runs in a container behind the platform's own proxy. */
  HOST: "0.0.0.0",
} as const;

interface VoiceServiceConfiguration {
  apiKey: string;
  model: string | undefined;
  webOrigin: string;
  serviceSecret: string;
  port: number;
  host: string;
}

export type ConfigurationRead =
  | { ok: true; configuration: VoiceServiceConfiguration }
  | { ok: false; missing: readonly VoiceServiceVariable[] };

const REQUIRED: readonly VoiceServiceVariable[] = [
  VOICE_SERVICE_ENVIRONMENT.OPENAI_API_KEY,
  VOICE_SERVICE_ENVIRONMENT.WEB_ORIGIN,
  VOICE_SERVICE_ENVIRONMENT.SERVICE_SECRET,
];

/** Reads the environment once at launch; a launch missing a required value names every one it lacks. */
export function readConfiguration(environment: NodeJS.ProcessEnv): ConfigurationRead {
  const read = (name: VoiceServiceVariable) => text(environment[name]);
  const missing = REQUIRED.filter((name) => read(name) === undefined);
  const apiKey = read(VOICE_SERVICE_ENVIRONMENT.OPENAI_API_KEY);
  const webOrigin = read(VOICE_SERVICE_ENVIRONMENT.WEB_ORIGIN);
  const serviceSecret = read(VOICE_SERVICE_ENVIRONMENT.SERVICE_SECRET);
  if (apiKey === undefined || webOrigin === undefined || serviceSecret === undefined) {
    return { ok: false, missing };
  }
  const port = Number(read(VOICE_SERVICE_ENVIRONMENT.PORT));
  return {
    ok: true,
    configuration: {
      apiKey,
      model: read(VOICE_SERVICE_ENVIRONMENT.LIVE_MODEL),
      webOrigin,
      serviceSecret,
      port: Number.isInteger(port) && port > 0 ? port : LISTEN_DEFAULTS.PORT,
      host: read(VOICE_SERVICE_ENVIRONMENT.HOST) ?? LISTEN_DEFAULTS.HOST,
    },
  };
}
