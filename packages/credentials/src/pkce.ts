import { Data, Effect } from "effect";
import { Base64Url } from "effect/encoding";

const VERIFIER_BYTES = 32;

export function createCodeVerifier(): string {
  return Base64Url.encode(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
}

export function codeChallenge(verifier: string): Effect.Effect<string, CodeChallengeFailed> {
  return Effect.map(
    Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      catch: (cause) => new CodeChallengeFailed({ cause }),
    }),
    (digest) => Base64Url.encode(new Uint8Array(digest)),
  );
}

export class CodeChallengeFailed extends Data.TaggedError("CodeChallengeFailed")<{
  readonly cause: unknown;
}> {}
