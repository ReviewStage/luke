import { useCallback, useEffect, useRef } from "react";
import {
  beginPanelSpan,
  endPanelSpan,
  leavePanelSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
} from "../panel-spans.js";

/**
 * use-inbox-spans.ts -- the Inbox's own timings (`panel-spans.ts`): the page
 * opened to its list drawn with rows, and a row chosen to its thread drawn.
 */

/**
 * Ends `inbox.open`, which the Inbox's opening began, once the page draws a
 * row; the page going first leaves it untimed.
 */
export function useInboxOpenSpan(rowCount: number): void {
  useEffect(() => {
    if (rowCount > 0)
      endPanelSpan(PANEL_SPAN.INBOX_OPEN, () => ({ [PANEL_SPAN_ATTRIBUTE.ITEM_COUNT]: rowCount }));
  }, [rowCount]);
  useEffect(() => () => leavePanelSpan(PANEL_SPAN.INBOX_OPEN), []);
}

/**
 * Times a row chosen to its thread drawn: the ref's `timeOpen(itemId)` begins
 * it as a row is chosen, and the thread standing as `shownId` ends it, saying
 * whether the holder's own read `held` by then. The item already chosen has
 * nothing to wait on.
 */
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
  return timeOpen;
}
