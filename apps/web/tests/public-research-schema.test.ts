import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";
import { DRAW_ON_BOARD_TOOL } from "../server/hosted/board-tool";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";

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

test("queue_question offers exactly a bounded question and recommendation, with nothing else to carry", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "queue-question-tool-input",
    jsonSchemaOf(QUEUE_QUESTION_TOOL.inputSchema),
  );
});

test("draw_on_board offers exactly operations on the board, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "draw-on-board-tool-input",
    jsonSchemaOf(DRAW_ON_BOARD_TOOL.inputSchema),
  );
});
