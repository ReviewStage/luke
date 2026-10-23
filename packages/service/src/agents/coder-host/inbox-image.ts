import { posix } from "node:path";
import { type ConversationMediaType, isVideoType } from "@luke/features/conversation-picture-wire";
import { SIGNATURE_BYTES } from "@luke/features/image-signature";
import { INBOX_BOUNDS, type InboxImageType } from "@luke/features/inbox-wire";
import { mediaDimensions, sniffMediaType } from "@luke/features/media-signature";
import { Effect, Result } from "effect";
import type { SandboxSession } from "eve/sandbox";
import type { InboxImage } from "../../inbox/inbox-store.js";
import { SANDBOX_RECORDING } from "../browser/sandbox-recorder.js";

/**
 * inbox-image.ts -- a picture read from the agent's sandbox, an image block's or one `show_image` shows: the file at the path the agent named, bounded, and sniffed for what it is.
 *
 * The agent names a file in its sandbox, a screenshot it took of what it
 * rendered or a WebM it recorded of a flow, and nothing else of it: no
 * address, no type. The file is read here through the same door the
 * agent's own file tools reach the sandbox by, as a stream: its first
 * bytes are read for a PNG, JPEG, or WebP signature, or a WebM's where the
 * read takes one, as soon as they are in, since the name a file
 * carries says nothing about what it holds and the type is what the
 * picture is served to the desktop under, so a file that is no image is
 * refused at its first chunk, and one past the bound is refused at the
 * bound, neither read whole into the function's memory. A path is resolved
 * from the checkout as the file tools resolve one, so the agent spells it
 * as it spelled it to them. Each refusal is one sentence the model reads,
 * naming the path, so the agent mends the block rather than the item.
 */

/** The sandbox as the inbox reaches it: one file read as a stream of bytes, or nothing where there is no file. */
type InboxSandbox = Pick<SandboxSession, "readFile">;

/** The door to the session's sandbox, opened on first use: eve's `ctx.getSandbox()`, or a test's double. */
export type InboxSandboxDoor = () => Promise<InboxSandbox>;

/** Why a picture was not read, in the words the model reads; each is followed by the path. */
export interface SandboxImageRefusals {
  readonly NO_FILE: string;
  readonly NOT_IMAGE: string;
  readonly TOO_LARGE: string;
  readonly UNREADABLE: string;
}

/**
 * What one tool's read of a picture holds it to: the most bytes it may be,
 * the sentence each refusal opens with, which names the tool's own act, and
 * the types its first bytes may be sniffed as, which `show_image` widens to
 * a WebM it plays.
 */
export interface SandboxImageTerms<Type extends string = InboxImageType> {
  readonly maxBytes: number;
  readonly refusals: SandboxImageRefusals;
  readonly sniff: (head: Uint8Array) => Type | undefined;
}

/** A file read from the sandbox: the type its bytes were sniffed to be, and the bytes. */
export interface SandboxImage<Type extends string> {
  readonly contentType: Type;
  readonly bytes: Uint8Array;
}

/** Why an image block's picture was not read, in the words the model reads; each is followed by the path. */
const INBOX_IMAGE_REFUSAL: SandboxImageRefusals = {
  NO_FILE: "Not posted: an image block names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: an image block names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not posted: an image block names a picture larger than ${(INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB, or a video larger than ${(INBOX_BOUNDS.MAX_VIDEO_BYTES / 1_000_000).toFixed(1)} MB; render it smaller, or record a shorter flow:`,
  UNREADABLE: "Not posted: an image block's file could not be read from your sandbox:",
} as const;

/** The chunks as one array. */
function joined(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** Why a stream was not read whole: it is no image, or it ran past the bound. */
const STREAM_REFUSAL = {
  NOT_IMAGE: "not-image",
  TOO_LARGE: "too-large",
} as const;

type StreamRefusal = (typeof STREAM_REFUSAL)[keyof typeof STREAM_REFUSAL];

/**
 * The stream read whole as one picture: sniffed once its signature is in,
 * and stopped where it is no image or runs past the bound. The reader is
 * cancelled however the read ends, so a stream refused, or one that failed
 * mid-way, holds nothing open behind it.
 */
const readImageStream = Effect.fnUntraced(function* <Type extends string>(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  sniff: (head: Uint8Array) => Type | undefined,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let contentType: Type | undefined;
  return yield* Effect.gen(function* () {
    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());
      if (next.done) break;
      chunks.push(next.value);
      length += next.value.byteLength;
      if (length > maxBytes) return Result.fail(STREAM_REFUSAL.TOO_LARGE);
      if (contentType === undefined && length >= SIGNATURE_BYTES) {
        contentType = sniff(joined(chunks, length).subarray(0, SIGNATURE_BYTES));
        if (contentType === undefined) return Result.fail(STREAM_REFUSAL.NOT_IMAGE);
      }
    }
    const bytes = joined(chunks, length);
    // A file shorter than the longest signature is sniffed whole, since a JPEG's is three bytes.
    contentType ??= sniff(bytes);
    if (contentType === undefined) return Result.fail(STREAM_REFUSAL.NOT_IMAGE);
    const image: SandboxImage<Type> = { contentType, bytes };
    return Result.succeed(image);
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))));
});

/** A refusal of the picture at the path, in the words the model reads. */
function refused<Type extends string>(
  refusal: string,
  path: string,
): Result.Result<SandboxImage<Type>, string> {
  return Result.fail(`${refusal} ${path}`);
}

/** The stream's refusal in the words the model reads. */
function streamRefused<Type extends string>(
  refusal: StreamRefusal,
  refusals: SandboxImageRefusals,
  path: string,
): Result.Result<SandboxImage<Type>, string> {
  return refused(
    refusal === STREAM_REFUSAL.TOO_LARGE ? refusals.TOO_LARGE : refusals.NOT_IMAGE,
    path,
  );
}

/**
 * The picture at the path, read from the sandbox and held to the terms'
 * bound and the three types, or the one sentence refusing it in the terms'
 * words. A path is resolved from the checkout: inside it when relative, as
 * written when absolute.
 */
export function readSandboxImage<Type extends string>(
  door: InboxSandboxDoor,
  checkout: string,
  path: string,
  terms: SandboxImageTerms<Type>,
): Effect.Effect<Result.Result<SandboxImage<Type>, string>> {
  const resolved = posix.resolve(checkout, path);
  return Effect.gen(function* () {
    const sandbox = yield* Effect.tryPromise(() => door());
    const stream = yield* Effect.tryPromise(() => sandbox.readFile({ path: resolved }));
    if (stream === null) return refused<Type>(terms.refusals.NO_FILE, path);
    const read = yield* readImageStream(stream, terms.maxBytes, terms.sniff);
    return Result.isFailure(read) ? streamRefused<Type>(read.failure, terms.refusals, path) : read;
  }).pipe(Effect.catch(() => Effect.succeed(refused<Type>(terms.refusals.UNREADABLE, path))));
}

/**
 * Why a post refuses a file of its cloud browser's recorder, followed by the
 * path: `AGENTS.md` keeps a cloud browser's recording beside the transcript
 * alone, where `stop_recording` keeps it.
 */
export const BROWSER_RECORDING_REFUSAL =
  "Not posted: a recording of your cloud browser stays in your transcript, where stop_recording kept it; record the flow with Playwright's recordVideo to post it:";

/** Whether a path resolved in the sandbox names a file of the cloud browser's recorder, under any home it stands in. */
function inBrowserRecording(resolved: string): boolean {
  return `${resolved}/`.includes(`/${SANDBOX_RECORDING.DIRECTORY}/`);
}

/** The most bytes a posted file of the type may be: a still's bound, or a recording's. */
function postedBytesOf(type: ConversationMediaType): number {
  return isVideoType(type) ? INBOX_BOUNDS.MAX_VIDEO_BYTES : INBOX_BOUNDS.MAX_IMAGE_BYTES;
}

/**
 * A picture or a WebM recording a post draws, at the path, or the one
 * sentence refusing it in the refusals' words: a still held to the picture
 * bound, and a recording to the video bound and refused where it states no
 * size, as `show_image` refuses one (`@luke/features/media-signature`).
 * Note that the stream is read to the larger bound and a still is held to
 * its own once its type is known, because the type is sniffed from bytes
 * the bound has already let in. A file of the cloud browser's recorder is
 * refused before it is read, because its recording is kept beside the
 * transcript alone (`BROWSER_RECORDING_REFUSAL`).
 */
export function readSandboxMedia(
  door: InboxSandboxDoor,
  checkout: string,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<Result.Result<InboxImage, string>> {
  if (inBrowserRecording(posix.resolve(checkout, path))) {
    return Effect.succeed(refused<ConversationMediaType>(BROWSER_RECORDING_REFUSAL, path));
  }
  const terms = { maxBytes: INBOX_BOUNDS.MAX_VIDEO_BYTES, refusals, sniff: sniffMediaType };
  return Effect.map(
    readSandboxImage(door, checkout, path, terms),
    Result.flatMap((media) => {
      if (media.bytes.byteLength > postedBytesOf(media.contentType)) {
        return refused<ConversationMediaType>(refusals.TOO_LARGE, path);
      }
      if (
        isVideoType(media.contentType) &&
        mediaDimensions(media.bytes, media.contentType) === undefined
      ) {
        return refused<ConversationMediaType>(refusals.NOT_IMAGE, path);
      }
      return Result.succeed(media);
    }),
  );
}

/** An image block's picture or recording at the path, held to its bound, or the one sentence refusing it. */
export function readInboxImage(
  door: InboxSandboxDoor,
  checkout: string,
  path: string,
): Effect.Effect<Result.Result<InboxImage, string>> {
  return readSandboxMedia(door, checkout, path, INBOX_IMAGE_REFUSAL);
}
