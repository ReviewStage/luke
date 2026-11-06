import { base64Bytes } from "./agent-wire.js";
import { formatBytes } from "./number-format.js";

export interface FileChip {
  readonly name: string;
  readonly mediaType: string;
  readonly url: string;
}

export const ATTACHMENT_VIEW = {
  IMAGE: "image",
  VIDEO: "video",
  DIAGRAM: "diagram",
  TEXT: "text",
  OTHER: "other",
} as const;

export type AttachmentView = (typeof ATTACHMENT_VIEW)[keyof typeof ATTACHMENT_VIEW];

const PLAYED_VIDEO_TYPE = { WEBM: "video/webm", MP4: "video/mp4" } as const;
const PLAYED_VIDEO_TYPES: ReadonlySet<string> = new Set(Object.values(PLAYED_VIDEO_TYPE));

const DIAGRAM_EXTENSION = /\.(?:mmd|mermaid)$/iu;

export function chipBase64(file: FileChip): string {
  return file.url.startsWith("data:") ? file.url.slice(file.url.indexOf(",") + 1) : "";
}

export function sizeLabel(base64: string): string {
  return formatBytes(base64Bytes(base64));
}

export function attachmentView(file: FileChip): AttachmentView {
  if (file.mediaType.startsWith("image/")) return ATTACHMENT_VIEW.IMAGE;
  if (PLAYED_VIDEO_TYPES.has(file.mediaType)) return ATTACHMENT_VIEW.VIDEO;
  if (!file.mediaType.startsWith("text/")) return ATTACHMENT_VIEW.OTHER;
  return DIAGRAM_EXTENSION.test(file.name) ? ATTACHMENT_VIEW.DIAGRAM : ATTACHMENT_VIEW.TEXT;
}

export function attachmentText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
