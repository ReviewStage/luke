import type { DatabaseServices } from "@luke/database/core/query";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import type { PlanStoreFailure } from "@luke/database/models/plan-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  CONVERSATION_PICTURE_BOUNDS,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@luke/features/conversation-picture-wire";
import { imageDimensions, SIGNATURE_BYTES, sniffImageType } from "@luke/features/image-signature";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@luke/wire";
import { Effect, Option } from "effect";

/**
 * relay-pictures.ts -- the pictures in a tool's answer, kept beside the conversation and named in the stored output by id rather than carried as base64.
 *
 * An integration's MCP tool may answer a list of content blocks among which
 * stand pictures: an `image` block's base64 `data`, or a `resource` block's
 * image `blob`. eve hands the model the list as it came, as file parts
 * (`connectionToolModelOutput`), and the relay is handed the same list to
 * record; left as it is, the record would carry the bytes into every read,
 * journal amend, and long poll of the transcript, and the row would draw
 * them as base64. So before a result is told, each picture in such a list
 * is kept (`conversation-pictures.ts`), and the stored block names it
 * instead: `picture` for one kept, or `omitted` with its `byteCount` for
 * one that was too large, past the conversation's bound, or no picture the
 * service reads. Every other key of the block stands as the tool wrote it,
 * and nothing the model was handed changes, since eve reads its own copy.
 */

type PictureEffect<A> = Effect.Effect<A, PlanStoreFailure, DatabaseServices>;

/** The kinds of content block an MCP tool answers, as eve reads them (`tool-result.js`). */
const MCP_BLOCK = {
  TEXT: "text",
  IMAGE: "image",
  AUDIO: "audio",
  RESOURCE: "resource",
  RESOURCE_LINK: "resource_link",
} as const;

const MCP_BLOCK_TYPES: ReadonlySet<string> = new Set(Object.values(MCP_BLOCK));

const IMAGE_MEDIA_PREFIX = "image/";

function isMcpBlock(value: UnparsedWireValue): value is WireRecord {
  return isRecord(value) && isWireString(value.type) && MCP_BLOCK_TYPES.has(value.type);
}

/**
 * Whether an output is an MCP tool's list of blocks as eve hands it on:
 * blocks alone, at least one of them no text, which is the one shape eve
 * leaves unparsed (`toConnectionToolResult`).
 */
function isMcpBlockList(output: UnparsedWireValue): output is readonly WireRecord[] {
  return (
    Array.isArray(output) &&
    output.length > 0 &&
    output.every(isMcpBlock) &&
    output.some((block) => block.type !== MCP_BLOCK.TEXT)
  );
}

/** How many bytes base64 decodes to, read off its length, so a picture far over the bound is never decoded. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** How many base64 characters spell a picture's signature, read before anything else of a blob is. */
const SIGNATURE_CHARS = Math.ceil(SIGNATURE_BYTES / 3) * 4;

/**
 * Whether a resource's blob is a picture: one its type names an image, or,
 * where it names no type, which MCP allows, one whose first bytes are a
 * picture's signature. Note that a blob of another type stands as the tool
 * wrote it, because the record keeps what it cannot name otherwise.
 */
function isPictureBlob(blob: string, mimeType: UnparsedWireValue): boolean {
  if (isWireString(mimeType)) return mimeType.startsWith(IMAGE_MEDIA_PREFIX);
  const head = new Uint8Array(Buffer.from(blob.slice(0, SIGNATURE_CHARS), "base64"));
  return sniffImageType(head) !== undefined;
}

/** The record without one of its keys. */
function without(record: WireRecord, key: string): WireRecord {
  return Object.fromEntries(Object.entries(record).filter(([held]) => held !== key));
}

/** What the record names in a picture's place: the row it was kept as, or why it was not kept, and its size. */
function pictureNote(
  target: ConversationTarget,
  base64: string,
): PictureEffect<
  | { readonly picture: WireRecord }
  | { readonly omitted: PictureOmission; readonly byteCount: number }
> {
  return Effect.gen(function* () {
    const byteCount = decodedLength(base64);
    if (byteCount > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES) {
      return { omitted: PICTURE_OMISSION.TOO_LARGE, byteCount };
    }
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    const contentType = sniffImageType(bytes);
    const dimensions = contentType === undefined ? undefined : imageDimensions(bytes, contentType);
    if (contentType === undefined || dimensions === undefined) {
      return { omitted: PICTURE_OMISSION.UNSUPPORTED, byteCount: bytes.byteLength };
    }
    const kept = yield* keepConversationPicture(target, { bytes, contentType, ...dimensions });
    if (Option.isNone(kept))
      return { omitted: PICTURE_OMISSION.LIMIT, byteCount: bytes.byteLength };
    return { picture: { ...kept.value } };
  });
}

/** One block as the record keeps it: a picture's bytes named by what was kept of them, and every other block as it came. */
function keptBlock(target: ConversationTarget, block: WireRecord): PictureEffect<WireRecord> {
  if (block.type === MCP_BLOCK.IMAGE && isWireString(block.data)) {
    const data = block.data;
    return Effect.map(pictureNote(target, data), (note) => ({
      ...without(block, "data"),
      ...note,
    }));
  }
  const resource = block.resource;
  if (
    block.type === MCP_BLOCK.RESOURCE &&
    isRecord(resource) &&
    isWireString(resource.blob) &&
    isPictureBlob(resource.blob, resource.mimeType)
  ) {
    const blob = resource.blob;
    return Effect.map(pictureNote(target, blob), (note) => ({
      ...block,
      resource: { ...without(resource, "blob"), ...note },
    }));
  }
  return Effect.succeed(block);
}

/**
 * A tool's output as the record keeps it: an MCP tool's list of blocks with
 * every picture kept beside the conversation and named by it, and any other
 * output as it came.
 */
export function keptPictures(
  target: ConversationTarget,
  output: UnparsedWireValue,
): PictureEffect<UnparsedWireValue> {
  if (!isMcpBlockList(output)) return Effect.succeed(output);
  return Effect.forEach(output, (block) => keptBlock(target, block));
}
