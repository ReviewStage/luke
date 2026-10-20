import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import {
  callerDirectories,
  checkApiCallers,
  PATHS_MODULE,
  RESOLUTION,
} from "../server/api-callers";

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");

test("every /api/ path a client in the repository builds resolves to a route", async () => {
  const directories = await callerDirectories(REPO_ROOT);
  assert.equal(directories.includes(PATHS_MODULE.split("/").slice(0, 3).join("/")), true);
  const report = await checkApiCallers({ repoRoot: REPO_ROOT, web: WEB });
  assert.deepEqual(report.refused, []);
  assert.notEqual(report.resolved.length, 0);
  assert.notEqual(report.filesScanned, 0);
});

/** A repository holding one client file and a paths module, read against this app's own table and the hosted contract. */
async function repositoryWith(root: string, client: string): Promise<void> {
  const files = new Map([
    [join("apps", "desktop", "src", "client.ts"), client],
    [PATHS_MODULE, 'export const MODELS = "/api/models";\n'],
    [join("scripts", ".keep.sh"), ""],
    [join("tools", ".keep.sh"), ""],
  ]);
  for (const [path, contents] of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
}

/** An interpolated id as a client's template literal spells it. */
const HOLE = ["$", "{id}"].join("");

test("a client path resolves to an exception's rewrite first, then a hosted procedure, and one that matches neither is refused even though the fallback would take it", async (t) => {
  const root = await temporaryDirectory(t, "luke-api-callers-");
  await repositoryWith(
    root,
    [
      "const id = 'x';",
      "export const paths = [",
      `  \`/api/agents/${HOLE}/pictures/${HOLE}\`,`,
      `  \`/api/plans/${HOLE}/board\`,`,
      '  "/api/voice/sessions",',
      '  "/api/nope",',
      `  \`/api/plans/${HOLE}/board/more\`,`,
      "];",
      "",
    ].join("\n"),
  );
  const report = await checkApiCallers({ repoRoot: root, web: WEB });
  const resolution = new Map(
    report.resolved.map((entry) => [entry.caller.display, [entry.resolution, entry.route]]),
  );
  assert.deepEqual(resolution.get("/api/agents/{…}/pictures/{…}"), [
    RESOLUTION.REWRITE,
    "/api/agents/([^/]+)/pictures/([^/]+)",
  ]);
  assert.deepEqual(resolution.get("/api/plans/{…}/board"), [
    RESOLUTION.PROCEDURE,
    "/api/plans/{id}/board",
  ]);
  assert.deepEqual(resolution.get("/api/models"), [RESOLUTION.PROCEDURE, "/api/models"]);
  assert.deepEqual(resolution.get("/api/voice/sessions"), [
    RESOLUTION.ALIAS,
    "/api/voice/sessions",
  ]);
  assert.deepEqual(
    report.refused.map((refusal) => [refusal.display, refusal.reason]),
    [
      ["/api/nope", "no-route"],
      ["/api/plans/{…}/board/more", "no-route"],
    ],
  );
});
