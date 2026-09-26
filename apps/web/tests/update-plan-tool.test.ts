import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool";

/**
 * The input schema the planning model is offered `update_plan` under, as the
 * JSON Schema it emits. What the model is told it may send is the contract a
 * call is read against, so its bytes are recorded the way the wire's are, and
 * move only under `LUKE_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("update_plan offers exactly the document, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "update-plan-tool-input",
    jsonSchemaOf(UPDATE_PLAN_TOOL.inputSchema),
  );
});
