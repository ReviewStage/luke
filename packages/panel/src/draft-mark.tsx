import { ROW_MARK, RowMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { PencilLineIcon } from "lucide-react";

export const DRAFT_WORD = "Draft";

export function DraftMark(): React.JSX.Element {
  return (
    <RowMark
      kind={ROW_MARK.DRAFT}
      label={DRAFT_WORD}
      glyph={<PencilLineIcon aria-hidden="true" />}
    />
  );
}

const NOT_DELIVERED_WORD = "Not delivered";

export function NotDeliveredMark(): React.JSX.Element {
  return <RowMark kind={ROW_MARK.FAILED} label={NOT_DELIVERED_WORD} glyph={<GLYPH.FAILED />} />;
}

export function leftMark(failed: boolean, drafted: boolean): React.JSX.Element | null {
  if (failed) return <NotDeliveredMark />;
  return drafted ? <DraftMark /> : null;
}
