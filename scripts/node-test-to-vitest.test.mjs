import assert from "node:assert/strict";
import test from "node:test";
import { needsTransform, transformNodeTestImport } from "./node-test-to-vitest.mjs";

test("rewrites a default-only node:test import to a named vitest import", () => {
  const result = transformNodeTestImport('import test from "node:test";\n\ntest("x", () => {});\n');

  assert.equal(result, 'import { test } from "vitest";\n\ntest("x", () => {});\n');
});

test("rewrites a named node:test import, deduplicating identifiers", () => {
  const result = transformNodeTestImport('import { test, describe } from "node:test";\n');

  assert.equal(result, 'import { test, describe } from "vitest";\n');
});

test("rewrites a default import with named imports alongside it", () => {
  const result = transformNodeTestImport('import test, { describe } from "node:test";\n');

  assert.equal(result, 'import { test, describe } from "vitest";\n');
});

test("leaves node:assert imports untouched", () => {
  const source = 'import assert from "node:assert/strict";\nimport test from "node:test";\n';

  const result = transformNodeTestImport(source);

  assert.match(result, /import assert from "node:assert\/strict";/);
});

test("leaves a source with no node:test import unchanged", () => {
  const source = 'import { describe } from "vitest";\n';

  assert.equal(transformNodeTestImport(source), source);
  assert.equal(needsTransform(source), false);
});

test("reports whether a source still imports from node:test", () => {
  assert.equal(needsTransform('import test from "node:test";\n'), true);
  assert.equal(needsTransform('import { test } from "vitest";\n'), false);
});
