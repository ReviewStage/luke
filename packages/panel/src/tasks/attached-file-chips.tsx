import {
  ATTACHMENT_VIEW,
  attachmentView,
  chipBase64,
  type FileChip,
  sizeLabel,
} from "@luke/features/attachment-model";
import type { CodingAgentAttachment, CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { keptPictureIdOf } from "@luke/features/conversation-picture-wire";
import {
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  LIST_MOTION_WAY,
  ListMotion,
  motionRows,
  useLeaving,
} from "@luke/ui";
import { isRecord, isWireString } from "@luke/wire";
import { type ReactNode, type RefObject, useRef, useState } from "react";
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
 * without opening it, at once, so a message sent the moment after carries
 * nothing it took off, while the row's `ListMotion` holds the chip drawn as
 * it scales out, and scales in each file the box takes. The box's chips are
 * followed by the file each stands for: `attachmentChips` answers one chip
 * for each file the box holds, the same chip each time it is asked, and the
 * row names each by an id it mints for that chip, since two files the box
 * holds may carry the same name and bytes. An image the service kept beside the transcript is
 * named on its row by the picture's id rather than carried as bytes
 * (`messageFileChips`), and the transcript reads it through the agent's
 * pictures (`agent-pictures.tsx`'s `MessageFileChips`). A file the service
 * kept no bytes of, one eve staged in the sandbox before the row was
 * written, is drawn by its name alone, with nothing to open and nothing to
 * walk to.
 *
 * A line's files go up inside the one request that sends it, which says
 * nothing of how far its bytes have gone, so a line still on its way draws
 * its files going up without a share (`uploading`), and each takes its
 * check as the line's row lands.
 */

/** How the AI SDK spells a file part's type. */
const FILE_PART = "file";

/** The chip drawn for each file a message box holds, so the box's row follows a file by its chip. */
const BOX_CHIPS = new WeakMap<CodingAgentAttachment, FileChip>();

/** The files the message box holds, as chips: the same chip for a file each time. */
export function attachmentChips(attachments: readonly CodingAgentAttachment[]): FileChip[] {
  return attachments.map((file) => {
    const known = BOX_CHIPS.get(file);
    if (known !== undefined) return known;
    const chip = {
      name: file.name,
      mediaType: file.mediaType,
      url: `data:${file.mediaType};base64,${file.data}`,
    };
    BOX_CHIPS.set(file, chip);
    return chip;
  });
}

/** A file of a transcript's row as its chip draws it, beside the picture it was kept as where the row names that rather than carrying its bytes. */
export interface MessageFileChip extends FileChip {
  readonly pictureId?: string;
}

/** The files a row of the transcript carries, as chips: its AI SDK file parts, in order, each the row keeps no bytes of naming the picture it was kept as, where it was. */
export function messageFileChips(message: CodingAgentMessage): MessageFileChip[] {
  return message.parts.flatMap((part): MessageFileChip[] => {
    if (!isRecord(part) || part.type !== FILE_PART || !isWireString(part.mediaType)) return [];
    const chip = {
      name: isWireString(part.filename) ? part.filename : part.mediaType,
      mediaType: part.mediaType,
      url: isWireString(part.url) ? part.url : "",
    };
    const pictureId = chipBase64(chip) === "" ? keptPictureIdOf(part.providerMetadata) : undefined;
    return [pictureId === undefined ? chip : { ...chip, pictureId }];
  });
}

/** One file's chip in a row: its thumbnail or its type's icon, its name and size, its open, and its way off where the row has one. */
function FileChipOf({
  file,
  motionKey,
  onOpen,
  onRemove,
  uploading = false,
}: {
  file: FileChip;
  motionKey?: string | undefined;
  onOpen: (() => void) | undefined;
  onRemove: (() => void) | undefined;
  /** Whether the file is on its way up with the line it came on. */
  uploading?: boolean;
}): React.JSX.Element {
  const base64 = chipBase64(file);
  const thumbnail = base64 !== "" && attachmentView(file) === ATTACHMENT_VIEW.IMAGE;
  return (
    <AttachmentChip
      name={file.name}
      image={thumbnail ? file.url : undefined}
      icon={<FileTypeIcon name={file.name} />}
      detail={base64 === "" ? undefined : sizeLabel(base64)}
      onOpen={base64 === "" ? undefined : onOpen}
      onRemove={onRemove}
      motionKey={motionKey}
      state={uploading ? ATTACHMENT_CHIP_STATE.UPLOADING : ATTACHMENT_CHIP_STATE.READY}
    />
  );
}

/**
 * The message box's chips, each followed by an id minted for its file's
 * chip. Note that it is its own component under the row's `ListMotion`,
 * because `useLeaving` finds the motion through the context the motion
 * provides, and called above it would find none and let a chip go at once.
 * The row stands, hidden, while the box holds no file, because the motion
 * plays an arrival only into a list that stood before the change, so the
 * first file taken on scales in as every later one does.
 */
function BoxRow({
  row,
  files,
  onRemove,
  onOpen,
}: {
  row: RefObject<HTMLUListElement | null>;
  files: readonly FileChip[];
  onRemove: (index: number) => void;
  onOpen: (file: FileChip) => void;
}): ReactNode {
  const [ids] = useState(() => new WeakMap<FileChip, string>());
  const minted = useRef(0);
  const idOf = (file: FileChip): string => {
    const known = ids.get(file);
    if (known !== undefined) return known;
    minted.current += 1;
    const id = String(minted.current);
    ids.set(file, id);
    return id;
  };
  const drawn = useLeaving(files, idOf);
  return (
    <ul
      ref={row}
      className="attached-files"
      aria-label="Attached files"
      hidden={drawn.length === 0}
      {...motionRows()}
    >
      {drawn.map((entry) => {
        const index = files.indexOf(entry.value);
        return (
          <FileChipOf
            key={entry.key}
            file={entry.value}
            motionKey={entry.key}
            onOpen={entry.leaving ? undefined : () => onOpen(entry.value)}
            onRemove={entry.leaving || index === -1 ? undefined : () => onRemove(index)}
          />
        );
      })}
    </ul>
  );
}

/** The message box's row, under its `ListMotion`: a file taken off scales out where it stood, and one taken on scales in. */
function BoxFileChips({
  files,
  onRemove,
  onOpen,
}: {
  files: readonly FileChip[];
  onRemove: (index: number) => void;
  onOpen: (file: FileChip) => void;
}): ReactNode {
  const row = useRef<HTMLUListElement | null>(null);
  return (
    <ListMotion root={row} way={LIST_MOTION_WAY.SCALE}>
      <BoxRow row={row} files={files} onRemove={onRemove} onOpen={onOpen} />
    </ListMotion>
  );
}

export function AttachedFileChips({
  files,
  onRemove,
  uploading = false,
}: {
  files: readonly FileChip[];
  /** Takes one file off the message, by its place; nothing in the transcript, whose files are sent. */
  onRemove?: ((index: number) => void) | undefined;
  /** Whether the files are on their way up with the line they came on. */
  uploading?: boolean;
}): ReactNode {
  // The file open over the window, by its place among those that carry bytes.
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const openable = files.filter((file) => chipBase64(file) !== "");
  const open = (file: FileChip) => setViewing(openable.indexOf(file));
  const viewer =
    viewing === undefined ? null : (
      <AttachmentViewer
        files={openable}
        at={viewing}
        onAt={setViewing}
        onClose={() => setViewing(undefined)}
      />
    );
  if (onRemove !== undefined) {
    return (
      <>
        <BoxFileChips files={files} onRemove={onRemove} onOpen={open} />
        {viewer}
      </>
    );
  }
  if (files.length === 0) return null;
  return (
    <ul className="attached-files" aria-label="Attached files">
      {files.map((file, index) => (
        <FileChipOf
          key={`${String(index)}-${file.name}`}
          file={file}
          onOpen={() => open(file)}
          onRemove={undefined}
          uploading={uploading}
        />
      ))}
      {viewer}
    </ul>
  );
}
