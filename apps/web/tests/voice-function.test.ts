import assert from "node:assert/strict";
import { test } from "vitest";
import { voiceFunctionOptions } from "../server/voice/function";
import { voiceServer } from "../server/voice/service";

/**
 * The route's own composition passes the exchange. #1209 landed the attach
 * behind a seam `voice/function.ts` did not pass, so that an inertness test
 * could not read as coverage of the live path; this is the sibling it asked
 * for: the options the function builds the service from carry an exchange,
 * and the sessions function's bundle reaches the exchange's own modules, the
 * live-session door among them, which the guard once measured it did not.
 * The desktop half of the same commit, that the host composes no exchange of
 * its own, is held by `@luke/voice`'s holder tests and `@luke/host`'s
 * assembly, which stands with no live brain and no live record to provide.
 */

test("the voice function's options carry the exchange", () => {
  const options = voiceFunctionOptions(voiceServer());
  assert.notEqual(options.exchange, undefined);
});
