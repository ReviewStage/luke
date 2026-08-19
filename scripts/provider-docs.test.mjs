import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentation = fs.readFileSync(path.join(repositoryRoot, "PROVIDERS.md"), "utf8");

// Harness tests run on plain Node and cannot import TypeScript, so the value
// sets are read out of their sources by shape. The match is anchored to the
// `as const` declaration these constants are required to use, so a set that
// moves or changes form fails loudly here rather than passing on nothing.
function valueSetValues(sourcePath, constantName) {
  const source = fs.readFileSync(path.join(repositoryRoot, sourcePath), "utf8");
  const declaration = source.match(
    new RegExp(`export const ${constantName} = \\{([^}]*)\\} as const;`),
  );
  assert.ok(declaration, `${constantName} not found in ${sourcePath}`);
  const values = [...declaration[1].matchAll(/:\s*"([^"]+)"/g)].map((entry) => entry[1]);
  assert.ok(values.length > 0, `${constantName} in ${sourcePath} lists no values`);
  return values;
}

test("PROVIDERS.md names every session provider id", () => {
  for (const providerId of valueSetValues(
    "packages/sidecar-core/src/providers.ts",
    "PROVIDER_ID",
  )) {
    assert.ok(
      documentation.includes(`\`${providerId}\``),
      `PROVIDERS.md does not name provider \`${providerId}\` — document its capabilities`,
    );
  }
});

test("PROVIDERS.md names every issue tracker id", () => {
  for (const trackerId of valueSetValues(
    "packages/sidecar-core/src/issues.ts",
    "ISSUE_TRACKER_ID",
  )) {
    assert.ok(
      documentation.includes(`\`${trackerId}\``),
      `PROVIDERS.md does not name tracker \`${trackerId}\` — document its capabilities`,
    );
  }
});
