import type { ComponentPropsWithRef, ReactNode } from "react";
import { GLYPH, OctagonMinusIcon } from "../../icons/icons.js";

export const ROW_MARK = {
  FAILED: "failed",
  DRAFT: "draft",
  BLOCKED: "blocked",
} as const;

export type RowMarkKind = (typeof ROW_MARK)[keyof typeof ROW_MARK];

const KIND_CLASS = {
  [ROW_MARK.FAILED]: "failed-mark text-destructive",
  [ROW_MARK.DRAFT]: "draft-mark text-muted-foreground",
  [ROW_MARK.BLOCKED]: "blocked-mark text-muted-foreground",
} as const satisfies Record<RowMarkKind, string>;

const FAILED_WORDS = "Failed";

export const BLOCKED_WORDS = "Blocked";

type MarkAnchor = Omit<
  ComponentPropsWithRef<"span">,
  "className" | "style" | "children" | "role" | "aria-label"
>;

export function RowMark({
  kind,
  label,
  glyph,
  ...anchor
}: {
  kind: RowMarkKind;
  label: string;
  glyph: ReactNode;
} & MarkAnchor): React.JSX.Element {
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

export function FailedMark(anchor: MarkAnchor): React.JSX.Element {
  return (
    <RowMark
      {...anchor}
      kind={ROW_MARK.FAILED}
      label={FAILED_WORDS}
      glyph={<GLYPH.FAILED aria-hidden="true" />}
    />
  );
}

export function BlockedMark(anchor: MarkAnchor): React.JSX.Element {
  return (
    <RowMark
      {...anchor}
      kind={ROW_MARK.BLOCKED}
      label={BLOCKED_WORDS}
      glyph={<OctagonMinusIcon aria-hidden="true" />}
    />
  );
}
