import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
} from "@repo/features/agent-wire";
import { MARK_STRIP_LOOK, MarkStrip, STATUS_TONE, type StatusTone } from "@repo/ui";

export interface StripPeek {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
}

function statusTone(status: ChangedFileStatus): StatusTone {
  switch (status) {
    case CHANGED_FILE_STATUS.ADDED:
      return STATUS_TONE.COMPLETE;
    case CHANGED_FILE_STATUS.DELETED:
      return STATUS_TONE.DANGER;
    case CHANGED_FILE_STATUS.RENAMED:
      return STATUS_TONE.WORKING;
    default:
      return STATUS_TONE.ATTENTION;
  }
}

export function ChangesStrip({
  files,
  current,
  viewed,
  peek,
}: {
  files: readonly AgentChangedFile[];
  current: string | undefined;
  viewed: ((path: string) => boolean) | undefined;
  peek: StripPeek;
}): React.JSX.Element {
  return (
    <div className="file-tree-strip ph-no-capture hidden">
      <MarkStrip
        look={MARK_STRIP_LOOK.BARS}
        marks={files.map((file) => ({
          tone: statusTone(file.status),
          viewed: viewed?.(file.path) === true,
          current: file.path === current,
        }))}
        onPointerEnter={peek.onPointerEnter}
        onPointerLeave={peek.onPointerLeave}
      />
    </div>
  );
}
