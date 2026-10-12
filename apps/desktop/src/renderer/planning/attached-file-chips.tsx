import {
  base64Bytes,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@sidecar/hosted/coding-agent-wire";
import { DocumentIcon, RemoveIcon } from "@sidecar/panel";
import { isRecord, isWireString } from "@sidecar/wire";
import type { ReactNode } from "react";

/**
 * attached-file-chips.tsx -- the files on a message as a row of chips: in the message box, each with its way off, and over the developer's bubble in the transcript.
 *
 * An image is its thumbnail; any other file is a document glyph, its name,
 * and its size, as every chat draws one. Both read the file's bytes from a
 * `data:` URL, the one the message box made or the one the service kept on
 * the developer's row, so a transcript read back after a restart draws the
 * same row. A file the service kept no bytes of, one eve staged in the
 * sandbox before the row was written, is drawn by its name alone.
 */

/** One file as a chip draws it: its name, its type, and its bytes as a `data:` URL, empty where there are none. */
export interface FileChip {
  readonly name: string;
  readonly mediaType: string;
  readonly url: string;
}

/** How the AI SDK spells a file part's type. */
const FILE_PART = "file";

const KILOBYTE = 1_000;
const MEGABYTE = 1_000_000;

/** A size as a chip says it: kilobytes up to a megabyte, then megabytes to one place. */
function sizeLabel(bytes: number): string {
  if (bytes < MEGABYTE) return `${String(Math.max(1, Math.round(bytes / KILOBYTE)))} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** The files the message box holds, as chips. */
export function attachmentChips(attachments: readonly CodingAgentAttachment[]): FileChip[] {
  return attachments.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: `data:${file.mediaType};base64,${file.data}`,
  }));
}

/** The files a row of the transcript carries, as chips: its AI SDK file parts, in order. */
export function messageFileChips(message: CodingAgentMessage): FileChip[] {
  return message.parts.flatMap((part) =>
    isRecord(part) && part.type === FILE_PART && isWireString(part.mediaType)
      ? [
          {
            name: isWireString(part.filename) ? part.filename : part.mediaType,
            mediaType: part.mediaType,
            url: isWireString(part.url) ? part.url : "",
          },
        ]
      : [],
  );
}

export function AttachedFileChips({
  files,
  onRemove,
}: {
  files: readonly FileChip[];
  /** Takes one file off the message, by its place; nothing in the transcript, whose files are sent. */
  onRemove?: ((index: number) => void) | undefined;
}): ReactNode {
  if (files.length === 0) return null;
  return (
    <ul className="attached-files" aria-label="Attached files">
      {files.map((file, index) => {
        const base64 = file.url.startsWith("data:")
          ? file.url.slice(file.url.indexOf(",") + 1)
          : "";
        const image = file.mediaType.startsWith("image/") && base64 !== "";
        return (
          <li key={`${String(index)}-${file.name}`} className="attached-file" title={file.name}>
            {image ? (
              <img src={file.url} alt={file.name} />
            ) : (
              <>
                <DocumentIcon />
                <span className="attached-file-name">{file.name}</span>
                {base64 === "" ? null : (
                  <span className="attached-file-size">{sizeLabel(base64Bytes(base64))}</span>
                )}
              </>
            )}
            {onRemove === undefined ? null : (
              <button
                type="button"
                className="attached-file-remove"
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
              >
                <RemoveIcon />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
