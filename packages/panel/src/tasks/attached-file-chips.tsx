import {
  ATTACHMENT_VIEW,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@luke/features/attachment-model";
import type { CodingAgentAttachment, CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { AttachmentChip } from "@luke/ui";
import { isRecord, isWireString } from "@luke/wire";
import { type ReactNode, useState } from "react";
import { AttachmentViewer } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * attached-file-chips.tsx -- the files on a message as a row of chips: in the message box, each with its way off, and over the developer's bubble in the transcript.
 *
 * An image is its thumbnail; any other file is its type's icon as the file
 * tree draws it (`file-type-icon.tsx`), its name, and its size, as every
 * chat draws one. Both read the file's bytes from a `data:` URL, the one the
 * message box made or the one the service kept on the developer's row, so a
 * transcript read back after a restart draws the same row. A press on a chip
 * opens its file over the window (`attachment-viewer.tsx`), walking the
 * message's files from there; a chip's way off in the box takes it off
 * without opening it. A file the service kept no bytes of, one eve staged
 * in the sandbox before the row was written, is drawn by its name alone,
 * with nothing to open and nothing to walk to.
 */

/** How the AI SDK spells a file part's type. */
const FILE_PART = "file";

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
  // The file open over the window, by its place among those that carry bytes.
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  if (files.length === 0) return null;
  const openable = files.filter((file) => chipBase64(file) !== "");
  return (
    <ul className="attached-files" aria-label="Attached files">
      {files.map((file, index) => {
        const base64 = chipBase64(file);
        const thumbnail = base64 !== "" && attachmentView(file) === ATTACHMENT_VIEW.IMAGE;
        return (
          <AttachmentChip
            key={`${String(index)}-${file.name}`}
            name={file.name}
            image={thumbnail ? file.url : undefined}
            icon={<FileTypeIcon name={file.name} />}
            detail={base64 === "" ? undefined : sizeLabel(base64)}
            onOpen={base64 === "" ? undefined : () => setViewing(openable.indexOf(file))}
            onRemove={onRemove === undefined ? undefined : () => onRemove(index)}
          />
        );
      })}
      {viewing === undefined ? null : (
        <AttachmentViewer
          files={openable}
          at={viewing}
          onAt={setViewing}
          onClose={() => setViewing(undefined)}
        />
      )}
    </ul>
  );
}
