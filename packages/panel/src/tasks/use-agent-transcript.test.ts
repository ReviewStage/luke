// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_CALL_FAILURE,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  type AgentTranscriptPage,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentStatus,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { OWN_TRANSCRIPT } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  installPanelSpanRecorder,
  jsonBytes,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
  type PanelSpan,
} from "../panel-spans.js";
import { fakeActPort, fakeActPortCalls, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads } from "../testing/app-state.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import {
  type TranscriptsTelling,
  tellingTranscripts,
  transcriptTold,
} from "../testing/tasks-control.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import {
  type AgentTranscriptControl,
  type TranscriptOlderReader,
  useAgentTranscript,
} from "./use-agent-transcript.js";

const AGENT: AgentTranscriptKey = {
  kind: TRANSCRIPT_KIND.AGENT,
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
};
const OTHER: AgentTranscriptKey = { ...AGENT, callId: "call-7" };

let root: Root | undefined;

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function pageOf(id: string, text: string): AgentTranscriptPage {
  return {
    messages: [{ id, role: "assistant", parts: [{ type: "text", text }] }],
    cursor: "1:0",
    status: AGENT_STATUS.RUNNING,
    title: null,
    caughtUp: false,
  };
}

function said(ids: readonly string[]): AgentTranscriptMessage[] {
  return ids.map((id) => ({ id, role: "assistant", parts: [{ type: "text", text: id }] }));
}

function newestOf(ids: readonly string[], before?: string): AgentTranscriptPage {
  return {
    messages: said(ids),
    cursor: "9:0",
    status: AGENT_STATUS.RUNNING,
    title: null,
    newest: true,
    caughtUp: false,
    ...(before === undefined ? undefined : { before }),
  };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  await settleQueries();
}

function drawn(older?: TranscriptOlderReader) {
  const telling = tellingTranscripts();
  const frames: AgentTranscriptControl[] = [];
  function Probe(props: { shown: boolean }) {
    frames.push(useAgentTranscript({ transcript: AGENT, shown: props.shown, older }));
    return null;
  }
  function Window(props: { shown: boolean }) {
    return useAppSlice(APP_SLICE.RUN) === undefined ? null : createElement(Probe, props);
  }
  const registry = AtomRegistry.make();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  return {
    telling,
    frames,
    seen: () => frames.at(-1),
    draw: (shown: boolean) =>
      act(async () => {
        root?.render(onRegistry(registry, createElement(Window, { shown })));
        await settle();
      }),
    push: (transcript: AgentTranscriptKey, page: AgentTranscriptPage) =>
      act(async () => {
        telling.tell(transcript, page);
        await settle();
      }),
  };
}

function ids(control: AgentTranscriptControl | undefined): readonly string[] | undefined {
  return control?.messages.map((message) => message.id);
}

function heldOnFirstDocument(...pages: readonly AgentTranscriptPage[]): void {
  handHostReads({
    transcripts: { [AGENT.agentId]: { [OWN_TRANSCRIPT]: transcriptTold(pages) } },
  });
}

test("a shown tab holds its transcript and draws what the host lays for it alone, and lets the hold go once hidden, drawing what stands", async () => {
  const { telling, seen, draw, push } = drawn();

  await draw(true);
  await push(AGENT, pageOf("m-1", "Reading the invites."));
  await push(OTHER, pageOf("m-9", "A worker's words."));
  await push(AGENT, pageOf("m-1", "Reading the invites again."));
  await push(AGENT, pageOf("m-2", "Writing the expiry."));
  assert.deepEqual(ids(seen()), ["m-1", "m-2"]);
  assert.equal(seen()?.pages, 3);

  await draw(false);
  assert.deepEqual(telling.asked, [AGENT]);
  assert.deepEqual(telling.closed, [AGENT]);
  assert.deepEqual(ids(seen()), ["m-1", "m-2"], "a tab kept behind another stands as it was");
});

test("a tab shown on a transcript the host holds draws its messages in its first frame, never as reading", async () => {
  heldOnFirstDocument(newestOf(["m-1", "m-2"]));
  const { frames, draw } = drawn();

  await draw(true);
  assert.deepEqual(ids(frames[0]), ["m-1", "m-2"]);
  assert.equal(
    frames.some((frame) => frame.reading),
    false,
    "no frame stood reading",
  );
});

test("a transcript that could not be read offers Try again, which asks the host to read it again, the messages held standing", async () => {
  const { seen, draw, push } = drawn();
  const retried: AgentTranscriptKey[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.AGENTS_TRANSCRIPT_RETRY]: (transcript) => {
      retried.push(transcript);
      return Promise.resolve();
    },
  });

  await draw(true);
  await push(AGENT, pageOf("m-1", "Reading the invites."));
  await push(AGENT, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(seen()?.failed, true);
  assert.deepEqual(seen()?.failedWith, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(ids(seen()), ["m-1"]);

  await act(async () => {
    seen()?.onRetry();
    await settle();
  });
  await push(AGENT, pageOf("m-2", "Writing the expiry."));
  assert.deepEqual(retried, [AGENT]);
  assert.equal(seen()?.failed, false);
  assert.deepEqual(ids(seen()), ["m-1", "m-2"]);
});

function workerPage(status: AgentStatus): AgentTranscriptPage {
  return {
    messages: [],
    cursor: "1:1",
    status: AGENT_STATUS.RUNNING,
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

test("a page that says the agent's workers as they stood keeps what the tab holds of them, and one that says a worker stands otherwise is drawn", async () => {
  const { seen, draw, push } = drawn();

  await draw(true);
  await push(AGENT, workerPage(AGENT_STATUS.RUNNING));
  const first = seen();
  await push(AGENT, workerPage(AGENT_STATUS.RUNNING));
  assert.equal(seen()?.pages, (first?.pages ?? 0) + 1);
  assert.equal(seen()?.subagents, first?.subagents, "the workers read alike are the very map");

  await push(AGENT, workerPage(AGENT_STATUS.COMPLETED));
  assert.equal(seen()?.subagents.get("call-1")?.status, AGENT_STATUS.COMPLETED);
});

test("an agent that ended stays held while its tab is shown, so the lines a call into it writes still reach the tab", async () => {
  const { telling, seen, draw, push } = drawn();
  const ended = (id: string, text: string): AgentTranscriptPage => ({
    ...pageOf(id, text),
    status: AGENT_STATUS.COMPLETED,
  });

  await draw(true);
  await push(AGENT, ended("m-1", "Invites now expire after seven days."));
  await push(AGENT, ended("said-1", "Walk me through the expiry job."));
  await push(AGENT, ended("said-2", "It reads pending invites oldest first."));

  assert.deepEqual(ids(seen()), ["m-1", "said-1", "said-2"]);
  assert.equal(seen()?.pageStatus, AGENT_STATUS.COMPLETED);
  assert.deepEqual(telling.closed, [], "the ended agent's hold is never let go while shown");
});

test("a hold is timed to its first page drawn and to the page that caught it up, by what the transcript held", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const { draw, push } = drawn();

  await draw(true);
  vi.setSystemTime(1_000_400);
  const first = newestOf(["m-1"], "1");
  await push(AGENT, first);
  vi.setSystemTime(1_000_900);
  const caughtUp: AgentTranscriptPage = { ...pageOf("m-1", "x"), messages: [], caughtUp: true };
  await push(AGENT, caughtUp);
  await push(AGENT, pageOf("m-2", "Writing the expiry."));
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
          [PANEL_SPAN_ATTRIBUTE.HELD_BYTES]: jsonBytes(transcriptTold([first]).rows),
          [PANEL_SPAN_ATTRIBUTE.CACHE_HIT]: 0,
        },
      },
      {
        name: PANEL_SPAN.TRANSCRIPT_CAUGHT_UP,
        waited: 900,
        attributes: {
          [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: 1,
          [PANEL_SPAN_ATTRIBUTE.HELD_BYTES]: jsonBytes(transcriptTold([first, caughtUp]).rows),
          [PANEL_SPAN_ATTRIBUTE.CACHE_HIT]: 0,
        },
      },
    ],
  );
});

test("a hold whose transcript the host already held is timed as a cache hit, caught up only by a page read since", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const held: AgentTranscriptPage = { ...newestOf(["m-1", "m-2"], "1"), caughtUp: true };
  heldOnFirstDocument(held);
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const { draw, push } = drawn();

  await draw(true);
  const painted = spans.map((span) => [
    span.name,
    span.attributes()[PANEL_SPAN_ATTRIBUTE.CACHE_HIT],
  ]);
  await push(AGENT, held);
  await push(AGENT, { ...pageOf("m-3", "Writing."), caughtUp: true });
  uninstall();

  assert.deepEqual(painted, [[PANEL_SPAN.TRANSCRIPT_FIRST_PAINT, 1]]);
  assert.deepEqual(
    spans.map((span) => [span.name, span.attributes()[PANEL_SPAN_ATTRIBUTE.CACHE_HIT]]),
    [
      [PANEL_SPAN.TRANSCRIPT_FIRST_PAINT, 1],
      [PANEL_SPAN.TRANSCRIPT_CAUGHT_UP, 1],
    ],
  );
});

test("a transcript the account no longer reaches draws nothing the host held of it", async () => {
  const { seen, draw, push } = drawn();

  await draw(true);
  await push(AGENT, newestOf(["m-1", "m-2"], "1"));
  await push(AGENT, { failure: AGENT_CALL_FAILURE.NOT_FOUND });

  assert.deepEqual(seen()?.messages, []);
  assert.equal(seen()?.hasOlder, false);
  assert.equal(seen()?.failed, true);
});

test("a hold let go before its first page landed is timed by no span", async () => {
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const { draw, push } = drawn();

  await draw(true);
  await draw(false);
  await push(AGENT, pageOf("m-1", "Not held."));
  uninstall();

  assert.deepEqual(spans, []);
});

function scriptedOlder() {
  const asked: AgentTranscriptOlderParams[] = [];
  let answer: (older: AgentTranscriptOlderAnswer) => void = () => undefined;
  const older: TranscriptOlderReader = (params) => {
    asked.push(params);
    return new Promise((resolve) => {
      answer = resolve;
    });
  };
  const hand = (older: AgentTranscriptOlderAnswer) =>
    act(async () => {
      answer(older);
      await settle();
    });
  return { older, asked, hand };
}

test("older pages are asked for one at a time, each out until the host lays it before what is held", async () => {
  const { older, asked, hand } = scriptedOlder();
  const { telling, seen, draw, push } = drawn(older);
  const laid = (older: Parameters<TranscriptsTelling["layOlder"]>[1]) =>
    act(async () => {
      telling.layOlder(AGENT, older);
      await settle();
    });

  await draw(true);
  await push(AGENT, newestOf(["m-3", "m-4"], "3"));
  assert.equal(seen()?.hasOlder, true);
  act(() => seen()?.loadOlder());
  act(() => seen()?.loadOlder());
  await act(settle);
  assert.deepEqual(asked, [{ ...AGENT, before: "3" }]);
  assert.equal(seen()?.loadingOlder, true);

  await hand({ landed: true });
  assert.equal(seen()?.loadingOlder, true);
  act(() => seen()?.loadOlder());
  assert.equal(asked.length, 1);
  await laid({ messages: said(["m-1", "m-2"]), before: "1" });
  assert.deepEqual(ids(seen()), ["m-1", "m-2", "m-3", "m-4"]);
  assert.equal(seen()?.loadingOlder, false);

  act(() => seen()?.loadOlder());
  await act(settle);
  assert.deepEqual(asked.at(-1), { ...AGENT, before: "1" });
  await hand({ landed: false });
  assert.equal(seen()?.loadingOlder, false, "a page the host did not lay is out no longer");
  assert.equal(seen()?.olderFailed, false);
});

test("an older read that failed leaves what is held and may be asked again, its failure the cursor's alone", async () => {
  const { older, asked, hand } = scriptedOlder();
  const { seen, draw, push } = drawn(older);

  await draw(true);
  await push(AGENT, newestOf(["m-3"], "3"));
  act(() => seen()?.loadOlder());
  await act(settle);
  await hand({ failure: AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(seen()?.olderFailed, true);
  assert.deepEqual(ids(seen()), ["m-3"]);
  assert.equal(seen()?.hasOlder, true);
  act(() => seen()?.loadOlder());
  await act(settle);
  assert.equal(asked.length, 2);
  await hand({ failure: AGENT_CALL_FAILURE.UNANSWERED });

  await push(AGENT, newestOf(["m-90"], "90"));
  assert.equal(seen()?.olderFailed, false);
});
