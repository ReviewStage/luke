import assert from "node:assert/strict";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import type { GatewayOperator } from "@sidecar/host";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { brainActRows } from "./brain";

const NOW = 1_800_000_000_000;

const CANCELLED: BrainRequestSnapshot = {
  runId: "run-1",
  submissionId: "sub-1",
  origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  question: "what needs me?",
  status: BRAIN_REQUEST_STATUS.CANCELLED,
  revision: 2,
  acceptedAt: NOW,
  settledAt: NOW + 1,
  performedActions: 0,
  unknownActions: 0,
};

test("a cancel crosses to the operator under the run it names, and the brain rows offer no submit", async () => {
  const cancelled: string[] = [];
  // SAFETY: the rows reach only `cancel` on the operator; the fixture stands in for the rest.
  const operator = {
    cancel: async (runId: string) => {
      cancelled.push(runId);
      return CANCELLED;
    },
  } as unknown as GatewayOperator;
  const rows = brainActRows({ operator });
  assert.deepEqual(Object.keys(rows), [ACT_KIND.BRAIN_CANCEL_ASK]);
  // SAFETY: only the brain rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  // SAFETY: the rows read nothing off the sender; one inert object is a window.
  const sender: ActSender = {
    sender: {} as WebContents,
    panel: true,
    voice: false,
    introduction: false,
  };
  const answer = await Effect.runPromise(
    router.performAct({ kind: ACT_KIND.BRAIN_CANCEL_ASK, payload: { runId: "run-1" } }, sender),
  );
  assert.deepEqual(answer, { status: "done", value: CANCELLED });
  assert.deepEqual(cancelled, ["run-1"]);
});
