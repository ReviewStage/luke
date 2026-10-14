import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { toolsOf } from "@luke/service/agents/agent-runtime/tools";
import { CODER_TOOL, CODER_TOOL_SET } from "@luke/service/agents/coder-host/tool-set";
import { test } from "vitest";

/**
 * The coding agent's tools held to one list: the registry's coder role,
 * the names the host picks them out by, the files the coder project
 * authors one per tool, and the set the store writer holds its rows to.
 */

/** The coder project's authored tools, one file each under `coder/tools/`. */
const AUTHORED = fileURLToPath(new URL("../coder/tools/", import.meta.url));

test("every tool the registry offers a coding agent is named by the host, authored as one file under coder/tools, and held by the writer, and nothing else is", () => {
  const offered = [...toolsOf(AGENT_ROLE.CODER)].toSorted();
  assert.deepEqual(Object.values(CODER_TOOL).toSorted(), offered);
  const files = readdirSync(AUTHORED)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -".ts".length))
    .toSorted();
  assert.deepEqual(files, offered);
  for (const name of offered) assert.ok(name in CODER_TOOL_SET, name);
});
