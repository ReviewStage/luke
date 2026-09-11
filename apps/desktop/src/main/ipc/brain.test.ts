import assert from "node:assert/strict";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  type BrainRequestOrigin,
} from "@sidecar/brain/requests";
import type { BrainAskSubmission } from "@sidecar/brain/requests-wire";
import { type GatewayOperator, REJECTED_SUBMISSION } from "@sidecar/host";
import type { SessionKey } from "@sidecar/runtime/vocabulary";
import type { WebContents } from "electron";
import { test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { brainActRows } from "./brain";

const NOW = 1_800_000_000_000;

/**
 * The origin gate as the act router actually wires it: which window may
 * submit an ask under which origin, checked before the operator client is
 * reached at all.
 */
function registered() {
  // SAFETY: the rows read senders by identity alone; two distinct inert objects are two windows.
  const voiceSender = {} as WebContents;
  // SAFETY: a second inert object, so the rows read two distinct windows.
  const panelSender = {} as WebContents;
  const submitted: { submission: BrainAskSubmission; sessionKey: SessionKey }[] = [];
  // SAFETY: the origin gate reaches only `submit` on the operator; the fixture stands in for the rest.
  const operator = {
    submit: async (submission: BrainAskSubmission, sessionKey: SessionKey) => {
      submitted.push({ submission, sessionKey });
      return { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: "run-1", acceptedAt: NOW };
    },
  } as unknown as GatewayOperator;
  // SAFETY: only the brain rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(brainActRows({ operator }) as ActRows);
  const senderOf = (sender: WebContents): ActSender => ({
    sender,
    panel: sender === panelSender,
    voice: sender === voiceSender,
    introduction: false,
  });
  const submit = (sender: WebContents, origin: BrainRequestOrigin) =>
    router.performAct(
      {
        kind: ACT_KIND.BRAIN_SUBMIT_ASK,
        payload: { submission: { submissionId: "sub-1", question: "what needs me?", origin } },
      },
      senderOf(sender),
    );
  return { submit, submitted, voiceSender, panelSender };
}

test("a typed ask is the panel's alone, and every other origin is refused whichever window claims it", async () => {
  const f = registered();
  assert.deepEqual(await f.submit(f.panelSender, BRAIN_REQUEST_ORIGIN.TYPED), {
    status: "done",
    value: { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: "run-1", acceptedAt: NOW },
  });
  assert.equal(f.submitted.length, 1);
  assert.equal(f.submitted[0]?.submission.origin, BRAIN_REQUEST_ORIGIN.TYPED);
  // The voice window composes no ask of its own any more: the host does, from the transcript.
  assert.deepEqual(await f.submit(f.voiceSender, BRAIN_REQUEST_ORIGIN.SPOKEN), {
    status: "done",
    value: REJECTED_SUBMISSION,
  });
  assert.deepEqual(await f.submit(f.voiceSender, BRAIN_REQUEST_ORIGIN.TYPED), {
    status: "done",
    value: REJECTED_SUBMISSION,
  });
  assert.deepEqual(await f.submit(f.panelSender, BRAIN_REQUEST_ORIGIN.SPOKEN), {
    status: "done",
    value: REJECTED_SUBMISSION,
  });
  assert.equal(f.submitted.length, 1);
});
