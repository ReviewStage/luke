import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { test } from "vitest";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionPath,
  VOICE_FUNCTION_MAX_DURATION_SECONDS,
} from "../server/function-durations";

test("both voice functions carry the 800 second maximum duration", () => {
  for (const path of Object.values(VOICE_SERVICE_PATH)) {
    assert.equal(FUNCTION_MAX_DURATION_SECONDS.get(path), VOICE_FUNCTION_MAX_DURATION_SECONDS);
  }
});

test("every path given a duration is a route the bundle emits", () => {
  for (const path of FUNCTION_MAX_DURATION_SECONDS.keys()) {
    const source = fileURLToPath(
      new URL(`../server/routes/${path.slice("/api/".length)}.ts`, import.meta.url),
    );
    assert.ok(existsSync(source), path);
    assert.equal(functionPath(`${path.slice("/api/".length)}.ts`), path);
  }
});

test("the config literal parses back to the duration it was written from", async () => {
  const source = functionConfigSource(VOICE_FUNCTION_MAX_DURATION_SECONDS);
  // SAFETY: the module is the one line `functionConfigSource` wrote, whose only export is `config`.
  const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as {
    config: { maxDuration: number };
  };
  assert.deepEqual(module.config, { maxDuration: VOICE_FUNCTION_MAX_DURATION_SECONDS });
});
