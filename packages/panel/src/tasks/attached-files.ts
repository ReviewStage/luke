import {
  base64Bytes,
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { encodeImage } from "../feedback-images.js";

/**
 * attached-files.ts -- the files picked, pasted, or dropped on an agent's message box, read on this machine into what the message carries, or why one cannot come.
 *
 * Only a file the developer handed the box is read, and only its bytes and
 * its own name: never a path, never a file beside it. An image is kept as
 * it is while it is PNG, JPEG, or WebP and small enough, and re-encoded
 * smaller as WebP otherwise, as a feedback screenshot is
 * (`../feedback-images.ts`); a PDF is kept as it is; anything else comes
 * as a text file where its bytes spell UTF-8 with no NUL in them, whatever
 * its extension, since code arrives under every extension there is. Each
 * is held to its type's bound, a message to ten files and to 3 MB
 * together, and the first file that cannot come says why in the box's
 * note while the ones that can still come.
 */

/** Why a file did not come, in the words the box's note says. */
const REFUSAL = {
  KIND: (name: string) => `${name} can't be attached. Attach images, PDFs, or text files.`,
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  EMPTY: (name: string) => `${name} is empty.`,
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
  FULL: `A message can carry up to ${CODING_AGENT_BOUNDS.MAX_ATTACHMENTS} files.`,
  TOO_MUCH: "These files are too large to send together.",
} as const;

/** Whether bytes spell text a model can read: UTF-8, with no NUL, which no text file holds. */
function spellsText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Bytes as base64, a chunk at a time, since one call's arguments cannot hold a file. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** One file read: what the message carries of it, or why it cannot come. */
type FileRead = { readonly attachment: CodingAgentAttachment } | { readonly refusal: string };

/** One file read into what a message carries, or why it cannot come. */
async function attachmentOf(file: File): Promise<FileRead> {
  // Note that the name needs no bound of its own here, because macOS bounds a file's name inside the wire's.
  const { name } = file;
  if (file.type.startsWith("image/")) {
    const image = await encodeImage(file, CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES);
    // Note that a re-encoded image keeps the name it was picked under, which is the one its chip says.
    if (image === undefined) return { refusal: REFUSAL.UNREADABLE(name) };
    return { attachment: { name, mediaType: image.mediaType, data: image.base64 } };
  }
  const pdf = file.type === CODING_AGENT_ATTACHMENT_TYPE.PDF || name.toLowerCase().endsWith(".pdf");
  const bound = pdf ? CODING_AGENT_BOUNDS.MAX_PDF_BYTES : CODING_AGENT_BOUNDS.MAX_TEXT_BYTES;
  if (file.size > bound) return { refusal: REFUSAL.TOO_LARGE(name) };
  const bytes = new Uint8Array(await file.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length === 0) return { refusal: REFUSAL.EMPTY(name) };
  if (!pdf && !spellsText(bytes)) return { refusal: REFUSAL.KIND(name) };
  const mediaType = pdf ? CODING_AGENT_ATTACHMENT_TYPE.PDF : CODING_AGENT_ATTACHMENT_TYPE.TEXT;
  return { attachment: { name, mediaType, data: base64Of(bytes) } };
}

/** Files read: what the message may carry of them, in order, and why the first that cannot come did not. */
export interface FilesRead {
  readonly attachments: readonly CodingAgentAttachment[];
  readonly refusal: string | undefined;
}

/**
 * The files handed to the box, each read as above, in order, and no more
 * than a message holds; the first refusal is the one said. Nothing here
 * reads the box, so a read that lands late is taken after whatever the
 * box holds by then (`withFiles`).
 */
export async function readFiles(files: readonly File[]): Promise<FilesRead> {
  const attachments: CodingAgentAttachment[] = [];
  let refusal: string | undefined;
  for (const file of files) {
    if (attachments.length >= CODING_AGENT_BOUNDS.MAX_ATTACHMENTS) {
      refusal ??= REFUSAL.FULL;
      break;
    }
    const read = await attachmentOf(file);
    if ("refusal" in read) refusal ??= read.refusal;
    else attachments.push(read.attachment);
  }
  return { attachments, refusal };
}

/**
 * Files read, taken after those the box holds, in order, while the message
 * stays within its count and its bytes together; the read's own refusal is
 * said first, then the first file the bounds left out.
 */
export function withFiles(held: readonly CodingAgentAttachment[], read: FilesRead): FilesRead {
  const attachments = [...held];
  let refusal = read.refusal;
  for (const attachment of read.attachments) {
    if (attachments.length >= CODING_AGENT_BOUNDS.MAX_ATTACHMENTS) {
      refusal ??= REFUSAL.FULL;
      break;
    }
    const total = attachments.reduce(
      (sum, each) => sum + base64Bytes(each.data),
      base64Bytes(attachment.data),
    );
    if (total > CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) {
      refusal ??= REFUSAL.TOO_MUCH;
      continue;
    }
    attachments.push(attachment);
  }
  return { attachments, refusal };
}
