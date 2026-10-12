import assert from "node:assert/strict";
import {
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
  PLAN_HEADING,
  ROLLOUT_NOTE_FIELD,
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
 * what each command is for, in the field the shell takes for it. The
 * planning model is told to cut the rollout itself once the sections it
 * stands on hold, naming them by their headings.
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

test("the notetaker is told the rollout stands beside the text, its notes, and to write a cut as them", () => {
  for (const words of [
    "The rollout stands beside the text, never in it",
    `field "${ROLLOUT_NOTE_FIELD}"`,
    "add takes item, the pull request added after the last",
    "a phrase copied exactly from one pull request's title",
    "write the cut as rollout notes, one per pull request in order, never as prose or a bullet under any heading",
  ]) {
    assert.ok(SCRIBE_INSTRUCTIONS.includes(words), `the notetaker's prompt says ${words}`);
  }
});

test("the planning model proposes the rollout once interfaces, hard parts, and testing hold, by heading", () => {
  for (const words of [
    `Once the ${PLAN_HEADING.INTERFACES}, ${PLAN_HEADING.HARD_PARTS}, and ${PLAN_HEADING.TESTING} sections of the saved document are good enough to build from, propose the rollout yourself`,
    `Group what ${PLAN_HEADING.INTERFACES} names by layer, in the dependency order the repository has it`,
    "Read the code with run_in_repository to confirm the order holds before you propose it.",
    `Hold each pull request to the ${PLAN_HEADING.ROLLOUT} bar above.`,
    "Fold one too small to be worth a review into the one beside it, and split one that carries two concerns.",
    "Two that both need the first and not each other both base on the first, never one on the other.",
    "one line per pull request: its title, its base, and why it lands green alone.",
    "When the work is one pull request, queue one question asking whether it splits",
    "never restate it as prose",
  ]) {
    assert.ok(PLANNING_INSTRUCTIONS.includes(words), `the planning prompt says ${words}`);
  }
});
