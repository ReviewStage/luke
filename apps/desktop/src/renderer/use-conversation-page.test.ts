// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHILD_STATUS } from "@sidecar/hosted/reads-wire";
import { TRANSCRIPT_KIND } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, type ActKind } from "#shared/messages/acts";
import { CONVERSATION_PAGE, type TranscriptRow } from "./agents-panel";
import { useConversationPage } from "./use-conversation-page";

type Page = ReturnType<typeof useConversationPage>;

const CHILD_ROW: TranscriptRow = {
  conversationId: "5e000000-0000-4000-8000-000000000001",
  kind: TRANSCRIPT_KIND.CHILD,
  title: "tests",
  status: CHILD_STATUS.RUNNING,
};

const AGENT_ROW: TranscriptRow = {
  conversationId: "6f000000-0000-4000-8000-000000000001",
  kind: TRANSCRIPT_KIND.OBSERVED,
  title: "luke",
  status: CHILD_STATUS.SETTLED,
};

/** Mounts the hook alone, handing back what it last rendered and every act it told, in order. */
function mount() {
  const told: { kind: ActKind; payload?: unknown }[] = [];
  let page: Page | undefined;
  function Probe() {
    page = useConversationPage((kind: ActKind, ...[payload]: unknown[]) => {
      told.push(payload === undefined ? { kind } : { kind, payload });
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    createRoot(container).render(createElement(Probe));
  });
  return {
    told,
    page: () => {
      assert.ok(page);
      return page;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("a transcript's open moves through the page door, so one transcript to another closes before it opens, and leaving the page closes alone", () => {
  const { told, page } = mount();
  assert.equal(page().conversationPage, CONVERSATION_PAGE.THREAD);
  assert.equal(page().transcriptOpen, undefined);

  // From the thread there is nothing to let go of: the open alone is told.
  act(() => page().openTranscript(CHILD_ROW));
  assert.equal(page().conversationPage, CONVERSATION_PAGE.TRANSCRIPT);
  assert.deepEqual(page().transcriptOpen, CHILD_ROW);
  assert.deepEqual(told, [
    {
      kind: ACT_KIND.CONVERSATION_OPEN_CHILD_TRANSCRIPT,
      payload: { conversationId: CHILD_ROW.conversationId, kind: TRANSCRIPT_KIND.CHILD },
    },
  ]);

  // Another transcript from this one: the close precedes the open, and the page holds the new row.
  told.length = 0;
  act(() => page().openTranscript(AGENT_ROW));
  assert.equal(page().conversationPage, CONVERSATION_PAGE.TRANSCRIPT);
  assert.deepEqual(page().transcriptOpen, AGENT_ROW);
  assert.deepEqual(told, [
    { kind: ACT_KIND.CONVERSATION_CLOSE_CHILD_TRANSCRIPT },
    {
      kind: ACT_KIND.CONVERSATION_OPEN_CHILD_TRANSCRIPT,
      payload: { conversationId: AGENT_ROW.conversationId, kind: TRANSCRIPT_KIND.OBSERVED },
    },
  ]);

  // Back to the list lets go of it; a move that begins off the transcript page tells nothing.
  told.length = 0;
  act(() => page().changeConversationPage(CONVERSATION_PAGE.AGENTS));
  assert.equal(page().conversationPage, CONVERSATION_PAGE.AGENTS);
  assert.equal(page().transcriptOpen, undefined);
  assert.deepEqual(told, [{ kind: ACT_KIND.CONVERSATION_CLOSE_CHILD_TRANSCRIPT }]);
  told.length = 0;
  act(() => page().changeConversationPage(CONVERSATION_PAGE.THREAD));
  assert.equal(page().conversationPage, CONVERSATION_PAGE.THREAD);
  assert.deepEqual(told, []);
});
