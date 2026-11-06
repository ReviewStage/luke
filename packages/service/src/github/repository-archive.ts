import { gunzipSync } from "node:zlib";
import { Data, Effect, Option, type Redacted, Stream } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { githubRead, send } from "./github-app.js";

const ARCHIVE_BOUNDS = {
  MAX_ARCHIVE_BYTES: 16 * 1024 * 1024,
  MAX_UNPACKED_BYTES: 64 * 1024 * 1024,
} as const;

const CODELOAD = "https://codeload.github.com";

const TAR_BLOCK = 512;

const TAR_TYPE = {
  FILE: "0",
  FILE_OLD: "\0",
  PAX_ENTRY: "x",
  PAX_GLOBAL: "g",
} as const;

const PAX_COMMIT = "comment";

const PAX_PATH = "path";

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

export const ARCHIVE_UNREAD = {
  NOT_FOUND: "not-found",
  TOO_LARGE: "too-large",
  UNANSWERED: "unanswered",
} as const;

type ArchiveUnreadReason = (typeof ARCHIVE_UNREAD)[keyof typeof ARCHIVE_UNREAD];

export class ArchiveUnread extends Data.TaggedError("ArchiveUnread")<{
  readonly reason: ArchiveUnreadReason;
}> {}

export interface RepositoryArchive {
  readonly sha: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

function field(header: Uint8Array, offset: number, length: number): string {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function paxRecords(body: Uint8Array): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  const decoder = new TextDecoder();
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    const length = Number(decoder.decode(body.subarray(at, space)));
    if (space === -1 || !Number.isInteger(length) || length <= 0) break;
    const record = decoder.decode(body.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

function readTar(tar: Uint8Array): Option.Option<RepositoryArchive> {
  const files = new Map<string, Uint8Array>();
  let sha: string | undefined;
  let longPath: string | undefined;
  let at = 0;
  while (at + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(at, at + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size)) return Option.none();
    const body = tar.subarray(at + TAR_BLOCK, at + TAR_BLOCK + size);
    const type = String.fromCharCode(header[156] ?? 0);
    if (type === TAR_TYPE.PAX_GLOBAL) {
      sha = paxRecords(body).get(PAX_COMMIT) ?? sha;
    } else if (type === TAR_TYPE.PAX_ENTRY) {
      longPath = paxRecords(body).get(PAX_PATH);
    } else {
      const prefix = field(header, 345, 155);
      const path = longPath ?? (prefix === "" ? "" : `${prefix}/`) + field(header, 0, 100);
      const top = path.indexOf("/");
      if ((type === TAR_TYPE.FILE || type === TAR_TYPE.FILE_OLD) && top !== -1) {
        files.set(path.slice(top + 1), body);
      }
      longPath = undefined;
    }
    at += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return sha !== undefined && COMMIT_SHA.test(sha) ? Option.some({ sha, files }) : Option.none();
}

function boundedBody(response: HttpClientResponse.HttpClientResponse) {
  return response.stream.pipe(
    Stream.mapAccum(
      () => 0,
      (seen, chunk: Uint8Array) => {
        const kept = chunk.subarray(0, Math.max(0, ARCHIVE_BOUNDS.MAX_ARCHIVE_BYTES + 1 - seen));
        const total = seen + kept.length;
        return [total, [{ kept, total }]] as const;
      },
    ),
    Stream.takeUntil(({ total }) => total > ARCHIVE_BOUNDS.MAX_ARCHIVE_BYTES),
    Stream.runCollect,
    Effect.map((pieces) => {
      const bytes = new Uint8Array(pieces.at(-1)?.total ?? 0);
      let at = 0;
      for (const { kept } of pieces) {
        bytes.set(kept, at);
        at += kept.length;
      }
      return bytes;
    }),
  );
}

function refPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

export function readRepositoryArchive(
  repository: { readonly fullName: string; readonly public: boolean },
  bearer: Redacted.Redacted | null,
  ref: string,
): Effect.Effect<RepositoryArchive, ArchiveUnread, HttpClient.HttpClient> {
  const request = repository.public
    ? HttpClientRequest.get(`${CODELOAD}/${repository.fullName}/tar.gz/${refPath(ref)}`)
    : githubRead(`/repos/${repository.fullName}/tarball/${refPath(ref)}`, bearer);
  const unread = (reason: ArchiveUnreadReason) => new ArchiveUnread({ reason });
  const read = Effect.scoped(
    Effect.gen(function* () {
      const response = yield* send(request);
      if (response.status === 404) return yield* unread(ARCHIVE_UNREAD.NOT_FOUND);
      if (response.status !== 200) {
        yield* Effect.logWarning(`An archive was not served: GitHub answered ${response.status}`);
        return yield* unread(ARCHIVE_UNREAD.UNANSWERED);
      }
      const gzipped = yield* boundedBody(response);
      if (gzipped.byteLength > ARCHIVE_BOUNDS.MAX_ARCHIVE_BYTES) {
        return yield* unread(ARCHIVE_UNREAD.TOO_LARGE);
      }
      const tar = yield* Effect.try({
        try: () => gunzipSync(gzipped, { maxOutputLength: ARCHIVE_BOUNDS.MAX_UNPACKED_BYTES }),
        catch: () => unread(ARCHIVE_UNREAD.TOO_LARGE),
      });
      const archive = readTar(tar);
      if (Option.isNone(archive)) {
        yield* Effect.logWarning("An archive named no commit");
        return yield* unread(ARCHIVE_UNREAD.UNANSWERED);
      }
      return archive.value;
    }),
  );
  return read.pipe(
    Effect.catch((failure) =>
      failure instanceof ArchiveUnread
        ? Effect.fail(failure)
        : Effect.andThen(
            Effect.logWarning(`An archive was not read: ${failure._tag}`),
            Effect.fail(unread(ARCHIVE_UNREAD.UNANSWERED)),
          ),
    ),
  );
}
