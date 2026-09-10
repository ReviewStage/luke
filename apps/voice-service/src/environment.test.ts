import assert from "node:assert/strict";
import test from "node:test";
import { LISTEN_DEFAULTS, readConfiguration, VOICE_SERVICE_ENVIRONMENT } from "./environment.js";

const COMPLETE = {
  [VOICE_SERVICE_ENVIRONMENT.OPENAI_API_KEY]: "sk-test",
  [VOICE_SERVICE_ENVIRONMENT.WEB_ORIGIN]: "https://tryluke.dev",
  [VOICE_SERVICE_ENVIRONMENT.SERVICE_SECRET]: "secret",
};

test("a complete environment reads to a configuration with the listen defaults", () => {
  const read = readConfiguration(COMPLETE);
  assert.ok(read.ok);
  assert.deepEqual(read.configuration, {
    apiKey: "sk-test",
    model: undefined,
    webOrigin: "https://tryluke.dev",
    serviceSecret: "secret",
    port: LISTEN_DEFAULTS.PORT,
    host: LISTEN_DEFAULTS.HOST,
  });
});

test("the model, port, and host are taken when set", () => {
  const read = readConfiguration({
    ...COMPLETE,
    [VOICE_SERVICE_ENVIRONMENT.LIVE_MODEL]: "gpt-live-1",
    [VOICE_SERVICE_ENVIRONMENT.PORT]: "9000",
    [VOICE_SERVICE_ENVIRONMENT.HOST]: "127.0.0.1",
  });
  assert.ok(read.ok);
  assert.equal(read.configuration.model, "gpt-live-1");
  assert.equal(read.configuration.port, 9000);
  assert.equal(read.configuration.host, "127.0.0.1");
});

test("a missing or blank required value names every variable the launch lacks", () => {
  const read = readConfiguration({
    [VOICE_SERVICE_ENVIRONMENT.OPENAI_API_KEY]: "  ",
    [VOICE_SERVICE_ENVIRONMENT.WEB_ORIGIN]: "https://tryluke.dev",
  });
  assert.deepEqual(read, {
    ok: false,
    missing: [VOICE_SERVICE_ENVIRONMENT.OPENAI_API_KEY, VOICE_SERVICE_ENVIRONMENT.SERVICE_SECRET],
  });
});

test("a port that is not a positive integer falls back to the default", () => {
  const read = readConfiguration({ ...COMPLETE, [VOICE_SERVICE_ENVIRONMENT.PORT]: "eighty" });
  assert.ok(read.ok);
  assert.equal(read.configuration.port, LISTEN_DEFAULTS.PORT);
});
