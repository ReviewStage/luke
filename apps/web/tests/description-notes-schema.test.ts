import { descriptionNotesSchema } from "@repo/features/description-notes";
import { jsonSchemaGoldenRoot, settleJsonSchemaGolden } from "@repo/wire/testing";
import { test } from "vitest";

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("the notetaker answers only notes under the description's headings, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(ROOT, "description-notes-output", descriptionNotesSchema);
});
