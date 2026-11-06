import { useCallback, useEffect, useRef } from "react";
import {
  beginPanelSpan,
  endPanelSpan,
  leavePanelSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
} from "../panel-spans.js";

export function useInboxOpenSpan(rowCount: number): void {
  useEffect(() => {
    if (rowCount > 0)
      endPanelSpan(PANEL_SPAN.INBOX_OPEN, () => ({ [PANEL_SPAN_ATTRIBUTE.ITEM_COUNT]: rowCount }));
  }, [rowCount]);
  useEffect(() => () => leavePanelSpan(PANEL_SPAN.INBOX_OPEN), []);
}

export function useInboxItemOpenSpan(shownId: string | undefined, held: boolean) {
  const asked = useRef<string | undefined>(undefined);
  const timeOpen = useCallback(
    (itemId: string) => {
      asked.current = itemId === shownId ? undefined : itemId;
      if (asked.current === undefined) leavePanelSpan(PANEL_SPAN.INBOX_ITEM_OPEN);
      else beginPanelSpan(PANEL_SPAN.INBOX_ITEM_OPEN);
    },
    [shownId],
  );
  useEffect(() => {
    if (shownId === undefined || asked.current !== shownId) return;
    asked.current = undefined;
    endPanelSpan(PANEL_SPAN.INBOX_ITEM_OPEN, () => ({ [PANEL_SPAN_ATTRIBUTE.HELD]: held ? 1 : 0 }));
  }, [shownId, held]);
  useEffect(
    () => () => {
      if (asked.current !== undefined) leavePanelSpan(PANEL_SPAN.INBOX_ITEM_OPEN);
    },
    [],
  );
  return timeOpen;
}
