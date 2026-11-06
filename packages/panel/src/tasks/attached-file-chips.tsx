import type { AgentAttachment, AgentTranscriptMessage } from "@repo/features/agent-wire";
import {
  ATTACHMENT_VIEW,
  attachmentView,
  chipBase64,
  type FileChip,
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
import { isRecord, isWireString } from "@repo/wire";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { AttachmentViewer } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

const FILE_PART = "file";

const BOX_CHIPS = new WeakMap<AgentAttachment, FileChip>();

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

export interface MessageFileChip extends FileChip {
  readonly pictureId?: string;
}

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
  onRemove?: ((index: number) => void) | undefined;
  uploading?: boolean;
}): ReactNode {
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
