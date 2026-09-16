import { useCallback, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActHandle } from "./act";
import { CONVERSATION_PAGE, type ConversationPage, type TranscriptRow } from "./subagents-panel";
import { useStateWithRef } from "./use-state-with-ref";

/**
 * The Conversation tab's page, on the settings page's own terms: reset by a
 * tab change, unwound by Escape before the tab is left. The transcript page
 * holds a transcript open on the host, so every page move goes through one
 * door, and leaving that page, by the back control, the button, Escape, a tab
 * change, or another transcript's press, lets go of it before anything else:
 * the host stops paging a transcript nobody is looking at, and the document
 * drops it. The one way onto the page is a row's press on the list, or a
 * chip's in the thread, which moves through the same door and then opens.
 */
export function useConversationPage(tell: ActHandle["tell"]) {
  const [conversationPage, setConversationPage, conversationPageNow] =
    useStateWithRef<ConversationPage>(CONVERSATION_PAGE.THREAD);
  /** The row the transcript page is of, held exactly while that page shows. */
  const [transcriptOpen, setTranscriptOpen] = useState<TranscriptRow | undefined>(undefined);
  const changeConversationPage = useCallback(
    (next: ConversationPage) => {
      if (conversationPageNow() === CONVERSATION_PAGE.TRANSCRIPT) {
        tell(ACT_KIND.CONVERSATION_CLOSE_CHILD_TRANSCRIPT);
        setTranscriptOpen(undefined);
      }
      setConversationPage(next);
    },
    [conversationPageNow, setConversationPage, tell],
  );
  const openTranscript = useCallback(
    (row: TranscriptRow) => {
      changeConversationPage(CONVERSATION_PAGE.TRANSCRIPT);
      setTranscriptOpen(row);
      tell(ACT_KIND.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: row.conversationId,
        kind: row.kind,
      });
    },
    [changeConversationPage, tell],
  );
  return { conversationPage, transcriptOpen, changeConversationPage, openTranscript };
}
