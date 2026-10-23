import {
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  type CodingAgentChangedFile,
} from "@luke/features/coding-agent-wire";
import { MARK_STRIP_LOOK, MARK_STRIP_TONE, MarkStrip, type MarkStripTone } from "@luke/ui";

/**
 * changes-strip.tsx -- the thin strip Files changed leaves in its tree's place while the tree is hidden: one mark for each changed file, in the tree's order, the pointer resting on it peeking the tree out over the list.
 *
 * As stage-cli's collapsed picker does, the strip keeps the shape of the
 * change set in sight: each file's mark is coloured by what became of it,
 * as its letter is in the tree, dimmed once the member marked it viewed,
 * and the file stood on, or at the top of the list, stands out. The marks
 * are `@luke/ui`'s strip's bars, which share the strip's height, so a large
 * pull request draws them thinner rather than out of sight. The pointer
 * resting on the strip peeks the tree over the list's right edge, as the
 * right edge itself does where the panel is too narrow for the tree beside
 * it (`usePaneRoom`), and leaving puts it away. The strip stands only where
 * the tree would stand beside the list (tasks.css); it is a picture of the
 * files, read in the tree it peeks, so it is hidden from assistive
 * technology, which reaches the tree through its toggle and ⇧F.
 */

/** What the strip wears, from its view's room: the pointer resting on it peeks the tree. */
export interface StripPeek {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
}

/** A file's mark's tone, as its letter's in the tree: added, deleted, renamed, or else changed. */
function statusTone(status: ChangedFileStatus): MarkStripTone {
  switch (status) {
    case CHANGED_FILE_STATUS.ADDED:
      return MARK_STRIP_TONE.COMPLETE;
    case CHANGED_FILE_STATUS.DELETED:
      return MARK_STRIP_TONE.DANGER;
    case CHANGED_FILE_STATUS.RENAMED:
      return MARK_STRIP_TONE.WORKING;
    default:
      return MARK_STRIP_TONE.ATTENTION;
  }
}

export function ChangesStrip({
  files,
  current,
  viewed,
  peek,
}: {
  /** The changed files, in the tree's order. */
  files: readonly CodingAgentChangedFile[];
  /** The file stood on, else the one at the top of the list, which stands out. */
  current: string | undefined;
  /** Whether a file is marked viewed; none while the marks are not read. */
  viewed: ((path: string) => boolean) | undefined;
  peek: StripPeek;
}): React.JSX.Element {
  return (
    <div className="file-tree-strip ph-no-capture">
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
