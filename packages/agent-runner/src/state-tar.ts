/**
 * state-tar.ts -- the tar an agent's state travels in, compressed with zstd by Node's own zlib: written from files on disk, each file's size and SHA-256 taken as it streams, and read back into a folder of its own, every path checked before a byte of it is written.
 *
 * The tar is POSIX ustar, with a pax `path` record where a path is longer
 * than ustar's 100 bytes, so `tar --zstd -tf` lists it. It holds files and
 * folders alone, owned by root and stamped at time zero, so the same state
 * makes the same bytes. Reading refuses any other kind of entry, a path that
 * is absolute or climbs out with `..`, a path the caller does not accept, a
 * path written twice, and more file bytes in all than the bound it is given,
 * which keeps a pack from unpacking into more than a save may hold. A failure
 * here throws an `Error` whose words name no file's contents; the state's
 * Effects (`state.ts`) turn it into their own failure.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress, createZstdDecompress } from "node:zlib";

/** A tar block, the unit every header and every file's padding comes in. */
const BLOCK = 512;

/** How many bytes of a path ustar's own name field holds; a longer one goes in a pax record. */
const USTAR_NAME_BYTES = 100;

/** The header's fields, by their offset and width (POSIX.1-1988 ustar). */
const FIELD = {
  NAME: [0, 100],
  MODE: [100, 8],
  UID: [108, 8],
  GID: [116, 8],
  SIZE: [124, 12],
  MTIME: [136, 12],
  CHECKSUM: [148, 8],
  TYPE: [156, 1],
  MAGIC: [257, 6],
  VERSION: [263, 2],
  PREFIX: [345, 155],
} as const;

/** The typeflags written and read: a file, a folder, and the pax record that names the next entry's path. */
const TYPEFLAG = { FILE: "0", OLD_FILE: "\0", DIRECTORY: "5", PAX: "x" } as const;

/** The kinds of entry a state's tar holds. */
export const TAR_ENTRY = { FILE: "file", DIRECTORY: "directory" } as const;

export type TarEntryType = (typeof TAR_ENTRY)[keyof typeof TAR_ENTRY];

/** One entry to write: its path in the tar, its kind and permission bits, and, for a file, its size and where its bytes come from. */
export type TarSource =
  | { readonly type: typeof TAR_ENTRY.DIRECTORY; readonly path: string; readonly mode: number }
  | {
      readonly type: typeof TAR_ENTRY.FILE;
      readonly path: string;
      readonly mode: number;
      readonly size: number;
      /** The file on disk its bytes are read from, or the bytes themselves. */
      readonly from: string | Uint8Array;
    };

/** A file as it went into the tar or came out of it: its path, its size, and its SHA-256 in hex. */
export interface TarFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** An entry as it came out of the tar. */
export interface TarRead {
  readonly path: string;
  readonly type: TarEntryType;
  readonly mode: number;
  /** For a file, its size and digest as read; none for a folder. */
  readonly file?: TarFile;
}

/** What a written tar came to: the files in it, the compressed file's size and SHA-256. */
export interface TarWritten {
  readonly files: readonly TarFile[];
  readonly bytes: number;
  readonly sha256: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** A number as ustar writes it: zero-padded octal, one byte short of the field, then a NUL. */
function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** Writes `text`'s bytes into `header` at the field given, cut to its width. */
function put(
  header: Uint8Array,
  field: readonly [number, number],
  text: string | Uint8Array,
): void {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  header.set(bytes.subarray(0, field[1]), field[0]);
}

/** One ustar header for the entry given, its checksum filled in. */
function headerBlock(input: {
  readonly name: Uint8Array;
  readonly mode: number;
  readonly size: number;
  readonly type: string;
}): Uint8Array {
  const header = new Uint8Array(BLOCK);
  put(header, FIELD.NAME, input.name);
  put(header, FIELD.MODE, octal(input.mode, FIELD.MODE[1]));
  put(header, FIELD.UID, octal(0, FIELD.UID[1]));
  put(header, FIELD.GID, octal(0, FIELD.GID[1]));
  put(header, FIELD.SIZE, octal(input.size, FIELD.SIZE[1]));
  put(header, FIELD.MTIME, octal(0, FIELD.MTIME[1]));
  put(header, FIELD.TYPE, input.type);
  put(header, FIELD.MAGIC, "ustar\0");
  put(header, FIELD.VERSION, "00");
  // Note that the checksum is summed with its own field as spaces, as ustar defines it.
  put(header, FIELD.CHECKSUM, "        ");
  const sum = header.reduce((total, byte) => total + byte, 0);
  put(header, FIELD.CHECKSUM, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/** The zero bytes that pad `size` bytes out to a whole block. */
function padding(size: number): Uint8Array {
  return new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);
}

/** One pax record, `<length> <key>=<value>\n`, whose length counts its own digits. */
function paxRecord(key: string, value: string): Uint8Array {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = encoder.encode(body).length;
  let length = bodyBytes + 1;
  while (String(length).length + bodyBytes !== length) length += 1;
  return encoder.encode(`${length}${body}`);
}

/** The header blocks of an entry: a pax record first where its path does not fit ustar's name. */
function* headersOf(path: string, mode: number, size: number, type: string): Generator<Uint8Array> {
  const name = encoder.encode(path);
  if (name.length > USTAR_NAME_BYTES) {
    const record = paxRecord("path", path);
    yield headerBlock({
      name: encoder.encode("PaxHeader"),
      mode: 0o644,
      size: record.length,
      type: TYPEFLAG.PAX,
    });
    yield record;
    yield padding(record.length);
  }
  yield headerBlock({ name, mode, size, type });
}

/** The blocks of the whole tar, each file's size and digest kept in `files` as it streams, and `closing` written last from them. */
async function* tarBlocks(
  entries: Iterable<TarSource>,
  files: TarFile[],
  closing: ((files: readonly TarFile[]) => TarSource) | undefined,
): AsyncGenerator<Uint8Array> {
  const write = async function* (entry: TarSource, keep: boolean): AsyncGenerator<Uint8Array> {
    if (entry.type === TAR_ENTRY.DIRECTORY) {
      yield* headersOf(`${entry.path}/`, entry.mode, 0, TYPEFLAG.DIRECTORY);
      return;
    }
    yield* headersOf(entry.path, entry.mode, entry.size, TYPEFLAG.FILE);
    const hash = createHash("sha256");
    let written = 0;
    const chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> =
      typeof entry.from === "string" ? createReadStream(entry.from) : [entry.from];
    for await (const chunk of chunks) {
      written += chunk.length;
      if (written > entry.size) throw new Error(`${entry.path} grew while it was packed`);
      hash.update(chunk);
      yield chunk;
    }
    if (written !== entry.size) throw new Error(`${entry.path} shrank while it was packed`);
    yield padding(written);
    if (keep) files.push({ path: entry.path, bytes: written, sha256: hash.digest("hex") });
  };
  for (const entry of entries) yield* write(entry, true);
  if (closing !== undefined) yield* write(closing(files), false);
  yield new Uint8Array(BLOCK * 2);
}

/**
 * Writes the entries given to `file` as a zstd-compressed tar, readable by
 * its owner alone, then `closing`, built from the files written before it,
 * such as a manifest of them, which is not itself counted among them.
 */
export async function writeTar(
  file: string,
  entries: Iterable<TarSource>,
  closing?: (files: readonly TarFile[]) => TarSource,
): Promise<TarWritten> {
  const files: TarFile[] = [];
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(
    Readable.from(tarBlocks(entries, files, closing)),
    createZstdCompress(),
    async function* (compressed: AsyncIterable<Uint8Array>) {
      for await (const chunk of compressed) {
        bytes += chunk.length;
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(file, { mode: 0o600 }),
  );
  return { files, bytes, sha256: hash.digest("hex") };
}

/** Pulls exact runs of bytes off a stream of chunks. */
class ByteReader {
  private held: Uint8Array = new Uint8Array();
  constructor(private readonly chunks: AsyncIterator<Uint8Array>) {}

  /** Up to `limit` bytes, at least one unless the stream has ended. */
  async some(limit: number): Promise<Uint8Array | undefined> {
    if (this.held.length === 0) {
      const next = await this.chunks.next();
      if (next.done === true) return undefined;
      this.held = next.value;
    }
    const taken = this.held.subarray(0, limit);
    this.held = this.held.subarray(taken.length);
    return taken;
  }

  /** Exactly `count` bytes; fails where the stream ends first. */
  async exactly(count: number): Promise<Uint8Array> {
    const out = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const piece = await this.some(count - filled);
      if (piece === undefined) throw new Error("the pack ends in the middle of an entry");
      out.set(piece, filled);
      filled += piece.length;
    }
    return out;
  }
}

/** A header field's text, up to its first NUL. */
function text(header: Uint8Array, field: readonly [number, number]): string {
  const bytes = header.subarray(field[0], field[0] + field[1]);
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/** A header's octal number field. */
function number(header: Uint8Array, field: readonly [number, number]): number {
  const digits = text(header, field).trim();
  if (!/^[0-7]+$/u.test(digits)) throw new Error("the pack holds a header that is not ustar");
  return Number.parseInt(digits, 8);
}

/** Whether a header's checksum is the sum of its bytes, its own field read as spaces. */
function checksumHolds(header: Uint8Array): boolean {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    const inField = index >= FIELD.CHECKSUM[0] && index < FIELD.CHECKSUM[0] + FIELD.CHECKSUM[1];
    sum += inField ? 0x20 : (header[index] ?? 0);
  }
  return sum === number(header, FIELD.CHECKSUM);
}

/** The `path` a pax record set names, if it names one. */
function paxPath(records: Uint8Array): string | undefined {
  let path: string | undefined;
  for (const line of decoder.decode(records).split("\n")) {
    const match = /^\d+ path=(.*)$/su.exec(line);
    if (match?.[1] !== undefined) path = match[1];
  }
  return path;
}

/** Whether a path is one a tar may name: relative, with no empty, `.` or `..` part. */
function plainPath(path: string): boolean {
  return (
    path !== "" && path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/**
 * Reads the zstd-compressed tar at `file` into the folder `into`, which the
 * caller made and nothing else writes, and answers what it held. Only a
 * file or a folder whose path `accept` takes is written; anything else, a
 * path twice, or more than `maxBytes` of files in all, fails the read.
 */
export async function readTar(
  file: string,
  into: string,
  accept: (path: string, type: TarEntryType) => boolean,
  maxBytes: number,
): Promise<readonly TarRead[]> {
  const read: TarRead[] = [];
  const seen = new Set<string>();
  let total = 0;
  await pipeline(
    createReadStream(file),
    createZstdDecompress(),
    async (source: AsyncIterable<Uint8Array>) => {
      const reader = new ByteReader(source[Symbol.asyncIterator]());
      let named: string | undefined;
      for (;;) {
        const header = await reader.exactly(BLOCK);
        if (header.every((byte) => byte === 0)) break;
        if (!checksumHolds(header))
          throw new Error("the pack holds a header whose checksum is wrong");
        const type = text(header, FIELD.TYPE);
        const size = number(header, FIELD.SIZE);
        if (type === TYPEFLAG.PAX) {
          named = paxPath(await reader.exactly(size));
          await reader.exactly(padding(size).length);
          continue;
        }
        const prefix = text(header, FIELD.PREFIX);
        const raw =
          named ??
          (prefix === "" ? text(header, FIELD.NAME) : `${prefix}/${text(header, FIELD.NAME)}`);
        named = undefined;
        const path = raw.replace(/\/$/u, "");
        const kind =
          type === TYPEFLAG.DIRECTORY
            ? TAR_ENTRY.DIRECTORY
            : type === TYPEFLAG.FILE || type === TYPEFLAG.OLD_FILE
              ? TAR_ENTRY.FILE
              : undefined;
        if (kind === undefined)
          throw new Error("the pack holds an entry that is neither a file nor a folder");
        if (!plainPath(path) || !accept(path, kind))
          throw new Error(`the pack holds ${path}, which a state never holds`);
        if (seen.has(path)) throw new Error(`the pack holds ${path} twice`);
        seen.add(path);
        const mode = number(header, FIELD.MODE) & 0o777;
        const target = join(into, path);
        if (kind === TAR_ENTRY.DIRECTORY) {
          await mkdir(target, { recursive: true });
          await chmod(target, mode);
          read.push({ path, type: kind, mode });
          continue;
        }
        total += size;
        if (total > maxBytes) throw new Error("the pack unpacks into more than a state may hold");
        await mkdir(dirname(target), { recursive: true });
        const handle = await open(target, "wx", 0o600);
        const hash = createHash("sha256");
        try {
          let left = size;
          while (left > 0) {
            const piece = await reader.some(left);
            if (piece === undefined) throw new Error("the pack ends in the middle of a file");
            hash.update(piece);
            await handle.write(piece);
            left -= piece.length;
          }
        } finally {
          await handle.close();
        }
        await chmod(target, mode);
        await reader.exactly(padding(size).length);
        read.push({
          path,
          type: kind,
          mode,
          file: { path, bytes: size, sha256: hash.digest("hex") },
        });
      }
      // Note that what follows the end is drained, so the stream ends as it was written rather than cut off.
      while ((await reader.some(BLOCK * 64)) !== undefined);
    },
  );
  return read;
}
