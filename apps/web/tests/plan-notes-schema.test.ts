import { planNotesSchema } from "@luke/features/plan-template";
import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@luke/wire/testing";
import { test } from "vitest";

/**
 * The output schema a task call's notetaker answers under, as the JSON
 * Schema its model is shown: a list of notes, each adding a point under a
 * heading, correcting a phrase, or striking a line. What the model is told it may answer is the contract its notes are
 * read against, so its bytes are recorded the way the wire's are, and move
 * only under `LUKE_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("the notetaker answers only notes under the plan's headings, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(ROOT, "plan-notes-output", jsonSchemaOf(planNotesSchema));
});
