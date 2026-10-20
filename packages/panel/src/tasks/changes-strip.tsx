import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";

/**
 * changes-strip.tsx -- the thin strip Files changed leaves in its tree's place while the tree is hidden: one mark for each changed file, in the tree's order, the pointer resting on it peeking the tree out over the list.
 *
 * As stage-cli's collapsed picker does, the strip keeps the shape of the
 * change set in sight: each file's mark is coloured by what became of it,
 * as its letter is in the tree, dimmed once the member marked it viewed,
 * and the file the bar names stands out. The marks share the strip's
 * height, each no taller than a line's mark, so a large pull request draws
 * them thinner rather than out of sight. The pointer resting on the strip
 * peeks the tree over the list's right edge, as the right edge itself does
 * where the panel is too narrow for the tree beside it (`usePaneRoom`), and
 * leaving puts it away. The strip stands only where the tree would stand
 * beside the list (tasks.css); it is a picture of the files, read in the
 * tree it peeks, so it is hidden from assistive technology, which reaches
 * the tree through its toggle and ⇧F.
 */

/** What the strip wears, from its view's room: the pointer resting on it peeks the tree. */
export interface StripPeek {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
}

export function ChangesStrip({
  files,
  current,
  viewed,
  peek,
}: {
  /** The changed files, in the tree's order. */
  files: readonly CodingAgentChangedFile[];
  /** The file the bar names, which stands out. */
  current: string | undefined;
  /** Whether a file is marked viewed; none while the marks are not read. */
  viewed: ((path: string) => boolean) | undefined;
  peek: StripPeek;
}): React.JSX.Element {
  return (
    <div
      className="file-tree-strip ph-no-capture"
      aria-hidden="true"
      onPointerEnter={peek.onPointerEnter}
      onPointerLeave={peek.onPointerLeave}
    >
      {files.map((file) => (
        <span
          key={file.path}
          className="file-tree-strip-mark"
          data-status={file.status}
          data-viewed={viewed?.(file.path) === true ? "" : undefined}
          data-current={file.path === current ? "" : undefined}
        />
      ))}
    </div>
  );
}
