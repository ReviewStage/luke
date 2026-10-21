// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentTranscriptKey,
  type CodingAgentTranscriptOlderAnswer,
  type CodingAgentTranscriptOlderParams,
  type CodingAgentTranscriptPage,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import {
  installPanelSpanRecorder,
  jsonBytes,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
  type PanelSpan,
} from "../panel-spans.js";
import { fakeActPort } from "../testing/app-bridge.js";
import {
  type AgentTranscriptControl,
  type TranscriptFollower,
  type TranscriptOlderReader,
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
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** A follower that writes down each follow and let-go, and pushes what the test says to the stream of that transcript. */
function scriptedFollower() {
  const asked: string[] = [];
  const hearing = new Map<string, (page: CodingAgentTranscriptPage) => void>();
  const follower: TranscriptFollower = (transcript, hear) => {
    const name = transcript.callId ?? "own";
    asked.push(`follow:${name}`);
    hearing.set(name, hear);
    return () => {
      asked.push(`unfollow:${name}`);
      hearing.delete(name);
    };
  };
  const push = (transcript: CodingAgentTranscriptKey, page: CodingAgentTranscriptPage) =>
    act(() => hearing.get(transcript.callId ?? "own")?.(page));
  return { follower, asked, push };
}

/** A page saying `text` under `id`. */
function pageOf(id: string, text: string): CodingAgentTranscriptPage {
  return {
    messages: [{ id, role: "assistant", parts: [{ type: "text", text }] }],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.RUNNING,
    title: null,
    caughtUp: false,
  };
}

/** Messages saying their own ids. */
function said(ids: readonly string[]): CodingAgentMessage[] {
  return ids.map((id) => ({ id, role: "assistant", parts: [{ type: "text", text: id }] }));
}

/** The newest page, as a follow opens with it: its messages by id, and where the older page is read below where one stands. */
function newestOf(ids: readonly string[], before?: string): CodingAgentTranscriptPage {
  return {
    messages: said(ids),
    cursor: "9:0",
    status: CODING_AGENT_STATUS.RUNNING,
    title: null,
    newest: true,
    caughtUp: false,
    ...(before === undefined ? undefined : { before }),
  };
}

/** What the probe last drew of the hook. */
interface Seen {
  current: AgentTranscriptControl | undefined;
}

/** The hook drawn under a probe that keeps what it last answered. */
function drawn(follower: TranscriptFollower, older?: TranscriptOlderReader) {
  const seen: Seen = { current: undefined };
  function Probe(props: { shown: boolean }) {
    seen.current = useAgentTranscript({
      transcript: AGENT,
      shown: props.shown,
      follower,
      older,
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
function workerPage(status: CodingAgentStatus): CodingAgentTranscriptPage {
  return {
    messages: [],
    cursor: "1:1",
    status: CODING_AGENT_STATUS.RUNNING,
    title: "Wire the schema",
    caughtUp: true,
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
  let open: (stream: AsyncIteratorObject<CodingAgentTranscriptPage>) => void = () => undefined;
  let closed = false;
  const stream: AsyncIteratorObject<CodingAgentTranscriptPage> = {
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
  let hand: (read: IteratorResult<CodingAgentTranscriptPage>) => void = () => undefined;
  const stream: AsyncIteratorObject<CodingAgentTranscriptPage> = {
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
  const heard: CodingAgentTranscriptPage[] = [];

  const stop = windowTranscriptFollower(AGENT, (page) => heard.push(page));
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  stop();
  hand({ done: false, value: pageOf("m-1", "Too late.") });
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  assert.deepEqual(heard, []);
});

test("an agent that ended stays followed while its tab is shown, so the lines a call into it writes still reach the tab", () => {
  const { follower, asked, push } = scriptedFollower();
  const { seen, draw } = drawn(follower);
  const ended = (id: string, text: string): CodingAgentTranscriptPage => ({
    ...pageOf(id, text),
    status: CODING_AGENT_STATUS.COMPLETED,
  });

  draw(true);
  push(AGENT, ended("m-1", "Invites now expire after seven days."));
  // A call into the ended agent writes its spoken lines, which the stream still pushes.
  push(AGENT, ended("said-1", "Walk me through the expiry job."));
  push(AGENT, ended("said-2", "It reads pending invites oldest first."));

  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-1", "said-1", "said-2"],
  );
  assert.equal(seen.current?.pageStatus, CODING_AGENT_STATUS.COMPLETED);
  assert.deepEqual(asked, ["follow:own"], "the ended agent's stream is never let go while shown");
});

test("a follow is timed to its first page drawn and to the page that caught it up, by what they held", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const { follower, push } = scriptedFollower();
  const { draw } = drawn(follower);

  draw(true);
  vi.setSystemTime(1_000_400);
  const first = newestOf(["m-1"], "1");
  push(AGENT, first);
  vi.setSystemTime(1_000_900);
  const caughtUp: CodingAgentTranscriptPage = {
    ...pageOf("m-1", "x"),
    messages: [],
    caughtUp: true,
  };
  push(AGENT, caughtUp);
  push(AGENT, pageOf("m-2", "Writing the expiry."));
  uninstall();

  assert.deepEqual(
    spans.map((span) => ({
      name: span.name,
      waited: span.endedAt - span.startedAt,
      attributes: span.attributes(),
    })),
    [
      {
        name: PANEL_SPAN.TRANSCRIPT_FIRST_PAINT,
        waited: 400,
        attributes: {
          [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: 1,
          [PANEL_SPAN_ATTRIBUTE.PAGE_BYTES]: jsonBytes(first),
        },
      },
      {
        name: PANEL_SPAN.TRANSCRIPT_CAUGHT_UP,
        waited: 900,
        attributes: {
          [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: 1,
          [PANEL_SPAN_ATTRIBUTE.PAGE_BYTES]: jsonBytes(caughtUp),
        },
      },
    ],
  );
});

test("a follow let go before its first page landed is timed by no span", () => {
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const { follower, push } = scriptedFollower();
  const { draw } = drawn(follower);

  draw(true);
  draw(false);
  push(AGENT, pageOf("m-1", "Not heard."));
  uninstall();

  assert.deepEqual(spans, []);
});

/** An older reader that writes down each read and answers it when the test hands the answer. */
function scriptedOlder() {
  const asked: CodingAgentTranscriptOlderParams[] = [];
  let answer: (older: CodingAgentTranscriptOlderAnswer) => void = () => undefined;
  const older: TranscriptOlderReader = (params) => {
    asked.push(params);
    return new Promise((resolve) => {
      answer = resolve;
    });
  };
  const hand = (older: CodingAgentTranscriptOlderAnswer) =>
    act(async () => {
      answer(older);
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    });
  return { older, asked, hand };
}

test("a tab opens on the newest page and reads older pages one at a time below it as it is asked, each put before what it holds", async () => {
  const { follower, push } = scriptedFollower();
  const { older, asked, hand } = scriptedOlder();
  const { seen, draw } = drawn(follower, older);

  draw(true);
  push(AGENT, newestOf(["m-3", "m-4"], "3"));
  assert.equal(seen.current?.hasOlder, true);
  act(() => seen.current?.loadOlder());
  act(() => seen.current?.loadOlder());
  assert.deepEqual(asked, [{ ...AGENT, before: "3" }]);
  assert.equal(seen.current?.loadingOlder, true);

  // A tail message landing while the read is out joins at the end, as ever.
  push(AGENT, pageOf("m-5", "Writing the expiry."));
  await hand({ messages: said(["m-1", "m-2"]), before: "1" });
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-1", "m-2", "m-3", "m-4", "m-5"],
  );
  assert.equal(seen.current?.loadingOlder, false);

  act(() => seen.current?.loadOlder());
  assert.deepEqual(asked.at(-1), { ...AGENT, before: "1" });
  await hand({ messages: said(["m-0"]) });
  assert.equal(seen.current?.messages[0]?.id, "m-0");
  assert.equal(seen.current?.hasOlder, false);
  act(() => seen.current?.loadOlder());
  assert.equal(asked.length, 2);
  assert.equal(seen.current?.olderFailed, false);
});

test("an older read that failed leaves what is held and may be asked again", async () => {
  const { follower, push } = scriptedFollower();
  const { older, asked, hand } = scriptedOlder();
  const { seen, draw } = drawn(follower, older);

  draw(true);
  push(AGENT, newestOf(["m-3"], "3"));
  act(() => seen.current?.loadOlder());
  await hand({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(seen.current?.olderFailed, true);
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-3"],
  );
  assert.equal(seen.current?.hasOlder, true);
  act(() => seen.current?.loadOlder());
  assert.equal(asked.length, 2);
});

test("a newest page that meets what is held joins it, older pages and all; one that does not takes its place, so nothing between them is left out", async () => {
  const { follower, push } = scriptedFollower();
  const { older, hand } = scriptedOlder();
  const { seen, draw } = drawn(follower, older);

  draw(true);
  push(AGENT, newestOf(["m-3", "m-4"], "3"));
  push(AGENT, pageOf("m-5", "Writing."));
  draw(false);
  draw(true);
  // Shown again with little written meanwhile: the newest page holds the last message held.
  push(AGENT, newestOf(["m-4", "m-5", "m-6"], "4"));
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-3", "m-4", "m-5", "m-6"],
  );
  assert.equal(seen.current?.hasOlder, true);

  draw(false);
  draw(true);
  // An older read that failed is the failed cursor's alone.
  act(() => seen.current?.loadOlder());
  await hand({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(seen.current?.olderFailed, true);
  draw(false);
  draw(true);
  // Shown again after more than a page was written: nothing held is on it.
  push(AGENT, newestOf(["m-90", "m-91"], "90"));
  assert.deepEqual(
    seen.current?.messages.map((message) => message.id),
    ["m-90", "m-91"],
  );
  assert.equal(seen.current?.olderFailed, false);
});
