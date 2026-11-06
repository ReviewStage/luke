import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
  base64Bytes,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { useRef, useState } from "react";
import { reportShownFailure } from "./failure-report.js";
import { encodeImage, imageFiles } from "./feedback-images.js";
import { base64Of } from "./tasks/attached-files.js";
import { type FileDrop, useFileDrop } from "./use-file-drop.js";

const REFUSAL = {
  KIND: (name: string) => `${name} can't be attached. Attach images, PDFs, or text files.`,
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  EMPTY: (name: string) => `${name} is empty.`,
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
  TOO_MUCH: "These files are too large to send together.",
} as const;

function spellsText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

type FileRead = { readonly attachment: AgentAttachment } | { readonly refusal: string };

async function attachmentOf(file: File): Promise<FileRead> {
  const { name } = file;
  if (file.type.startsWith("image/")) {
    const image = await encodeImage(file, AGENT_BOUNDS.MAX_IMAGE_BYTES);
    if (image === undefined) return { refusal: REFUSAL.UNREADABLE(name) };
    return { attachment: { name, mediaType: image.mediaType, data: image.base64 } };
  }
  const pdf = file.type === AGENT_ATTACHMENT_TYPE.PDF || name.toLowerCase().endsWith(".pdf");
  const bound = pdf ? AGENT_BOUNDS.MAX_PDF_BYTES : AGENT_BOUNDS.MAX_TEXT_BYTES;
  if (file.size > bound) return { refusal: REFUSAL.TOO_LARGE(name) };
  const bytes = await file.arrayBuffer().then(
    (buffer) => new Uint8Array(buffer),
    (cause: unknown) => {
      reportShownFailure({ surface: FAILURE_SURFACE.ATTACHMENT_READ, cause }, Date.now());
      return undefined;
    },
  );
  if (bytes === undefined) return { refusal: REFUSAL.UNREADABLE(name) };
  if (bytes.length === 0) return { refusal: REFUSAL.EMPTY(name) };
  if (!pdf && !spellsText(bytes)) return { refusal: REFUSAL.KIND(name) };
  const mediaType = pdf ? AGENT_ATTACHMENT_TYPE.PDF : AGENT_ATTACHMENT_TYPE.TEXT;
  return { attachment: { name, mediaType, data: base64Of(bytes) } };
}

interface FilesRead {
  readonly attachments: readonly AgentAttachment[];
  readonly refusal: string | undefined;
}

async function readFiles(files: readonly File[]): Promise<FilesRead> {
  const attachments: AgentAttachment[] = [];
  let refusal: string | undefined;
  for (const file of files) {
    if (attachments.length >= AGENT_BOUNDS.MAX_ATTACHMENTS) {
      refusal ??= REFUSAL.FULL(AGENT_BOUNDS.MAX_ATTACHMENTS);
      break;
    }
    const read = await attachmentOf(file);
    if ("refusal" in read) refusal ??= read.refusal;
    else attachments.push(read.attachment);
  }
  return { attachments, refusal };
}

function withFiles(
  held: readonly AgentAttachment[],
  read: FilesRead,
  most: number = AGENT_BOUNDS.MAX_ATTACHMENTS,
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
    if (total > AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) {
      refusal ??= REFUSAL.TOO_MUCH;
      continue;
    }
    attachments.push(attachment);
  }
  return { attachments, refusal };
}

interface AttachedFilesHolder {
  readonly attachments: readonly AgentAttachment[];
  readonly update: (next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[]) => void;
}

export interface AttachedFilesOptions {
  readonly onRefusal: (words: string | undefined) => void;
  readonly holder?: AttachedFilesHolder | undefined;
  readonly most?: number | undefined;
  readonly held?: boolean | undefined;
}

export interface AttachedFiles {
  readonly attachments: readonly AgentAttachment[];
  readonly reading: boolean;
  readonly attach: (files: readonly File[]) => void;
  readonly paste: (files: readonly File[]) => boolean;
  readonly remove: (index: number) => void;
  readonly now: () => readonly AgentAttachment[];
  readonly set: (attachments: readonly AgentAttachment[]) => void;
  readonly drop: FileDrop;
}

export function useAttachedFiles(options: AttachedFilesOptions): AttachedFiles {
  const [own, setOwn] = useState<readonly AgentAttachment[]>([]);
  const ownNow = useRef(own);
  const ownHolder: AttachedFilesHolder = {
    attachments: own,
    update: (next) => {
      ownNow.current = next(ownNow.current);
      setOwn(ownNow.current);
    },
  };
  const latest = useRef(options);
  latest.current = options;
  const holderNow = () => latest.current.holder ?? ownHolder;
  const heldNow = () => latest.current.holder?.attachments ?? ownNow.current;
  const [reading, setReading] = useState(0);

  const take = (read: FilesRead) => {
    const { most = AGENT_BOUNDS.MAX_ATTACHMENTS, onRefusal } = latest.current;
    const taken = withFiles(heldNow(), read, most);
    holderNow().update((now) => withFiles(now, read, most).attachments);
    onRefusal(taken.refusal);
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || latest.current.held === true) return;
    setReading((count) => count + 1);
    void readFiles(files)
      .then(take)
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
