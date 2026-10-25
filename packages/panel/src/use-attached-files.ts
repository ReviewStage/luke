import {
  base64Bytes,
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { useRef, useState } from "react";
import { encodeImage, imageFiles } from "./feedback-images.js";
import { ATTACH_TAKES, type AttachTakes, base64Of } from "./tasks/attached-files.js";
import { type FileDrop, useFileDrop } from "./use-file-drop.js";

/**
 * use-attached-files.ts -- the files a message box holds before it sends: the ones picked by its +, pasted, or dropped on it, read and taken after the ones it holds, and why any did not come.
 *
 * Every box that takes files takes them here, so a pick, a paste, and a
 * drop come the same way in each: read on this machine, held to the box's
 * count and to the bytes a message carries together, and taken after
 * whatever the box holds as the read lands, so neither a read that landed first nor a chip taken off
 * meanwhile is undone. A paste takes the pictures on the clipboard alone,
 * so text pastes as it always does. The first file of a hand-off that
 * cannot come says why in the box's one note, and a hand-off that all came
 * takes a standing file note down. A box keeps its files where it keeps its
 * draft, or here where it keeps none.
 *
 * Only a file the developer handed the box is read, and only its bytes and
 * its own name: never a path, never a file beside it. An image is kept as
 * it is while it is PNG, JPEG, or WebP and small enough, and re-encoded
 * smaller as WebP otherwise, as a feedback screenshot is
 * (`./feedback-images.ts`); a PDF is kept as it is; anything else comes
 * as a text file where its bytes spell UTF-8 with no NUL in them, whatever
 * its extension, since code arrives under every extension there is. Each
 * is held to its type's bound, a message to ten files and to 3 MB
 * together, and the first file that cannot come says why in the box's
 * note while the ones that can still come.
 */

/** Why a file did not come, in the words the box's note says. */
const REFUSAL = {
  KIND: (name: string) => `${name} can't be attached. Attach images, PDFs, or text files.`,
  NOT_IMAGE: (name: string) => `${name} can't be attached. Attach images.`,
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  EMPTY: (name: string) => `${name} is empty.`,
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
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

/**
 * The files handed to a box that it reads at all, in order: every one where
 * it takes any file, and the pictures alone where it takes only those, the
 * first other file saying why it did not come before anything is read.
 */
function filesTaken(
  files: readonly File[],
  takes: AttachTakes,
): { readonly files: readonly File[]; readonly refusal: string | undefined } {
  if (takes === ATTACH_TAKES.FILES) return { files, refusal: undefined };
  const images = files.filter((file) => file.type.startsWith("image/"));
  const other = files.find((file) => !images.includes(file));
  return {
    files: images,
    refusal: other === undefined ? undefined : REFUSAL.NOT_IMAGE(other.name),
  };
}

/** Files read: what the message may carry of them, in order, and why the first that cannot come did not. */
interface FilesRead {
  readonly attachments: readonly CodingAgentAttachment[];
  readonly refusal: string | undefined;
}

/**
 * The files handed to the box, each read as above, in order, and no more
 * than a message holds; the first refusal is the one said. Nothing here
 * reads the box, so a read that lands late is taken after whatever the
 * box holds by then (`withFiles`).
 */
async function readFiles(files: readonly File[]): Promise<FilesRead> {
  const attachments: CodingAgentAttachment[] = [];
  let refusal: string | undefined;
  for (const file of files) {
    if (attachments.length >= CODING_AGENT_BOUNDS.MAX_ATTACHMENTS) {
      refusal ??= REFUSAL.FULL(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS);
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
 * stays within its count, a message's to an agent unless the box carries
 * fewer, and its bytes together; the read's own refusal is said first, then
 * the first file the bounds left out.
 */
function withFiles(
  held: readonly CodingAgentAttachment[],
  read: FilesRead,
  most: number = CODING_AGENT_BOUNDS.MAX_ATTACHMENTS,
): FilesRead {
  const attachments = [...held];
  let refusal = read.refusal;
  for (const attachment of read.attachments) {
    if (attachments.length >= most) {
      refusal ??= REFUSAL.FULL(most);
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

/** Where a box keeps its files: the files as it draws them, and a change handed what it holds as the change lands. */
interface AttachedFilesHolder {
  readonly attachments: readonly CodingAgentAttachment[];
  readonly update: (
    next: (was: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
}

/** What a box takes and where its files and its note go. */
export interface AttachedFilesOptions {
  /** Says the box's note: why the last files handed did not all come, or nothing once they did. */
  readonly onRefusal: (words: string | undefined) => void;
  /** Where the box keeps its files, its draft for one; the hook's own state where none is given. */
  readonly holder?: AttachedFilesHolder | undefined;
  /** What the box carries; any file a message to an agent takes where none is given. */
  readonly takes?: AttachTakes | undefined;
  /** The most files the box carries; a message to an agent's where none is given. */
  readonly most?: number | undefined;
  /** Whether the box takes no files now, as the agent box while a send holds it. */
  readonly held?: boolean | undefined;
}

/** The files a box holds and the ways it takes more and lets them go. */
export interface AttachedFiles {
  readonly attachments: readonly CodingAgentAttachment[];
  /** Whether files handed to the box are still being read, which a send waits on. */
  readonly reading: boolean;
  /** Takes files picked or handed to the box, in order. */
  readonly attach: (files: readonly File[]) => void;
  /** Takes the pictures among pasted files, answering whether there were any, so text pastes as it always does. */
  readonly paste: (files: readonly File[]) => boolean;
  readonly remove: (index: number) => void;
  /** The files the box holds this moment, for a callback that outlives the render it was made in. */
  readonly now: () => readonly CodingAgentAttachment[];
  /** Sets the files the box holds outright, as a send empties it and a send that failed puts them back. */
  readonly set: (attachments: readonly CodingAgentAttachment[]) => void;
  /** The drop target the box's card spreads, and whether files are over it. */
  readonly drop: FileDrop;
}

/** The files a box holds, read as they are handed to it on the terms `options` sets. */
export function useAttachedFiles(options: AttachedFilesOptions): AttachedFiles {
  const [own, setOwn] = useState<readonly CodingAgentAttachment[]>([]);
  // The files held as of the last change, which a read landing late is taken after.
  const ownNow = useRef(own);
  const ownHolder: AttachedFilesHolder = {
    attachments: own,
    update: (next) => {
      ownNow.current = next(ownNow.current);
      setOwn(ownNow.current);
    },
  };
  // Note that a read lands on the options as they stand when it lands, since the box may have drawn again meanwhile.
  const latest = useRef(options);
  latest.current = options;
  const holderNow = () => latest.current.holder ?? ownHolder;
  const heldNow = () => latest.current.holder?.attachments ?? ownNow.current;
  const [reading, setReading] = useState(0);

  const take = (refused: string | undefined, read: FilesRead) => {
    const { most = CODING_AGENT_BOUNDS.MAX_ATTACHMENTS, onRefusal } = latest.current;
    const taken = withFiles(heldNow(), read, most);
    holderNow().update((now) => withFiles(now, read, most).attachments);
    onRefusal(refused ?? taken.refusal);
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || latest.current.held === true) return;
    const handed = filesTaken(files, latest.current.takes ?? ATTACH_TAKES.FILES);
    if (handed.files.length === 0) {
      latest.current.onRefusal(handed.refusal);
      return;
    }
    setReading((count) => count + 1);
    void readFiles(handed.files)
      .then((read) => take(handed.refusal, read))
      .finally(() => setReading((count) => count - 1));
  };
  const drop = useFileDrop((files) => attach(Array.from(files)), { over: options.held !== true });
  return {
    attachments: (options.holder ?? ownHolder).attachments,
    reading: reading > 0,
    attach,
    paste: (files) => {
      const pasted = imageFiles(files);
      if (pasted.length === 0) return false;
      attach(pasted);
      return true;
    },
    remove: (index) => {
      latest.current.onRefusal(undefined);
      holderNow().update((was) => was.filter((_, at) => at !== index));
    },
    now: heldNow,
    set: (next) => {
      latest.current.onRefusal(undefined);
      holderNow().update(() => next);
    },
    drop,
  };
}
