import { base64Bytes } from "./coding-agent-wire.js";

/**
 * attachment-model.ts -- one file on a message as its chip and its viewer read it: its bytes from its `data:` URL, its size in words, and how it is shown.
 *
 * A file arrives as a `data:` URL, the one the message box made or the one
 * the service kept on the developer's row; a file the service kept no bytes
 * of has an empty one, and there is nothing of it to show but its name.
 */

/** One file as a chip draws it: its name, its type, and its bytes as a `data:` URL, empty where there are none. */
export interface FileChip {
  readonly name: string;
  readonly mediaType: string;
  readonly url: string;
}

/** How the viewer shows a file: as a picture, played as a video, as its lines, or by its icon and name with a way to save it. */
export const ATTACHMENT_VIEW = {
  IMAGE: "image",
  VIDEO: "video",
  TEXT: "text",
  OTHER: "other",
} as const;

export type AttachmentView = (typeof ATTACHMENT_VIEW)[keyof typeof ATTACHMENT_VIEW];

/** The videos the viewer plays, the ones Chromium plays everywhere; any other video is shown by its icon. */
const PLAYED_VIDEO_TYPE = { WEBM: "video/webm", MP4: "video/mp4" } as const;
const PLAYED_VIDEO_TYPES: ReadonlySet<string> = new Set(Object.values(PLAYED_VIDEO_TYPE));

const KILOBYTE = 1_000;
const MEGABYTE = 1_000_000;

/** A file's bytes in base64, read off its `data:` URL; empty where it carries none. */
export function chipBase64(file: FileChip): string {
  return file.url.startsWith("data:") ? file.url.slice(file.url.indexOf(",") + 1) : "";
}

/** A file's size as a chip says it: kilobytes up to a megabyte, then megabytes to one place. */
export function sizeLabel(base64: string): string {
  const bytes = base64Bytes(base64);
  if (bytes < MEGABYTE) return `${String(Math.max(1, Math.round(bytes / KILOBYTE)))} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** How the viewer shows a file that carries bytes. */
export function attachmentView(file: FileChip): AttachmentView {
  if (file.mediaType.startsWith("image/")) return ATTACHMENT_VIEW.IMAGE;
  if (PLAYED_VIDEO_TYPES.has(file.mediaType)) return ATTACHMENT_VIEW.VIDEO;
  if (file.mediaType.startsWith("text/")) return ATTACHMENT_VIEW.TEXT;
  return ATTACHMENT_VIEW.OTHER;
}

/** A text file's words, read from its base64 as UTF-8, which is all a text attachment may spell. */
export function attachmentText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
