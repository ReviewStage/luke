/**
 * Archive compression's failing surface in Effect's own terms.
 * `compression.ts` is a port of OpenClaw `b7528507`'s zstd shape and imports
 * nothing from `effect`, so its Effect surface lives here: reading a zstd
 * archive on a runtime whose `node:zlib` lacks zstd is restated as a typed
 * refusal instead of a thrown `Error` a caller must catch by hand. The
 * refusal is decided from `zstdSupported()` itself, ahead of the read,
 * rather than from whatever `decodeArchiveContent` happens to throw: the
 * port throws that same `Error` text for missing zstd and for corrupt zstd
 * bytes alike, and only the first of those is a typed refusal a caller
 * should compose around — corrupt bytes are not "this runtime cannot read
 * zstd" and surface as the defect they are.
 */
import type { ArchiveEncoding } from "@sidecar/runtime/vocabulary";
import { ARCHIVE_ENCODING } from "@sidecar/runtime/vocabulary";
import { Data, Effect } from "effect";
import { decodeArchiveContent, zstdSupported } from "./compression.js";

/** A zstd archive on a runtime whose `node:zlib` cannot decode one. */
export class ZstdUnsupported extends Data.TaggedError("ZstdUnsupported")<Record<string, never>> {}

/** Decodes archive bytes by the encoding the registry recorded, or fails where this runtime cannot read zstd. */
export const decodeArchiveContentEffect = (
  bytes: Uint8Array,
  encoding: ArchiveEncoding,
): Effect.Effect<string, ZstdUnsupported> =>
  encoding === ARCHIVE_ENCODING.ZSTD && !zstdSupported()
    ? Effect.fail(new ZstdUnsupported({}))
    : Effect.sync(() => decodeArchiveContent(bytes, encoding));
