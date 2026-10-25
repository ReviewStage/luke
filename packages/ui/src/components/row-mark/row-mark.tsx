import type { ComponentPropsWithRef, ReactNode } from "react";

/**
 * row-mark.tsx -- a small mark a row or a tab wears beside its glyph and words to say one thing about it: that its work failed, or that a draft waits in its box.
 *
 * A mark stands a size under the glyph it follows, so it reads as a note on
 * the row rather than a second glyph, its own glyph filling it, in the ink
 * of what it says: a failure in the danger colour, a draft in the muted ink
 * beside the row's other marks. It is a picture named for a reader by
 * `label`, a fixed word, so nothing a row holds rides it. A hint may hang
 * from it (`Tooltip`), which hands it the hint's own handlers.
 *
 * Each kind keeps the class the window's sheets restage it by
 * (`failed-mark`, `draft-mark`), a placement hook rather than a look. It
 * draws in Tailwind utilities over the shared theme and takes no class or
 * style of its own.
 */

/** What a mark says, and so the ink it wears. */
export const ROW_MARK = {
  FAILED: "failed",
  DRAFT: "draft",
} as const;

export type RowMarkKind = (typeof ROW_MARK)[keyof typeof ROW_MARK];

/** Each kind's hook and ink. */
const KIND_CLASS = {
  [ROW_MARK.FAILED]: "failed-mark text-destructive",
  [ROW_MARK.DRAFT]: "draft-mark text-muted-foreground",
} as const satisfies Record<RowMarkKind, string>;

/** `glyph` as a mark saying `kind`, named `label`. */
export function RowMark({
  kind,
  label,
  glyph,
  ...anchor
}: {
  kind: RowMarkKind;
  /** What the mark is called, a fixed word. */
  label: string;
  /** The glyph, which fills the mark. */
  glyph: ReactNode;
} & Omit<
  ComponentPropsWithRef<"span">,
  "className" | "style" | "children" | "role" | "aria-label"
>): React.JSX.Element {
  return (
    <span
      {...anchor}
      className={`${KIND_CLASS[kind]} inline-flex size-row-mark flex-none items-center justify-center [&>svg]:size-full`}
      role="img"
      aria-label={label}
    >
      {glyph}
    </span>
  );
}
