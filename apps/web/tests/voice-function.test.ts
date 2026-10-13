import assert from "node:assert/strict";
import { Redacted } from "effect";
import { afterEach, test, vi } from "vitest";
import { voiceFunctionOptions } from "../server/voice/function";
import { LIVEAVATAR_ENVIRONMENT } from "../server/voice/liveavatar";
import { voiceServer } from "../server/voice/service";

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
  const options = voiceFunctionOptions(voiceServer(), { liveAvatarKey: undefined });
  assert.notEqual(options.exchange, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the voice function's options carry LiveAvatar only where both its key and its avatar are set", () => {
  const liveAvatarKey = Redacted.make("la-test-key");
  vi.stubEnv(LIVEAVATAR_ENVIRONMENT.AVATAR_ID, "avatar-test");
  assert.equal(voiceFunctionOptions(voiceServer(), { liveAvatarKey: undefined }).avatar, undefined);
  assert.notEqual(voiceFunctionOptions(voiceServer(), { liveAvatarKey }).avatar, undefined);
  vi.stubEnv(LIVEAVATAR_ENVIRONMENT.AVATAR_ID, " ");
  assert.equal(voiceFunctionOptions(voiceServer(), { liveAvatarKey }).avatar, undefined);
});
