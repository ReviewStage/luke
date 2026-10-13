// @vitest-environment jsdom

import assert from "node:assert/strict";
import { EVE_TOOL } from "@sidecar/hosted/agent-tools";
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
