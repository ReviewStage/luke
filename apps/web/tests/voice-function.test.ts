import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { build, type Metafile } from "esbuild";
import { test } from "vitest";
import { functionBundlePlan } from "../server/function-bundles";
import { routeKeyOf } from "../server/function-durations";
import { FUNCTION_BUNDLE_DIRECTORY } from "../server/function-layout";
import { voiceFunctionOptions } from "../server/voice/function";
import { voiceServer } from "../server/voice/service";

const WEB = fileURLToPath(new URL("..", import.meta.url));

/**
 * The route's own composition passes the exchange. #1209 landed the attach
 * behind a seam `voice/function.ts` did not pass, so that an inertness test
 * could not read as coverage of the live path; this is the sibling it asked
 * for: the options the function builds the service from carry an exchange,
 * and the sessions function's bundle reaches the exchange's own modules, the
 * live-session door among them, which the guard once measured it did not.
 * The desktop half of the same commit, that the host composes no exchange of
 * its own, is held by `@sidecar/voice`'s holder tests and `@sidecar/host`'s
 * assembly, which stands with no live brain and no live record to provide.
 */

test("the voice function's options carry the exchange", () => {
  const options = voiceFunctionOptions(voiceServer());
  assert.notEqual(options.exchange, undefined);
});

/** The source files under `server/voice/` a bundle's inputs name, POSIX-separated and relative to the web app. */
function voiceInputsOf(inputs: Metafile["outputs"][string]["inputs"]): readonly string[] {
  return Object.keys(inputs)
    .filter((input) => input.startsWith("server/voice/"))
    .sort();
}

test("the sessions function's bundle reaches the exchange and the live-session door", {
  timeout: 60_000,
}, async () => {
  const plan = await functionBundlePlan(WEB);
  const result = await build({ ...plan.options, write: false });
  const sessions = plan.functions.find(
    (definition) => definition.file === routeKeyOf(VOICE_SERVICE_PATH.SESSIONS),
  );
  assert.ok(sessions);
  const output = Object.entries(result.metafile.outputs).find(([path]) =>
    path.endsWith(`${FUNCTION_BUNDLE_DIRECTORY}/${sessions.file}.js`),
  );
  assert.ok(output, `a bundle for ${sessions.file}`);
  const voiceInputs = voiceInputsOf(output[1].inputs);
  for (const module of [
    "server/voice/deployment-exchange.ts",
    "server/voice/exchange-attachment.ts",
    "server/voice/live-exchange.ts",
    "server/voice/live-brain.ts",
    "server/voice/live-briefings.ts",
    "server/voice/live-record.ts",
    "server/voice/live-sideband.ts",
  ]) {
    assert.ok(voiceInputs.includes(module), `${sessions.file} reaches ${module}`);
  }
  assert.ok(
    Object.keys(output[1].inputs).some((input) =>
      input.includes("packages/voice/src/live-session/live-session-service.ts"),
    ),
    "the live-session door is in the bundle",
  );
});
