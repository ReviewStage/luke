import type { AgentAttachment, AgentTranscriptMessage } from "@repo/features/agent-wire";
import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  linesLabel,
  peekOf,
  sizeLabel,
} from "@repo/features/attachment-model";
import { keptPictureIdOf } from "@repo/features/conversation-picture-wire";
import {
  ALIGN,
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  LIST_MOTION_WAY,
  ListMotion,
  useLeaving,
} from "@repo/ui";
import { TextCursorInputIcon } from "@repo/ui/icons";
import { isRecord, isWireString } from "@repo/wire";
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * attached-file-chips.tsx -- the files on a message as a row of chips: in the message box, each with its way off, and over the developer's bubble in the transcript.
 *
 * An image is its thumbnail; any other file is its type's icon as the file
 * tree draws it (`file-type-icon.tsx`), its name, and its size, as every
 * chat app draws one, a text file its count of lines instead, with the head
 * of its words in the card its chip hangs. A text file the message box holds
 * opens with a way to put its words back into the box where they fit
 * (`putBack`), as a long paste the box took as a file (`use-attached-files.ts`). Both read the file's bytes from a `data:` URL, the one the
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

/** The viewer's way to put a text file's words back into the message box. */
const PUT_BACK_LABEL = "Put back in message";

/** The chip drawn for each file a message box holds, so the box's row follows a file by its chip. */
const BOX_CHIPS = new WeakMap<AgentAttachment, FileChip>();

/** The files the message box holds, as chips: the same chip for a file each time. */
export function attachmentChips(attachments: readonly AgentAttachment[]): FileChip[] {
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
export function messageFileChips(message: AgentTranscriptMessage): MessageFileChip[] {
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
  const view = base64 === "" ? ATTACHMENT_VIEW.OTHER : attachmentView(file);
  const thumbnail = view === ATTACHMENT_VIEW.IMAGE;
  // Note that a text file's words are read once for its file, since a chip draws again on every keystroke of the box it stands in.
  const text = useMemo(
    () => (view === ATTACHMENT_VIEW.TEXT ? attachmentText(base64) : undefined),
    [view, base64],
  );
  return (
    <AttachmentChip
      name={file.name}
      image={thumbnail ? file.url : undefined}
      icon={<FileTypeIcon name={file.name} />}
      detail={base64 === "" ? undefined : text === undefined ? sizeLabel(base64) : linesLabel(text)}
      peek={text === undefined ? undefined : peekOf(text)}
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
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      ref={row}
      className="attached-files"
      aria-label="Attached files"
      hidden={drawn.length === 0}
      moves
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
    </Inline>
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

/** How a message box takes a text file's words back: the characters it has room for, and what takes them, by the file's place. */
export interface PutBack {
  readonly room: number;
  readonly onPutBack: (index: number, words: string) => void;
}

/** The viewer's Put back in message: offered for a text file whose words fit the box's room, closing the viewer before the file leaves the row it walks. */
function putBackAction(
  files: readonly FileChip[],
  putBack: PutBack,
  close: () => void,
): ViewerAction {
  const words = (file: FileChip) => attachmentText(chipBase64(file));
  return {
    label: PUT_BACK_LABEL,
    icon: <TextCursorInputIcon aria-hidden="true" />,
    offeredFor: (file) =>
      attachmentView(file) === ATTACHMENT_VIEW.TEXT && words(file).length <= putBack.room,
    onPress: (file) => {
      close();
      putBack.onPutBack(files.indexOf(file), words(file));
    },
  };
}

export function AttachedFileChips({
  files,
  onRemove,
  putBack,
  uploading = false,
}: {
  files: readonly FileChip[];
  /** Takes one file off the message, by its place; nothing in the transcript, whose files are sent. */
  onRemove?: ((index: number) => void) | undefined;
  /** Takes a text file's words back into the message box; nothing where the box takes none. */
  putBack?: PutBack | undefined;
  /** Whether the files are on their way up with the line they came on. */
  uploading?: boolean;
}): ReactNode {
  // The file open over the window, by its place among those that carry bytes.
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const openable = files.filter((file) => chipBase64(file) !== "");
  const open = (file: FileChip) => setViewing(openable.indexOf(file));
  const close = () => setViewing(undefined);
  const viewer =
    viewing === undefined ? null : (
      <AttachmentViewer
        files={openable}
        at={viewing}
        onAt={setViewing}
        onClose={close}
        action={putBack === undefined ? undefined : putBackAction(files, putBack, close)}
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
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      className="attached-files"
      aria-label="Attached files"
    >
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
    </Inline>
  );
}
