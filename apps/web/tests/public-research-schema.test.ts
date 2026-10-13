import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";
import { DRAW_ON_BOARD_TOOL } from "../server/hosted/board-tool";
import { RUN_ON_MAC_TOOL } from "../server/hosted/mac-command";
import { SHOW_PAGE_TOOL } from "../server/hosted/page-tool";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";

/**
 * The input schemas the planning model is offered its public research and
 * its repository's shell under, as the JSON Schema they emit. What the model is told it may send is
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

test("show_page offers a title, the page inline or by its path, and the page it revises, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "show-page-tool-input",
    jsonSchemaOf(SHOW_PAGE_TOOL.inputSchema),
  );
});

test("run_in_repository offers exactly one command and the plain words it is for, with no directory or environment to set", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "run-in-repository-tool-input",
    jsonSchemaOf(RUN_IN_REPOSITORY_TOOL.inputSchema),
  );
});

test("run_on_mac offers exactly one command, the plain words it is for, and how long it may run, with no directory or environment to set", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "run-on-mac-tool-input",
    jsonSchemaOf(RUN_ON_MAC_TOOL.inputSchema),
  );
});
