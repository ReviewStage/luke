import { planNotesSchema } from "@sidecar/hosted/plan-template";
import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";

/**
 * The output schema a planning call's notetaker answers under, as the JSON
 * Schema its model is shown: a list of notes, each adding a point under a
 * field, an example to a rule by its number, correcting a phrase, or striking
 * a line. What the model is told it may answer is the contract its notes are
 * read against, so its bytes are recorded the way the wire's are, and move
 * only under `LUKE_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("the notetaker answers only notes on the template's fields, with no account, plan, or freeform body to name", async () => {
  await settleJsonSchemaGolden(ROOT, "plan-notes-output", jsonSchemaOf(planNotesSchema));
});
