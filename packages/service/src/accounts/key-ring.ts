import { parseKeyRing } from "@luke/database/models/provider-key-seal";
import { Effect, Result } from "effect";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";

/**
 * key-ring.ts -- the deployment's key-encryption keys, as every endpoint that seals or opens a stored value reads them.
 *
 * The ring seals an account's provider keys (`provider-keys-app.ts`) and a
 * workspace's environment values (`workspace-environment-app.ts`) alike. A
 * deployment holding no ring, or one it cannot parse, answers unavailable.
 */

/** The deployment's ring, or the request refused as unavailable where it holds none it can parse. */
export const keyRingOrUnavailable = Effect.gen(function* () {
  const environment = yield* HostedEnvironment;
  const configured = environment.providerKeyEncryptionKeys;
  if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const ring = parseKeyRing(configured);
  if (Result.isFailure(ring)) {
    // The fault names the shape that is wrong and never a value.
    yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return ring.success;
});
