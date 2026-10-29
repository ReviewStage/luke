/**
 * repository-archive.ts -- one commit of a repository read whole from the one archive GitHub serves of it, within a bound.
 *
 * GitHub serves any commit as a gzipped tar
 * (https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-tar):
 * a public repository's straight from `codeload.github.com`, which asks no
 * token and is no request of the REST API, so it spends neither GitHub's
 * rate limit nor a lane of the rate gate (`github-rate-gate.ts`); a private
 * one's through `GET /repos/{owner}/{repo}/tarball/{ref}` on a token, which
 * GitHub answers with a redirect to the same archive. `git archive` names
 * the commit in the archive's pax global header (`comment`), so one
 * download both pins the ref and reads every file at it.
 *
 * Every entry sits under one top folder, which is left off. A link, a
 * folder, or anything else but a regular file is left out, as the contents
 * API answers none of them as a file. An archive past `ARCHIVE_BOUNDS`, one
 * GitHub does not serve, or one that does not name its commit is answered
 * as none, and the caller reads the commit file by file instead.
 */

import { gunzipSync } from "node:zlib";
import { Effect, Option, type Redacted, Stream } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { githubRead, send } from "./github-app.js";

/**
 * How much of an archive is read: what crosses the wire, and what it
 * unpacks to. Note that the archive is unpacked in one synchronous step,
 * which the bound keeps to well under a second, because a skill source is
 * a few megabytes where a monorepo is hundreds.
 */
const ARCHIVE_BOUNDS = {
  MAX_ARCHIVE_BYTES: 16 * 1024 * 1024,
  MAX_UNPACKED_BYTES: 64 * 1024 * 1024,
} as const;

const CODELOAD = "https://codeload.github.com";

/** The tar format's block, which every header and every entry's padding is a whole number of. */
const TAR_BLOCK = 512;

/** The entry types read here (https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html#tag_20_94_13_01): a regular file, either spelling, and pax's two headers. */
const TAR_TYPE = {
  FILE: "0",
  FILE_OLD: "\0",
  PAX_ENTRY: "x",
  PAX_GLOBAL: "g",
} as const;

/** The pax record `git archive` names the commit in. */
const PAX_COMMIT = "comment";

/** The pax record that carries a path past ustar's fields. */
const PAX_PATH = "path";

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** A commit read whole: its sha, and every regular file by its path from the repository's root. */
export interface RepositoryArchive {
  readonly sha: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** A NUL-ended field of a header, as text. */
function field(header: Uint8Array, offset: number, length: number): string {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/** pax's records (`<length> <key>=<value>\n`, the length counting the record's every byte), by key. */
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

/** The archive's commit and regular files, read from the unpacked tar; none where a header's size is no number or the archive names no commit. */
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

/** The body off the wire up to the bound and one byte past it, so an archive past the bound is told apart from one at it. */
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

/** A ref as a path's segments, each escaped, since a branch's name may hold a slash. */
function refPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * The repository's commit at the ref, read whole from its archive: a
 * public repository's from codeload with no token, a private one's through
 * the API on the bearer given; none where GitHub serves no archive, it is
 * past the bounds, or it names no commit, which is logged by its kind
 * alone, since the caller reads the commit file by file instead.
 */
export function readRepositoryArchive(
  repository: { readonly fullName: string; readonly public: boolean },
  bearer: Redacted.Redacted | null,
  ref: string,
): Effect.Effect<Option.Option<RepositoryArchive>, never, HttpClient.HttpClient> {
  if (!repository.public && bearer === null) return Effect.succeed(Option.none());
  const request = repository.public
    ? HttpClientRequest.get(`${CODELOAD}/${repository.fullName}/tar.gz/${refPath(ref)}`)
    : githubRead(`/repos/${repository.fullName}/tarball/${refPath(ref)}`, bearer);
  const read = Effect.scoped(
    Effect.gen(function* () {
      const response = yield* send(request);
      if (response.status !== 200) {
        yield* Effect.logWarning(`An archive was not served: GitHub answered ${response.status}`);
        return Option.none<RepositoryArchive>();
      }
      const gzipped = yield* boundedBody(response);
      if (gzipped.byteLength > ARCHIVE_BOUNDS.MAX_ARCHIVE_BYTES) {
        yield* Effect.logWarning("An archive past its bound was not read");
        return Option.none<RepositoryArchive>();
      }
      const tar = yield* Effect.try(() =>
        gunzipSync(gzipped, { maxOutputLength: ARCHIVE_BOUNDS.MAX_UNPACKED_BYTES }),
      );
      const archive = readTar(tar);
      if (Option.isNone(archive)) yield* Effect.logWarning("An archive named no commit");
      return archive;
    }),
  );
  return read.pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`An archive was not read: ${failure._tag}`),
        Option.none<RepositoryArchive>(),
      ),
    ),
  );
}
