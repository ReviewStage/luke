/**
 * Archive compression's failing surface in Effect's own terms.
 * `compression.ts` is a port of OpenClaw `b7528507`'s zstd shape and imports
 * nothing from `effect`, so its Effect surface lives here: `decodeArchiveContent`
 * throws on a runtime whose `node:zlib` lacks zstd, restated as a typed
 * refusal instead of a thrown `Error` a caller must catch by hand.
 */
import type { ArchiveEncoding } from "@sidecar/runtime/vocabulary";
import { Data, Effect } from "effect";
import { decodeArchiveContent } from "./compression.js";

/** A zstd archive on a runtime whose `node:zlib` cannot decode one. */
export class ZstdUnsupported extends Data.TaggedError("ZstdUnsupported")<Record<string, never>> {}

/** Decodes archive bytes by the encoding the registry recorded, or fails where this runtime cannot read zstd. */
export const decodeArchiveContentEffect = (
  bytes: Uint8Array,
  encoding: ArchiveEncoding,
): Effect.Effect<string, ZstdUnsupported> =>
  Effect.try({
    try: () => decodeArchiveContent(bytes, encoding),
    catch: () => new ZstdUnsupported({}),
  });
