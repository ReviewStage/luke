// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  type AgentTranscriptControl,
  type TranscriptFollower,
  useAgentTranscript,
} from "./use-agent-transcript.js";

/**
 * use-agent-transcript.test.ts -- a tab's transcript is followed while the
 * tab is shown and let go when it is not; the pages pushed for it join by
 * id, a page pushed for another transcript is left alone, and one that says
 * the transcript could not be read offers Try again, which follows it anew
 * while the messages held stand. Synthetic ids throughout.
 */

const AGENT: CodingAgentTranscriptKey = {
  kind: TRANSCRIPT_KIND.AGENT,
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
};
const OTHER: CodingAgentTranscriptKey = { ...AGENT, callId: "call-7" };

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** A follower that writes down each follow and let-go, and pushes what the test says. */
function scriptedFollower() {
  const asked: string[] = [];
  const listeners = new Set<(changed: CodingAgentTranscriptChanged) => void>();
  const follower: TranscriptFollower = {
    follow: (transcript) => void asked.push(`follow:${transcript.callId ?? "own"}`),
    unfollow: (transcript) => void asked.push(`unfollow:${transcript.callId ?? "own"}`),
    onTranscript: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const push = (transcript: CodingAgentTranscriptKey, page: CodingAgentMessagesAnswerView) =>
    act(() => {
      for (const listener of listeners) listener({ transcript, page });
    });
  return { follower, asked, push };
}

/** A page saying `text` under `id`. */
function pageOf(id: string, text: string): CodingAgentMessagesAnswerView {
  return {
    messages: [{ id, role: "assistant", parts: [{ type: "text", text }] }],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.RUNNING,
    title: null,
  };
}

/** What the probe last drew of the hook. */
interface Seen {
  current: AgentTranscriptControl | undefined;
}

/** The hook drawn under a probe that keeps what it last answered. */
function drawn(follower: TranscriptFollower) {
  const seen: Seen = { current: undefined };
  function Probe(props: { shown: boolean }) {
    seen.current = useAgentTranscript({
      transcript: AGENT,
      shown: props.shown,
      follower,
      onStatus: () => undefined,
      onTitle: () => undefined,
    });
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const draw = (shown: boolean) => act(() => root?.render(createElement(Probe, { shown })));
  return { seen, draw };
}

test("a shown tab follows its transcript, joins the pages pushed for it alone, and lets it go once hidden", () => {
  const { follower, asked, push } = scriptedFollower();
  const { seen, draw } = drawn(follower);

  draw(true);
  push(AGENT, pageOf("m-1", "Reading the invites."));
  push(OTHER, pageOf("m-9", "A worker's words."));
  push(AGENT, pageOf("m-1", "Reading the invites again."));
  push(AGENT, pageOf("m-2", "Writing the expiry."));
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-1", "m-2"],
  );
  assert.equal(seen.current?.pages, 3);

  draw(false);
  push(AGENT, pageOf("m-3", "Not heard."));
  assert.deepEqual(asked, ["follow:own", "unfollow:own"]);
  assert.equal(seen.current?.messages.length, 2);
});

test("a page that could not be read offers Try again, which follows the transcript anew, the messages held standing", () => {
  const { follower, asked, push } = scriptedFollower();
  const { seen, draw } = drawn(follower);

  draw(true);
  push(AGENT, pageOf("m-1", "Reading the invites."));
  push(AGENT, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(seen.current?.failed, true);
  assert.equal(seen.current?.messages.length, 1);

  act(() => seen.current?.onRetry());
  push(AGENT, pageOf("m-2", "Writing the expiry."));
  assert.equal(seen.current?.failed, false);
  assert.deepEqual(asked, ["follow:own", "unfollow:own", "follow:own"]);
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-1", "m-2"],
  );
});
