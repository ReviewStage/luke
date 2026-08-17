import assert from "node:assert/strict";
import test from "node:test";
import packageManifest from "../package.json";

test("migrations run only through the explicit database script", () => {
  const scripts: Record<string, string> = packageManifest.scripts;

  assert.equal(scripts.postinstall, undefined);
  assert.equal(scripts.prepare, undefined);

  for (const scriptName of ["build", "dev", "preview", "typecheck", "test"]) {
    assert.doesNotMatch(scripts[scriptName] ?? "", /drizzle-kit|migrate/);
  }

  assert.equal(scripts["db:migrate"], "drizzle-kit migrate");
  assert.deepEqual(
    Object.entries(scripts)
      .filter(([, command]) => /\bmigrate\b/.test(command))
      .map(([name]) => name),
    ["db:migrate"],
  );
});
