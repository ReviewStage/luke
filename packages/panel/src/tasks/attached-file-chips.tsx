import {
  ATTACHMENT_VIEW,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@luke/features/attachment-model";
import type { CodingAgentAttachment, CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { lineFileIdOf } from "@luke/features/line-file-wire";
import { AttachmentChip } from "@luke/ui";
import { keepPictureRead, PICTURE_STATE, pictureNow } from "@luke/ui/picture-cache";
import { isRecord, isWireString } from "@luke/wire";
import { type ReactNode, useEffect, useReducer, useState } from "react";
import { useAgentPictures } from "./agent-pictures.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * attached-file-chips.tsx -- the files on a message as a row of chips: in the message box, each with its way off, and over the developer's bubble in the transcript.
 *
 * An image is its thumbnail; any other file is its type's icon as the file
 * tree draws it (`file-type-icon.tsx`), its name, and its size, as every
 * chat draws one. Both read the file's bytes from a `data:` URL: the one the
 * message box made, the one an older developer's row carries, or the one a
 * file the service kept beside the conversation is read into through the
 * transcript's picture door, so a transcript read back after a restart
 * draws the same row. A press on a chip
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

/** The URLs a row's file parts carry, in order: a `data:` URL, or one naming the row its bytes were kept as. */
function fileUrlsOf(message: CodingAgentMessage): string[] {
  return message.parts.flatMap((part) =>
    isRecord(part) && part.type === FILE_PART && isWireString(part.url) ? [part.url] : [],
  );
}

/** The kept rows a row of the transcript names its files by, in order (`@luke/features/line-file-wire`). */
export function keptFileIdsOf(message: CodingAgentMessage): string[] {
  return fileUrlsOf(message).flatMap((url) => lineFileIdOf(url) ?? []);
}

/**
 * The files a row of the transcript carries, as chips: its AI SDK file
 * parts, in order. A file the service kept beside the conversation is named
 * by its row, and drawn from the `data:` URL its bytes were read into, by
 * that row's id, among `kept`; by its name alone until they land.
 */
export function messageFileChips(
  message: CodingAgentMessage,
  kept: ReadonlyMap<string, string> = new Map(),
): FileChip[] {
  return message.parts.flatMap((part) => {
    if (!isRecord(part) || part.type !== FILE_PART || !isWireString(part.mediaType)) return [];
    const url = isWireString(part.url) ? part.url : "";
    const keptId = lineFileIdOf(url);
    return [
      {
        name: isWireString(part.filename) ? part.filename : part.mediaType,
        mediaType: part.mediaType,
        url: keptId === undefined ? url : (kept.get(keptId) ?? ""),
      },
    ];
  });
}

/**
 * The files over a developer's row in an agent's transcript: those it
 * carries inline as they stand, and those the service kept beside the
 * conversation each read once through the transcript's picture door, kept
 * in the window's picture cache as a picture is, so a row drawn again
 * reads nothing twice.
 */
export function SentFileChips({ message }: { message: CodingAgentMessage }): ReactNode {
  const door = useAgentPictures();
  const ids = keptFileIdsOf(message);
  const idsKey = ids.join(" ");
  const [, landed] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (door === undefined) return;
    let standing = true;
    for (const id of idsKey === "" ? [] : idsKey.split(" ")) {
      if (pictureNow(door.owner, id).kind === PICTURE_STATE.READY) continue;
      void door.read(door.owner, id).then(
        (answer) => {
          if ("failure" in answer) return;
          keepPictureRead(door.owner, id, `data:${answer.contentType};base64,${answer.base64}`);
          if (standing) landed();
        },
        () => undefined,
      );
    }
    return () => {
      standing = false;
    };
  }, [door, idsKey]);
  const kept = new Map<string, string>();
  for (const id of ids) {
    const state = door === undefined ? undefined : pictureNow(door.owner, id);
    if (state?.kind === PICTURE_STATE.READY) kept.set(id, state.url);
  }
  return <AttachedFileChips files={messageFileChips(message, kept)} />;
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
