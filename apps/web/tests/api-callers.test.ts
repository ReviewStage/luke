import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  buildOutputAliases,
  CALLER_KIND,
  callerDirectories,
  checkApiCallers,
  evaluatePathsModule,
  PATHS_MODULE,
  REFUSAL,
  RESOLUTION,
  resolveCallers,
  scanCallers,
} from "../server/api-callers";
import { readApiRewritesTable } from "../server/function-rewrites";

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");

/** A small table in the committed table's shape: one exact rewrite, one segment rewrite, one prefix rewrite. */
const TABLE = [
  { src: "/api/auth/(.*)", dest: "/api/default.js?route=auth/[...all]&path=auth/$1" },
  {
    src: "/api/brain/turns/([^/]+)/events",
    dest: "/api/turn-events.js?route=brain/turns/events&id=$1",
  },
  { src: "/api/brain/turns/([^/]+)", dest: "/api/turn-read.js?route=brain/turns/turn&id=$1" },
  { src: "/api/devices", dest: "/api/default.js?route=devices" },
];
const ALIASES = ["/api/feedback"];

function scratch(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "api-callers-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

async function scratchReport(files: Readonly<Record<string, string>>) {
  const root = scratch(files);
  const scan = await scanCallers(root, ["."]);
  return { scan, ...resolveCallers(scan.sites, TABLE, ALIASES) };
}

const refusals = (report: { readonly refused: readonly { display: string; reason: string }[] }) =>
  report.refused.map((refusal) => [refusal.display, refusal.reason]);

test("a caller path the table does not serve is refused, whichever language spells it", async () => {
  const report = await scratchReport({
    "client.ts": `const url = \`\${origin}/api/nowhere\`;\nfetch("https://luke.test/api/devices?since=1");\n`,
    "Client.swift": 'let url = base.appendingPathComponent("api/elsewhere")\n',
    "probe.sh": 'curl "https://luke.test/api/absent"\n',
  });
  assert.deepEqual(refusals(report), [
    ["/api/absent", REFUSAL.NO_ROUTE],
    ["/api/elsewhere", REFUSAL.NO_ROUTE],
    ["/api/nowhere", REFUSAL.NO_ROUTE],
  ]);
  assert.deepEqual(
    report.resolved.map((entry) => [entry.caller.display, entry.resolution, entry.route]),
    [["/api/devices", RESOLUTION.REWRITE, "/api/devices"]],
  );
});

test("a template interpolating a whole segment is matched against the pattern that serves it", async () => {
  const report = await scratchReport({
    "client.ts": [
      `const read = \`/api/brain/turns/\${encodeURIComponent(id)}\`;`,
      `const events = \`\${origin}/api/brain/turns/\${id}/events\`;`,
    ].join("\n"),
    "Client.swift": 'let url = "\\(origin)/api/brain/turns/\\(turnId)/events"\n',
  });
  assert.deepEqual(refusals(report), []);
  assert.deepEqual(
    report.resolved.map((entry) => [entry.caller.display, entry.caller.kind, entry.route]),
    [
      ["/api/brain/turns/{…}", CALLER_KIND.BUILDER, "/api/brain/turns/([^/]+)"],
      ["/api/brain/turns/{…}/events", CALLER_KIND.BUILDER, "/api/brain/turns/([^/]+)/events"],
    ],
  );
  assert.equal(report.resolved[1]?.caller.sites.length, 2);
});

test("a template whose interpolation is not a whole segment is refused as unreadable, not skipped", async () => {
  const report = await scratchReport({
    "client.ts": [
      `const a = \`/api/brain/turns/\${id}-events\`;`,
      `const b = \`/api/dev\${suffix}\`;`,
    ].join("\n"),
    "probe.sh": `curl "$ORIGIN/api/devices$SUFFIX"\n`,
  });
  assert.deepEqual(refusals(report), [
    ["/api/brain/turns/{…}-events", REFUSAL.UNREADABLE_BUILDER],
    ["/api/dev{…}", REFUSAL.UNREADABLE_BUILDER],
    ["/api/devices{…}", REFUSAL.UNREADABLE_BUILDER],
  ]);
});

test("a base other segments are appended to resolves as a prefix, and an alias as itself", async () => {
  // `/api/auth/` is the wildcard's own match with an empty capture, so it is a rewrite, not a prefix.
  const report = await scratchReport({
    "client.ts": 'const base = "https://luke.test/api/auth";\nconst feedback = "/api/feedback";\n',
    "Client.swift": 'static let auth = URL(string: "https://luke.test/api/auth/")!\n',
  });
  assert.deepEqual(refusals(report), []);
  assert.deepEqual(
    report.resolved.map((entry) => [entry.caller.display, entry.resolution, entry.route]),
    [
      ["/api/auth", RESOLUTION.PREFIX, "/api/auth/(.*)"],
      ["/api/auth/", RESOLUTION.REWRITE, "/api/auth/(.*)"],
      ["/api/feedback", RESOLUTION.ALIAS, "/api/feedback"],
    ],
  );
});

test("comments are not callers, and skipped directories are not scanned", async () => {
  const report = await scratchReport({
    "client.ts": [
      "// GET /api/nowhere",
      "/** `PUT /api/elsewhere/{id}` */",
      'const x = "none";',
    ].join("\n"),
    "Client.swift": ["/// PUT /api/nowhere", "/* /api/elsewhere */", 'let x = "none"'].join("\n"),
    "probe.sh": "# curl /api/nowhere\n",
    "node_modules/dep/index.js": 'fetch("/api/nowhere");\n',
    "dist/out.js": 'fetch("/api/nowhere");\n',
  });
  assert.deepEqual(report.scan.sites, []);
  assert.equal(report.scan.filesScanned, 3);
});

test("a paths-module export that is not a path is refused by name", async () => {
  const root = scratch({
    "paths.ts": [
      'export const TABLE = { A: "/api/devices" } as const;',
      "export const BOUND = 3;",
      "export function turnPath(id: string): string {",
      `  return \`/api/brain/turns/\${encodeURIComponent(id)}\`;`,
      "}",
      "export function count(): number {",
      "  return 1;",
      "}",
      'const HIDDEN = "/api/nowhere";',
      "export { HIDDEN as shown };",
    ].join("\n"),
  });
  const evaluated = await evaluatePathsModule(root, "paths.ts");
  assert.deepEqual(refusals(evaluated), [
    ["paths.ts export BOUND", REFUSAL.NOT_A_PATH],
    ["paths.ts export count", REFUSAL.NOT_A_PATH],
  ]);
  assert.equal(evaluated.builders, 2);
  const report = resolveCallers(evaluated.sites, TABLE, ALIASES);
  assert.deepEqual(
    report.resolved.map((entry) => [entry.caller.display, entry.caller.kind, entry.route]),
    [
      ["/api/brain/turns/{…}", CALLER_KIND.BUILDER, "/api/brain/turns/([^/]+)"],
      ["/api/devices", CALLER_KIND.STATIC, "/api/devices"],
    ],
  );
});

test("every export of the hosted paths module is a path or a builder, and each resolves", async () => {
  const evaluated = await evaluatePathsModule(REPO_ROOT);
  assert.deepEqual(evaluated.refused, []);
  const report = resolveCallers(
    evaluated.sites,
    await readApiRewritesTable(WEB),
    await buildOutputAliases(WEB),
  );
  assert.deepEqual(report.refused, []);
  const built = report.resolved.filter((entry) => entry.caller.kind === CALLER_KIND.BUILDER);
  assert.equal(built.length, evaluated.builders);
  for (const entry of built) assert.equal(entry.resolution, RESOLUTION.REWRITE);
  assert.equal(
    evaluated.sites.every((site) => site.site.file === PATHS_MODULE),
    true,
  );
});

test("every /api/ path a client in the repository builds resolves to a route", async () => {
  const directories = await callerDirectories(REPO_ROOT);
  assert.equal(directories.includes(PATHS_MODULE.split("/").slice(0, 3).join("/")), true);
  const report = await checkApiCallers({ repoRoot: REPO_ROOT, web: WEB });
  assert.deepEqual(report.refused, []);
  assert.notEqual(report.resolved.length, 0);
  assert.notEqual(report.filesScanned, 0);
});
