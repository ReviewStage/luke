import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { build, type Plugin } from "esbuild";
import { test } from "vitest";
import {
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  functionBundlePlan,
  INLINE_EXCEPTION,
  undeclaredImports,
} from "../server/function-bundles";
import { webFunctions } from "../server/function-layout";
import { apiRewrites, readApiRewritesTable, rewritesDrifted } from "../server/function-rewrites";

const WEB = fileURLToPath(new URL("..", import.meta.url));

test("the committed table is what the routes generate, and vercel.json's /api/ entries are the table", async () => {
  assert.deepEqual(await readApiRewritesTable(WEB), apiRewrites(await webFunctions(WEB)));
  assert.equal(await rewritesDrifted(WEB), false);
});

/**
 * The whole map, not one package: every bundle's external set is the one the
 * record holds. The outage deploy moved three externals on one edge and the
 * eve check names one of them; this is the assertion that would have named
 * all three, and it fails as data, naming the bundle and what it gained or
 * lost, so a legitimate widening is a one-line edit to the record and a
 * review moment rather than a silent change to what a function loads.
 */
test("every function bundle loads exactly the externals the record expects", {
  timeout: 60_000,
}, async () => {
  const task = await functionBundlePlan(WEB);
  const result = await build({ ...task.options, write: false });
  const actual = externalsByBundle(result.metafile, WEB);
  assert.deepEqual(Object.keys(actual).sort(), task.functions.map((f) => `${f.file}.js`).sort());
  assert.deepEqual(externalsDrift(await expectedExternals(WEB), actual), []);
  // Inline-first leaves outside a bundle only Node's own modules and the named exceptions; a fourth external is a dependency that stopped inlining.
  const permitted = new Set<string>([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
    ...Object.values(INLINE_EXCEPTION),
  ]);
  for (const externals of Object.values(actual)) {
    assert.deepEqual(
      externals.filter((specifier) => !permitted.has(specifier)),
      [],
    );
  }
});

test("a module esbuild injects is bundled, not an undeclared dependency", async (t) => {
  // Note that we resolve the folder, because esbuild reports macOS's /tmp as /private/tmp.
  const root = realpathSync(await temporaryDirectory(t, "luke-undeclared-imports-"));
  writeFileSync(join(root, "entry.js"), 'import pad from "left-pad";\nexport default pad;\n');
  // A virtual module handed to `inject`, as Sentry's esbuild plugin hands its release stub.
  const stub = join(root, "_injected-stub");
  const injecting: Plugin = {
    name: "injecting",
    setup(builder) {
      builder.onResolve({ filter: /_injected-stub/ }, (args) => ({ path: args.path }));
      builder.onLoad({ filter: /_injected-stub/ }, () => ({
        contents: "globalThis.injected = 1;",
      }));
    },
  };
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "entry.js")],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    external: ["left-pad"],
    inject: [stub],
    plugins: [injecting],
    logLevel: "silent",
  });
  assert.deepEqual(undeclaredImports(result.metafile, root, new Set()), ["left-pad"]);
});
