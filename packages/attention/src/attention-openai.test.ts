import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  ATTENTION_TRIGGER,
  type AttentionPromptUpdate,
  attentionPromptUpdateFromWire,
  attentionResponsesMissingReason,
  attentionResponsesOutputText,
  attentionResponsesRequest,
  attentionUpdateInput,
} from "@sidecar/attention";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  SESSION_STATUS,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { isRecord } from "@sidecar/wire";

const UPDATE: AttentionPromptUpdate = {
  trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
  providerName: "Claude Code",
  title: "checkout-service",
  status: SESSION_STATUS.WAITING,
  previousStatus: SESSION_STATUS.WORKING,
  recap: "Waiting on a permission decision.",
  context: { branch: "main" },
};

test("the responses request is the shared construction with only the update varying", () => {
  const request = attentionResponsesRequest(UPDATE, { model: "gpt-test", maximumOutputTokens: 64 });

  assert.equal(request.model, "gpt-test");
  assert.match(request.input, /Work: checkout-service/);
  assert.doesNotMatch(request.input, /Provider title:|Workspace:/);
  assert.equal(request.input, attentionUpdateInput(UPDATE));
  assert.equal(request.max_output_tokens, 64);
  assert.equal(request.store, false);
  assert.deepEqual(request.text.format, {
    type: "json_schema",
    name: ATTENTION_DECISION_SCHEMA_NAME,
    schema: ATTENTION_DECISION_SCHEMA,
    strict: true,
  });
});

test("output text is read from either place a Responses payload carries it", () => {
  assert.equal(attentionResponsesOutputText({ output_text: ' {"a":1} ' }), '{"a":1}');
  assert.equal(
    attentionResponsesOutputText({
      output: [{ content: [{ type: "output_text", text: '{"b":2}' }] }],
    }),
    '{"b":2}',
  );
  assert.equal(attentionResponsesOutputText({ output: [{ content: [] }] }), undefined);
  assert.equal(attentionResponsesOutputText("not a record"), undefined);
});

test("a missing decision explains itself from the payload's own status", () => {
  assert.equal(
    attentionResponsesMissingReason({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    }),
    " (incomplete: max_output_tokens)",
  );
  assert.equal(attentionResponsesMissingReason({ status: "failed" }), " (failed)");
  assert.equal(attentionResponsesMissingReason({}), "");
});

test("a wire update round-trips with every bounded field intact", () => {
  const parsed = attentionPromptUpdateFromWire(JSON.parse(JSON.stringify(UPDATE)));
  assert.deepEqual(parsed, UPDATE);
});

test("a wire update needs only its required fields", () => {
  const parsed = attentionPromptUpdateFromWire({
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: "Codex",
    title: "billing",
    status: SESSION_STATUS.COMPLETE,
  });
  assert.deepEqual(parsed, {
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: "Codex",
    title: "billing",
    status: SESSION_STATUS.COMPLETE,
  });
});

test("a wire update outside the build's value sets is refused, not repaired", () => {
  const parsed = JSON.parse(JSON.stringify(UPDATE));
  if (!isRecord(parsed)) throw new Error("fixture wire record expected");
  const validWire: WireRecord = parsed;

  assert.equal(attentionPromptUpdateFromWire({ ...validWire, trigger: "made-up" }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, status: "sleeping" }), undefined);
  assert.equal(
    attentionPromptUpdateFromWire({ ...validWire, previousStatus: "sleeping" }),
    undefined,
  );
  const noTitle = { ...validWire };
  delete noTitle.title;
  assert.equal(attentionPromptUpdateFromWire(noTitle), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, title: "   " }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, recap: 7 }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, context: "not a record" }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, context: { error: 9 } }), undefined);
  assert.equal(attentionPromptUpdateFromWire("not a record"), undefined);
});

test("wire fields are cut to the bounds the local roster holds them to", () => {
  const parsed = attentionPromptUpdateFromWire({
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: "p".repeat(maximumSessionTitleLength + 40),
    title: `  ${"t".repeat(maximumSessionTitleLength + 40)}  `,
    status: SESSION_STATUS.WORKING,
    recap: "r".repeat(maximumSessionRecapLength + 40),
  });
  assert.equal(parsed?.providerName.length, maximumSessionTitleLength);
  assert.equal(parsed?.title.length, maximumSessionTitleLength);
  assert.equal(parsed?.recap?.length, maximumSessionRecapLength);
});
