import assert from "node:assert/strict";
import {
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
} from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import {
  DEVELOPER_FIELDS_MARKER,
  PLANNING_INSTRUCTIONS,
  SCRIBE_INSTRUCTIONS,
  WORKER_INSTRUCTIONS,
} from "../server/hosted/brain-host/planning";
import { RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";

/**
 * planning-instructions.test.ts -- every section of the template reaches both models in the words the template states it in.
 *
 * The planning model is told each section by the heading the developer
 * reads, what it holds, and when it is done; the notetaker is told each by
 * the heading it writes notes under and what it holds, and never the bar. A
 * section left out of either prompt is one that model would never ask about
 * or never write to. Both are told the marker the sections the developer
 * wrote ride behind in their context, so neither rewrites the developer's
 * words. Both models that read the repository are asked to say
 * what each command is for, in the field the shell takes for it.
 */

test("the planning model is told every section by its heading, what it holds, and when it is done", () => {
  for (const field of Object.values(PLAN_FIELD)) {
    const line = `- ${PLAN_FIELD_HEADING[field]}: ${PLAN_FIELD_PURPOSE[field]}\n  Done when: ${PLAN_FIELD_BAR[field]}`;
    assert.ok(PLANNING_INSTRUCTIONS.includes(line), `the planning prompt names ${field}`);
  }
});

test("the notetaker is told every default section by the heading it writes under and what it holds, and no bar", () => {
  for (const field of Object.values(PLAN_FIELD)) {
    const line = `- ${PLAN_FIELD_HEADING[field]}: ${PLAN_FIELD_PURPOSE[field]}`;
    assert.ok(SCRIBE_INSTRUCTIONS.includes(line), `the notetaker's prompt names ${field}`);
    assert.ok(!SCRIBE_INSTRUCTIONS.includes(PLAN_FIELD_BAR[field]), `no bar for ${field}`);
  }
});

test("the planning model and the notetaker are each told the marker the developer's own sections ride behind", () => {
  for (const instructions of [PLANNING_INSTRUCTIONS, SCRIBE_INSTRUCTIONS]) {
    assert.ok(instructions.includes(`A section named under ${DEVELOPER_FIELDS_MARKER}`));
  }
});

test("the planning model and its worker are asked to say what each command is for, in the field the shell takes beside it", () => {
  const field = "description";
  assert.ok(field in RUN_IN_REPOSITORY_TOOL.inputSchema.fields);
  for (const instructions of [PLANNING_INSTRUCTIONS, WORKER_INSTRUCTIONS]) {
    assert.ok(instructions.includes(`\`${field}\``));
  }
});
