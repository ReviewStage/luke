import zlib from "node:zlib";
import { ARCHIVE_ENCODING, type ArchiveEncoding } from "@sidecar/runtime-contracts";

/**
 * How an archive's JSONL is kept on disk, ported from OpenClaw's
 * `archive-compression.ts` at the pinned revision: zstd through `node:zlib`
 * at the library's default level, the `.zst` suffix on the name, and a plain
 * file where the runtime has no zstd, so a machine without it still archives
 * rather than failing. Reading is the mirror: a `.zst` archive is decoded
 * transparently, and one found on a runtime without zstd is refused with the
 * reason named rather than read as garbage.
 */

export const ARCHIVE_ZSTD_SUFFIX = ".zst";

/** The runtime's zstd pair, or nothing on a runtime whose zlib lacks it, which keeps the plain path instead of throwing. */
const zstd =
  "zstdCompressSync" in zlib && "zstdDecompressSync" in zlib
    ? { compress: zlib.zstdCompressSync, decompress: zlib.zstdDecompressSync }
    : undefined;

export function zstdSupported(): boolean {
  return zstd !== undefined;
}

export interface EncodedArchive {
  bytes: Buffer;
  encoding: ArchiveEncoding;
}

/** Compresses archive content when the runtime can; an empty archive stays plain, there being nothing to fold. */
export function encodeArchiveContent(content: string): EncodedArchive {
  const plain = Buffer.from(content, "utf8");
  if (!zstd || plain.length === 0) return { bytes: plain, encoding: ARCHIVE_ENCODING.IDENTITY };
  return { bytes: zstd.compress(plain), encoding: ARCHIVE_ENCODING.ZSTD };
}

/** Decodes archive bytes by the encoding the registry recorded; refuses zstd on a runtime without it. */
export function decodeArchiveContent(bytes: Uint8Array, encoding: ArchiveEncoding): string {
  if (encoding === ARCHIVE_ENCODING.IDENTITY) return Buffer.from(bytes).toString("utf8");
  if (!zstd) {
    throw new Error("cannot read a zstd archive: this runtime's node:zlib lacks zstd support");
  }
  return zstd.decompress(Buffer.from(bytes)).toString("utf8");
}

export function archiveEncodingSuffix(encoding: ArchiveEncoding): string {
  return encoding === ARCHIVE_ENCODING.ZSTD ? ARCHIVE_ZSTD_SUFFIX : "";
}
