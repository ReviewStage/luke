import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { ARCHIVE_ENCODING } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { decodeArchiveContentEffect, ZstdUnsupported } from "./compression.effect.js";
import { encodeArchiveContent, zstdSupported } from "./compression.js";

describe("decodeArchiveContentEffect", () => {
  it.effect("round-trips whatever encodeArchiveContent produced on this runtime", () =>
    Effect.gen(function* () {
      const encoded = encodeArchiveContent("hello archive");
      const decoded = yield* decodeArchiveContentEffect(encoded.bytes, encoded.encoding);

      assert.equal(decoded, "hello archive");
    }),
  );

  it.effect("succeeds on identity-encoded bytes regardless of zstd support", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeArchiveContentEffect(
        Buffer.from("plain", "utf8"),
        ARCHIVE_ENCODING.IDENTITY,
      );

      assert.equal(decoded, "plain");
    }),
  );

  it.effect.skipIf(zstdSupported())(
    "fails with ZstdUnsupported reading zstd bytes on a runtime without it",
    () =>
      Effect.gen(function* () {
        const refusal = yield* Effect.flip(
          decodeArchiveContentEffect(Buffer.from("x"), ARCHIVE_ENCODING.ZSTD),
        );

        assert.ok(refusal instanceof ZstdUnsupported);
      }),
  );
});
