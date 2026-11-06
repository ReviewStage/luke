import { posix } from "node:path";
import { type ConversationMediaType, isVideoType } from "@repo/features/conversation-picture-wire";
import { SIGNATURE_BYTES } from "@repo/features/image-signature";
import { INBOX_BOUNDS, type InboxImageType } from "@repo/features/inbox-wire";
import { mediaDimensions, sniffMediaType } from "@repo/features/media-signature";
import { Effect, Result } from "effect";
import type { InboxImage } from "../../inbox/inbox-store.js";

interface InboxSandbox {
  readonly readFile: (options: {
    readonly path: string;
  }) => PromiseLike<ReadableStream<Uint8Array> | null>;
}

export type InboxSandboxDoor = () => Promise<InboxSandbox>;

export interface SandboxImageRefusals {
  readonly NO_FILE: string;
  readonly NOT_IMAGE: string;
  readonly TOO_LARGE: string;
  readonly UNREADABLE: string;
}

export interface SandboxImageTerms<Type extends string = InboxImageType> {
  readonly maxBytes: number;
  readonly refusals: SandboxImageRefusals;
  readonly sniff: (head: Uint8Array) => Type | undefined;
}

export interface SandboxImage<Type extends string> {
  readonly contentType: Type;
  readonly bytes: Uint8Array;
}

function joined(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const STREAM_REFUSAL = {
  NOT_IMAGE: "not-image",
  TOO_LARGE: "too-large",
} as const;

type StreamRefusal = (typeof STREAM_REFUSAL)[keyof typeof STREAM_REFUSAL];

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
    contentType ??= sniff(bytes);
    if (contentType === undefined) return Result.fail(STREAM_REFUSAL.NOT_IMAGE);
    const image: SandboxImage<Type> = { contentType, bytes };
    return Result.succeed(image);
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))));
});

function refused<Type extends string>(
  refusal: string,
  path: string,
): Result.Result<SandboxImage<Type>, string> {
  return Result.fail(`${refusal} ${path}`);
}

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

function postedBytesOf(type: ConversationMediaType): number {
  return isVideoType(type) ? INBOX_BOUNDS.MAX_VIDEO_BYTES : INBOX_BOUNDS.MAX_IMAGE_BYTES;
}

export function readSandboxMedia(
  door: InboxSandboxDoor,
  checkout: string,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<Result.Result<InboxImage, string>> {
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
