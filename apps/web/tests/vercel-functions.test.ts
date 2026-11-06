import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@repo/runtime/testing";
import { build, type Metafile, type Plugin } from "esbuild";
import { test } from "vitest";
import {
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  type FunctionBundlePlan,
  functionBundlePlan,
  INLINE_EXCEPTION,
  localOnlyReach,
  undeclaredImports,
} from "../server/function-bundles";

const WEB = fileURLToPath(new URL("..", import.meta.url));

const BUNDLE_TIMEOUT = 60_000;

let bundled: Promise<{ task: FunctionBundlePlan; metafile: Metafile }> | undefined;

function bundledFunctions() {
  bundled ??= functionBundlePlan(WEB).then(async (task) => ({
    task,
    metafile: (await build({ ...task.options, write: false })).metafile,
  }));
  return bundled;
}

test("every function bundle loads exactly the externals the record expects", {
  timeout: BUNDLE_TIMEOUT,
}, async () => {
  const { task, metafile } = await bundledFunctions();
  const actual = externalsByBundle(metafile, WEB);
  assert.deepEqual(Object.keys(actual).sort(), task.functions.map((f) => `${f.file}.js`).sort());
  assert.deepEqual(externalsDrift(await expectedExternals(WEB), actual), []);
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

test("no function bundle reaches a module only the local server may carry", {
  timeout: BUNDLE_TIMEOUT,
}, async () => {
  const { metafile } = await bundledFunctions();
  assert.deepEqual(localOnlyReach(metafile, WEB), []);
});

test("a module esbuild injects is bundled, not an undeclared dependency", async (t) => {
  const root = realpathSync(await temporaryDirectory(t, "undeclared-imports-"));
  writeFileSync(join(root, "entry.js"), 'import pad from "left-pad";\nexport default pad;\n');
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
