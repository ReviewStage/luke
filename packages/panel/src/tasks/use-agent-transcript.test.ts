// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import {
  type AgentTranscriptControl,
  type TranscriptFollower,
  useAgentTranscript,
  windowTranscriptFollower,
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

/** A follower that writes down each follow and let-go, and pushes what the test says to the stream of that transcript. */
function scriptedFollower() {
  const asked: string[] = [];
  const hearing = new Map<string, (page: CodingAgentMessagesAnswerView) => void>();
  const follower: TranscriptFollower = (transcript, hear) => {
    const name = transcript.callId ?? "own";
    asked.push(`follow:${name}`);
    hearing.set(name, hear);
    return () => {
      asked.push(`unfollow:${name}`);
      hearing.delete(name);
    };
  };
  const push = (transcript: CodingAgentTranscriptKey, page: CodingAgentMessagesAnswerView) =>
    act(() => hearing.get(transcript.callId ?? "own")?.(page));
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

/** A page saying the agent's one worker stands at `status`, its title and start alike each time. */
function workerPage(status: CodingAgentStatus): CodingAgentMessagesAnswerView {
  return {
    messages: [],
    cursor: "1:1",
    status: CODING_AGENT_STATUS.RUNNING,
    title: "Wire the schema",
    subagentTitles: [{ callId: "call-1", title: "Read the schema" }],
    delegations: [{ callId: "call-1", startedAt: 10 }],
    subagents: [
      {
        callId: "call-1",
        status,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        startedAt: 10,
      },
    ],
  };
}

test("a page that says the agent's workers as they stood keeps what the tab holds of them, and one that says a worker stands otherwise is held", () => {
  const { follower, push } = scriptedFollower();
  const { seen, draw } = drawn(follower);

  draw(true);
  push(AGENT, workerPage(CODING_AGENT_STATUS.RUNNING));
  const first = seen.current;
  push(AGENT, workerPage(CODING_AGENT_STATUS.RUNNING));
  const again = seen.current;
  assert.equal(again?.pages, (first?.pages ?? 0) + 1);
  assert.equal(again?.subagentTitles, first?.subagentTitles);
  assert.equal(again?.delegations, first?.delegations);
  assert.equal(again?.subagents, first?.subagents);

  push(AGENT, workerPage(CODING_AGENT_STATUS.COMPLETED));
  assert.equal(seen.current?.subagents.get("call-1")?.status, CODING_AGENT_STATUS.COMPLETED);
});

test("a stream that opens only after its tab let it go is closed at once", async () => {
  let open: (stream: AsyncIteratorObject<CodingAgentMessagesAnswerView>) => void = () => undefined;
  let closed = false;
  const stream: AsyncIteratorObject<CodingAgentMessagesAnswerView> = {
    next: () => new Promise(() => undefined),
    return: () => {
      closed = true;
      return Promise.resolve({ done: true, value: undefined });
    },
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
  // SAFETY: the follower calls this one procedure, and reads what it answers as an async iterator alone.
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_TRANSCRIPT]: () =>
      new Promise((resolve) => {
        open = resolve;
      }),
  } as unknown as Parameters<typeof fakeActPort>[0]);

  const stop = windowTranscriptFollower(AGENT, () => undefined);
  stop();
  open(stream);
  for (let tick = 0; tick < 12 && !closed; tick += 1) await Promise.resolve();
  assert.equal(closed, true);
});

test("a page a read already out hands over after the tab let go of its stream is heard by no one", async () => {
  let hand: (read: IteratorResult<CodingAgentMessagesAnswerView>) => void = () => undefined;
  const stream: AsyncIteratorObject<CodingAgentMessagesAnswerView> = {
    next: () =>
      new Promise((resolve) => {
        hand = resolve;
      }),
    return: () => Promise.resolve({ done: true, value: undefined }),
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
  // SAFETY: the follower calls this one procedure, and reads what it answers as an async iterator alone.
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_TRANSCRIPT]: () => Promise.resolve(stream),
  } as unknown as Parameters<typeof fakeActPort>[0]);
  const heard: CodingAgentMessagesAnswerView[] = [];

  const stop = windowTranscriptFollower(AGENT, (page) => heard.push(page));
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  stop();
  hand({ done: false, value: pageOf("m-1", "Too late.") });
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  assert.deepEqual(heard, []);
});
