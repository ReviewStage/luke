import type { CodeRef } from "@repo/features/task-wire";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
} from "@repo/ui";
import { fileFolder, fileName, fileRefText, lineRangeText } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { useTaskMentions } from "./task-mentions.js";

export interface FileLook {
  readonly icon: React.JSX.Element;
  readonly label: string;
  readonly detail: string | undefined;
  readonly terms: readonly string[];
}

export function fileLook(path: string): FileLook {
  const name = fileName(path);
  return {
    icon: <FileTypeIcon name={name} />,
    label: name,
    detail: fileFolder(path),
    terms: [path],
  };
}

export function FileCard({
  path,
  repository,
  note,
}: {
  path: string;
  repository?: string | undefined;
  note?: string | undefined;
}): React.JSX.Element {
  return (
    <HoverCard data-file-card="">
      <HoverCardHead glyph={<FileTypeIcon name={fileName(path)} />} name={path} sub={repository} />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
    </HoverCard>
  );
}

export function FileRef({
  codeRef,
  repository: named,
  onOpen,
}: {
  codeRef: CodeRef;
  repository?: string | undefined;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const task = useTaskMentions()?.repository ?? undefined;
  const repository = named ?? task;
  return (
    <InlineRef
      look={INLINE_REF_LOOK.LINK}
      glyph={<FileTypeIcon name={fileName(codeRef.path)} />}
      label={codeRef.path}
      name={INLINE_REF_NAME.PATH}
      state={lineRangeText(codeRef)}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      pressLabel={onOpen === undefined ? undefined : `Open ${fileRefText(codeRef)}`}
      card={<FileCard path={codeRef.path} repository={repository} />}
      data-file-ref=""
    />
  );
}
