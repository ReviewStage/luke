import { jsonSchemaGoldenRoot, jsonSchemaOf, settleJsonSchemaGolden } from "@sidecar/wire/testing";
import { test } from "vitest";
import { GET_FILE_CONTENTS_TOOL } from "../server/hosted/repository-tools";

/**
 * The input schema the planning model is offered `get_file_contents` under,
 * as the JSON Schema it emits. What the model is told it may send is the
 * contract a call is read against, and it names a path and nothing that
 * could choose an account, a repository, or a commit, so its bytes are
 * recorded the way the wire's are, and move only under `LUKE_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("get_file_contents offers a path alone, with no repository or commit to name", async () => {
  await settleJsonSchemaGolden(
    ROOT,
    "get-file-contents-tool-input",
    jsonSchemaOf(GET_FILE_CONTENTS_TOOL.inputSchema),
  );
});
