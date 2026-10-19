/**
 * dynamic-tools.test.ts -- the coding agent's dynamic tools close over nothing eve cannot keep as JSON.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { transformDynamicToolExecute } from "../../../node_modules/eve/dist/src/internal/workflow-bundle/dynamic-tool-transform.js";

const CODER_ROOT = fileURLToPath(new URL("../../../../../apps/dev/", import.meta.url));

/** The coding agent's authored files that may define a tool: each tool's own file, and the host they share. */
function authoredToolFiles(): readonly string[] {
  const tools = readdirSync(`${CODER_ROOT}tools`)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `tools/${name}`);
  return [...tools, "host.ts"];
}

/**
 * eve hoists each callback of a tool a `defineDynamic` resolver returns out
 * of its file, and keeps the locals it reads as JSON beside it, so a dynamic
 * tool whose `execute` read its tool's Schema was refused on every turn with
 * "non-serializable capture" and never offered. Note that a module import is
 * read again where the callback runs, so only locals are kept; a dynamic
 * tool's callbacks here read none.
 */
test("no dynamic tool of the coding agent's has a callback that keeps a local of its file", async () => {
  const capturing: string[] = [];
  for (const file of authoredToolFiles()) {
    const source = readFileSync(`${CODER_ROOT}${file}`, "utf8");
    if (!source.includes("defineDynamic(")) continue;
    const transformed = await transformDynamicToolExecute(file, source);
    const kept = [...(transformed?.code ?? "").matchAll(/const (\{[^}]*\}) = __vars;/gu)];
    capturing.push(...kept.map(([, locals]) => `${file}: ${locals}`));
  }

  expect(capturing).toEqual([]);
});
