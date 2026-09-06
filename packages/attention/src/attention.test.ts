import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumSessionDetailLength,
  maximumSessionTitleLength,
  SESSION_STATUS,
} from "@sidecar/session";
import { isRecord, type WireRecord } from "@sidecar/wire";
import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  ATTENTION_DISPOSITION,
  ATTENTION_TRIGGER,
  type AttentionPromptUpdate,
  attentionDecisionFromModel,
  attentionInstructions,
  attentionPromptUpdateFromWire,
  attentionResponsesOutputText,
  attentionResponsesRequest,
  attentionUpdateInput,
  DISPOSITION_GUIDANCE,
  legacyAttentionDecisionFromModel,
  legacyAttentionResponsesRequest,
} from "./index.js";
import { releasedV1ReviewAnswer, releasedV2ReviewAnswer } from "./released-clients.test-fixture.js";

const DECIDED_AT = 1_800_000_000_000;
const SPOKEN_SENTENCE = "Claude Code needs permission to continue.";

const UPDATE: AttentionPromptUpdate = {
  trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
  providerName: "Claude Code",
  title: "checkout-service",
  status: SESSION_STATUS.WAITING,
  previousStatus: SESSION_STATUS.WORKING,
  context: { branch: "main" },
};

test("the decision schema carries the disposition contract", () => {
  const schemaDescription = ATTENTION_DECISION_SCHEMA.properties.disposition.description;
  for (const disposition of Object.values(ATTENTION_DISPOSITION)) {
    assert.ok(schemaDescription.includes(`${disposition}: ${DISPOSITION_GUIDANCE[disposition]}`));
  }
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.properties.disposition.enum, [
    "silent",
    "speak-during-turn",
    "speak-at-turn-end",
  ]);
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.required, ["disposition"]);
  assert.equal(ATTENTION_DECISION_SCHEMA.additionalProperties, false);
});

test("model output is validated against the judgment-only contract, never repaired", () => {
  assert.equal(attentionDecisionFromModel(undefined, DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel("silent", DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel([], DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel({ disposition: "speak" }, DECIDED_AT), undefined);
  assert.deepEqual(
    attentionDecisionFromModel({ disposition: ATTENTION_DISPOSITION.SILENT }, DECIDED_AT),
    { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT },
  );
  assert.deepEqual(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: SPOKEN_SENTENCE },
      DECIDED_AT,
    ),
    { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, decidedAt: DECIDED_AT },
  );
});

test("the legacy decision keeps the summary and refuses a spoken decision without one", () => {
  assert.deepEqual(
    legacyAttentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, summary: ` ${SPOKEN_SENTENCE} ` },
      DECIDED_AT,
    ),
    {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      decidedAt: DECIDED_AT,
      summary: SPOKEN_SENTENCE,
    },
  );
  assert.deepEqual(
    legacyAttentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SILENT, summary: null },
      DECIDED_AT,
    ),
    { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT },
  );
  assert.equal(
    legacyAttentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: null },
      DECIDED_AT,
    ),
    undefined,
  );
  assert.equal(
    legacyAttentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: "  " },
      DECIDED_AT,
    ),
    undefined,
  );
  assert.equal(legacyAttentionDecisionFromModel({ disposition: "speak" }, DECIDED_AT), undefined);
  assert.equal(
    legacyAttentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: "s".repeat(400) },
      DECIDED_AT,
    )?.summary?.length,
    180,
  );
});

test("the versioned request is the build's construction with only the update varying", () => {
  const request = attentionResponsesRequest(UPDATE, { model: "gpt-test", maximumOutputTokens: 64 });

  assert.equal(request.model, "gpt-test");
  assert.equal(request.instructions, attentionInstructions());
  assert.match(request.instructions, /Return only the disposition\./);
  assert.equal(request.input, attentionUpdateInput(UPDATE));
  assert.match(request.input, /Work: checkout-service/);
  assert.match(request.input, /Previous status: working/);
  assert.doesNotMatch(request.input, /Provider title:|Workspace:/);
  assert.equal(request.max_output_tokens, 64);
  assert.equal(request.store, false);
  assert.ok(!("tools" in request));
  assert.deepEqual(request.text.format, {
    type: "json_schema",
    name: ATTENTION_DECISION_SCHEMA_NAME,
    schema: ATTENTION_DECISION_SCHEMA,
    strict: true,
  });
});

test("the legacy request asks for the summary sentence in Luke's released voice", () => {
  const request = legacyAttentionResponsesRequest(UPDATE, {
    model: "gpt-test",
    maximumOutputTokens: 64,
  });

  assert.equal(request.input, attentionUpdateInput(UPDATE));
  assert.equal(request.store, false);
  assert.equal(request.text.format.name, ATTENTION_DECISION_SCHEMA_NAME);
  assert.deepEqual(request.text.format.schema.required, ["disposition", "summary"]);
  assert.deepEqual(JSON.parse(JSON.stringify(request.text.format.schema)).properties.summary.type, [
    "string",
    "null",
  ]);
  assert.match(request.instructions, /How to word it:/);
  assert.match(request.instructions, /write the sentence Luke says/);
  assert.doesNotMatch(request.instructions, /Return only the disposition/);
  const [sharedLead] = attentionInstructions().split("What you return:");
  assert.ok(sharedLead && request.instructions.startsWith(sharedLead));
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

test("a wire update round-trips with every bounded field intact", () => {
  assert.deepEqual(attentionPromptUpdateFromWire(JSON.parse(JSON.stringify(UPDATE))), UPDATE);
});

test("a wire update needs only its required fields", () => {
  const minimal = {
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: "Codex",
    title: "billing",
    status: SESSION_STATUS.COMPLETE,
  };
  assert.deepEqual(attentionPromptUpdateFromWire(minimal), minimal);
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
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, workspace: 7 }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, context: "not a record" }), undefined);
  assert.equal(attentionPromptUpdateFromWire({ ...validWire, context: { error: 9 } }), undefined);
  assert.equal(attentionPromptUpdateFromWire("not a record"), undefined);
});

test("wire fields are cut to the bounds an update may carry them at", () => {
  const parsed = attentionPromptUpdateFromWire({
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: "p".repeat(maximumSessionTitleLength + 40),
    title: `  ${"t".repeat(maximumSessionTitleLength + 40)}  `,
    workspace: "w".repeat(maximumSessionTitleLength + 1),
    status: SESSION_STATUS.WORKING,
    context: { error: "e".repeat(maximumSessionDetailLength + 1), branch: "   " },
  });
  assert.equal(parsed?.providerName.length, maximumSessionTitleLength);
  assert.equal(parsed?.title.length, maximumSessionTitleLength);
  assert.equal(parsed?.workspace?.length, maximumSessionTitleLength);
  assert.equal(parsed?.context?.error?.length, maximumSessionDetailLength);
  assert.equal(parsed?.context?.branch, undefined);
});

test("released clients of both generations read the answers the handlers build", () => {
  const legacy = legacyAttentionDecisionFromModel(
    { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: SPOKEN_SENTENCE },
    DECIDED_AT,
  );
  const versioned = attentionDecisionFromModel(
    { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN },
    DECIDED_AT,
  );
  const quota = { used: 1, limit: 5_000, remaining: 4_999, resetsAt: DECIDED_AT + 1 };
  const legacyWire = JSON.parse(JSON.stringify({ decision: legacy, quota }));
  const versionedWire = JSON.parse(JSON.stringify({ decision: versioned, quota }));

  assert.deepEqual(releasedV1ReviewAnswer(legacyWire, 7), {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: 7,
    summary: SPOKEN_SENTENCE,
  });
  assert.deepEqual(releasedV2ReviewAnswer(versionedWire, 7), {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: 7,
  });
  // The judgment-only answer is exactly what a first-version client cannot
  // speak, which is why the header-less request keeps the summary contract.
  assert.equal(releasedV1ReviewAnswer(versionedWire, 7), undefined);
});
