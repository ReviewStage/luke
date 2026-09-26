import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../server/hosted/public-research";

/**
 * The input schemas the planning model is offered its public research
 * under, as the JSON Schema they emit. What the model is told it may send is
 * the contract a call is read against, so their bytes are recorded the way
 * the wire's are, and move only under `LUKE_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("search_web offers exactly a bounded query, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "search-web-tool-input",
    jsonSchemaOf(SEARCH_WEB_TOOL.inputSchema),
  );
});

test("read_web_page offers exactly a bounded URL, with no header or credential to send", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "read-web-page-tool-input",
    jsonSchemaOf(READ_WEB_PAGE_TOOL.inputSchema),
  );
});
