// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_TOOL, EVE_TOOL } from "@sidecar/hosted/agent-tools";
import { PLAN_WORK_STATE } from "@sidecar/hosted/planning-view";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { toolCall, words, worker, workerCall, workTurn } from "#testing/plan-work";
import { PlanCall } from "./plan-call";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";

/** The Call tab as a test draws it: what it is given over a plan with no planning turn, which reads no older page and opens nothing. */
function callTab(
  props: Partial<Parameters<typeof PlanCall>[0]> & Pick<Parameters<typeof PlanCall>[0], "region">,
) {
  return createElement(PlanCall, {
    onRetry: () => undefined,
    turns: [],
    callLive: false,
    earlier: undefined,
    onLoadEarlier: () => Promise.resolve(),
    onOpenSubagent: () => undefined,
    shown: true,
    ...props,
  });
}

/** Synthetic words throughout. */
function said(count: number): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: true,
        lukeEnded: false,
        messages: Array.from({ length: count }, (_, index) => ({
          id: String(index),
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: `Line ${index}` }],
        })),
      },
    ],
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The tab drawn into the page, for a test to read as a reader would. */
function mounted(element: ReturnType<typeof callTab>): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a stop names the subagent it stopped by that subagent's job, a start in an earlier turn included, and a stop of a task no turn here started names the task, though a call sent it more work", () => {
  const styling = worker("w", "Read the styling setup.\n\nStart with the theme.", {
    taskId: "worker-1",
  });
  const steering = worker("r", "Also read the build.", { taskId: "worker-0" });
  const started = workTurn(
    PLAN_WORK_STATE.DONE,
    [
      workerCall(styling),
      toolCall(
        EVE_TOOL.WORKER,
        "r",
        { message: steering.task, taskId: "worker-0" },
        { output: "Sent." },
      ),
      words("A worker is reading it."),
    ],
    { workers: [styling, steering] },
  );
  const stop = (id: string, taskId: string) =>
    toolCall(EVE_TOOL.TASK_CANCEL, id, { taskId }, { output: `Stopped ${taskId}.` });
  const stopping = workTurn(
    PLAN_WORK_STATE.RUNNING,
    [stop("c1", "worker-1"), stop("c2", "worker-0")],
    {
      turnId: "turn-2",
      startedAt: 5_000,
    },
  );

  const container = mounted(
    callTab({ region: said(0), turns: [started, stopping], callLive: true }),
  );
  const row = (id: string) => container.querySelector(`[data-call-id="${id}"]`)?.textContent;
  assert.match(row("c1") ?? "", /Stopped subagent\s*Read the styling setup\./u);
  assert.match(row("c2") ?? "", /Stopped subagent\s*worker-0/u);
});

test("a finished spoken turn is one folded line under the line that asked for it, its words and how long it worked inside the fold and nothing of them outside, and the call's end line after it", () => {
  const region: TranscriptRegion = {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: false,
        lukeEnded: true,
        record: { endedAt: 90_000 },
        messages: [
          {
            id: "ask",
            role: TRANSCRIPT_SPEAKER.USER,
            metadata: { rowIds: ["row-ask"] },
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Let's end the call now." }],
          },
          {
            id: "bye",
            role: TRANSCRIPT_SPEAKER.ASSISTANT,
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Alright, take care." }],
          },
        ],
      },
    ],
  };
  const ended = workTurn(
    PLAN_WORK_STATE.DONE,
    [
      toolCall(AGENT_TOOL.END_CALL, "c1", {}, { output: { status: "accepted" } }),
      words("Ending the call as asked."),
    ],
    { startedAt: 60_000, endedAt: 67_000, asked: ["row-ask"] },
  );

  const container = mounted(callTab({ region, turns: [ended], callLive: false }));
  const fold = container.querySelector("[data-turn-fold]");
  assert.ok(fold);
  assert.equal(fold.textContent, "1 tool call");
  // Outside the fold stand only the lines said: the ask before the work, the goodbye and the call's end after it.
  const outside = (container.textContent ?? "").replace(fold.textContent ?? "", "");
  assert.doesNotMatch(outside, /Ending the call as asked|Worked for|Failed|Stopped/u);
  assert.match(outside, /Let's end the call now\.[\s\S]*Alright, take care\./u);
  // Opened, the fold holds the call, the words, and how long the turn worked.
  const summary = fold.querySelector("summary");
  assert.ok(summary);
  act(() => summary.click());
  assert.match(fold.textContent ?? "", /Ended the call[\s\S]*Ending the call as asked\./u);
  assert.ok(fold.querySelector("[data-worked]"), "how long the turn worked stands inside its fold");
  const order = [...container.querySelectorAll("[data-turn-fold], p")].map(
    (each) => each.textContent ?? "",
  );
  const at = (start: string) => order.findIndex((text) => text.startsWith(start));
  assert.ok(
    at("Let's end the call") < at("1 tool call") && at("1 tool call") < at("Alright, take care"),
    `the fold stands under its ask and before Luke's goodbye: ${order.join(" | ")}`,
  );
});
