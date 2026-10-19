import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { build } from "vite";
import { test } from "vitest";
import { bundleBudget, bundleCeiling } from "../scripts/bundle-budget";

/**
 * The app entry's bundle budget, through a real Vite build of a small app: an
 * HTML entry that imports a shared module statically and a side bundle through
 * a dynamic `import()`, with the budget plugin the web's own build carries.
 */

const SIDE_MODULE = "/side/index.js";

async function writeApp(root: string, budget: Readonly<Record<string, number>>): Promise<string> {
  await mkdir(join(root, "side"), { recursive: true });
  await writeFile(
    join(root, "app.html"),
    '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(
    join(root, "shared.js"),
    `export const shared = ${JSON.stringify("x".repeat(400))};`,
  );
  await writeFile(
    join(root, "main.js"),
    'import "./main.css";\nimport { shared } from "./shared.js";\nconsole.log(shared);\nimport("./side/index.js").then((side) => console.log(side.side));',
  );
  await writeFile(join(root, "main.css"), "body { color: rebeccapurple; }");
  await writeFile(
    join(root, "side", "index.js"),
    `import { shared } from "../shared.js";\nexport const side = shared + ${JSON.stringify("side ".repeat(50))};`,
  );
  const budgetFile = join(root, "bundle-budget.json");
  await writeFile(budgetFile, JSON.stringify({ slack: 0.05, gzipBytes: budget }));
  return budgetFile;
}

function buildApp(root: string, budgetFile: string, env: Record<string, string>) {
  return build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [
      bundleBudget({
        budgetFile,
        entry: join(root, "app.html"),
        sideBundles: { side: SIDE_MODULE },
        env,
      }),
    ],
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      rollupOptions: { input: { app: join(root, "app.html") } },
    },
  });
}

async function recordedBudget(budgetFile: string): Promise<Record<string, number>> {
  return JSON.parse(await readFile(budgetFile, "utf8")).gzipBytes;
}

test("the update flag re-records every measure from the build", async (t) => {
  const root = await temporaryDirectory(t, "luke-bundle-budget-");
  const budgetFile = await writeApp(root, { app: 1 });

  await buildApp(root, budgetFile, { LUKE_UPDATE_BUNDLE_BUDGET: "1" });

  const recorded = await recordedBudget(budgetFile);
  assert.deepEqual(Object.keys(recorded).sort(), ["app", "app.css", "side"]);
  for (const bytes of Object.values(recorded)) assert.ok(bytes > 0);
  // The side bundle is measured beyond the first load, so the shared module counts once.
  assert.ok(
    recorded.side !== undefined && recorded.app !== undefined && recorded.side < recorded.app,
  );
  assert.equal(JSON.parse(await readFile(budgetFile, "utf8")).slack, 0.05);
});

test("a build within its recorded budget passes, and one past its ceiling fails", async (t) => {
  const root = await temporaryDirectory(t, "luke-bundle-budget-");
  const budgetFile = await writeApp(root, {});
  await buildApp(root, budgetFile, { LUKE_UPDATE_BUNDLE_BUDGET: "1" });
  const recorded = await recordedBudget(budgetFile);

  await buildApp(root, budgetFile, {});

  const app = recorded.app ?? 0;
  const shrunk = { ...recorded, app: Math.floor(app / 1.2) };
  await writeFile(budgetFile, JSON.stringify({ slack: 0.05, gzipBytes: shrunk }));
  await assert.rejects(
    buildApp(root, budgetFile, {}),
    new RegExp(
      `app is ${app} gzipped bytes, over its ceiling of ${bundleCeiling(shrunk.app, 0.05)}`,
    ),
  );
  assert.deepEqual(await recordedBudget(budgetFile), shrunk, "a failed check records nothing");
});

test("a measure with no baseline fails until one is recorded", async (t) => {
  const root = await temporaryDirectory(t, "luke-bundle-budget-");
  const budgetFile = await writeApp(root, {});
  await buildApp(root, budgetFile, { LUKE_UPDATE_BUNDLE_BUDGET: "1" });
  const { side: _side, ...withoutSide } = await recordedBudget(budgetFile);
  await writeFile(budgetFile, JSON.stringify({ slack: 0.05, gzipBytes: withoutSide }));

  await assert.rejects(
    buildApp(root, budgetFile, {}),
    /side has no baseline in bundle-budget\.json/,
  );
});

test("a baseline's ceiling is the baseline plus the slack, rounded down", () => {
  assert.equal(bundleCeiling(1745, 0.05), 1832);
  assert.equal(bundleCeiling(901_571, 0.05), 946_649);
});
